import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { catalog, ensureWorkspace } from './crm-workspace.js';
import { dealFields, validateDealDetails, computedDealDetails } from './deal-fields.js';
import { normalizeRut } from '../extraction/identity-normalizers.js';
import { normalizeDealUrl, normalizeEmail, normalizePhone } from './deal-link-normalizers.js';

export const RESTORE_ID = 'zendesk-sell-created-2026-v1';
const csvFiles = ['deals_20260401_0752.csv', 'deals_20260401_0746.csv'];
const aliases = {
  dealName:['Nombre del trato'], idDocument:['RUT o ID','RUT O ID','RUT_normalizado'],
  birthDate:['Fecha de nacimiento','Fecha Nacimiento'], email:['Correo electrónico','correo electrónico','Correo'],
  phone:['Teléfono','Telefono','Numero de teléfono'], city:['Ciudad'], coverage:['Previsión','PREVISION','Prevision','previsión'],
  coveragePlan:['Tramo/Modalidad'], interest:['Interés'], surgery:['CIRUGIA'], bariatricSurgery:['CIRUGIABARIATRICA'],
  surgeryDate:['FECHA DE CIRUGÍA'], orRequestDate:['FECHA SOLICITUD DE PABELLON'], gallstones:['COLELITIASIS'],
  previousSurgeries:['CIRUGIAS PREVIAS'], weight:['Peso'], height:['Estatura','PESO (metros)'],
  medinetUrl:['URL-MEDINET'], examsUrl:['URL-EXAMENES'], value:['Valor'], source:['Origen'],
  lossReason:['Motivo de pérdida'], unqualifiedReason:['Motivo de no cualificación'], collaborators:['Colaboradores'],
  bariatricSurgeon:['CIRUJANO BARIÁTRICO'], balloonSurgeon:['CIRUJANO DE BALON'], generalSurgeon:['CIRUJANO GENERAL'],
  plasticSurgeon:['CIRUJANO PLASTICO'], secondSurgeon:['2DO CIRUJANO'],
  barCollaborator1:['Colaborador 1 (BAR)'], barCollaborator2:['Colaborador 2 (BAR)'], barCollaborator3:['Colaborador 3 (BAR)'],
  plasticCollaborator1:['Colaborador 1 (PLASTICA)'], plasticCollaborator2:['Colaborador 2 (PLASTICA)'],
};
const primaryFields = {
  dealName:'deal_name', idDocument:'rut', email:'contact_email', phone:'contact_phone', city:'ciudad',
  surgery:'cirugia', surgeryDate:'fecha_cirugia', medinetUrl:'url_medinet', source:'origen',
  barCollaborator1:'colaborador1', barCollaborator2:'colaborador2', barCollaborator3:'colaborador3',
};
const cacheFields = {dealName:'deal_name', email:'contact_email', phone:'contact_phone', value:'value',
  barCollaborator1:'colaborador_1', barCollaborator2:'colaborador_2', barCollaborator3:'colaborador_3'};
const present = v => v !== null && v !== undefined && String(v).trim() !== '';
const first = v => Array.isArray(v) ? v.find(present) : v;
const clean = v => String(v ?? '').trim();
const problem = (field, reason, source) => ({field,reason,source});
const dateOnly = v => {
  const raw = clean(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString().slice(0,10)!==raw) return null;
  return raw;
};
// Dates without time in the export are calendar dates in Chile, not UTC instants.
const localMidnight = v => {
  const day = dateOnly(v); if (!day) return null;
  const midday = new Date(`${day}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',timeZoneName:'longOffset'}).formatToParts(midday).find(p=>p.type==='timeZoneName').value.replace('GMT','');
  return new Date(`${day}T00:00:00${offset || '+00:00'}`).toISOString();
};

export async function loadSellCsv() {
  const byId = new Map(), hashes = {};
  for (const file of csvFiles) {
    const bytes = await readFile(new URL(`../data/input/${file}`, import.meta.url));
    hashes[file] = createHash('sha256').update(bytes).digest('hex');
    const rows = parse(bytes,{bom:true,columns:true,group_columns_by_name:true,skip_empty_lines:true});
    for (const row of rows) {
      const id = clean(row['ID del trato']);
      if (!/^\d+$/.test(id)) throw new Error('restore_invalid_csv_id');
      if (!byId.has(id)) byId.set(id,[]);
      byId.get(id).push({source:file,row});
    }
  }
  return {byId,hashes};
}

function normalized(field, value) {
  if (field.type === 'url') return normalizeDealUrl(field.key,value);
  if (field.type === 'email') return normalizeEmail(value);
  if (field.type === 'tel') return normalizePhone(value);
  if (field.type === 'date') return dateOnly(value);
  if (field.type === 'number') {
    const raw = clean(value);
    if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) return null;
    let n = Number(raw.replace(',','.'));
    if (field.key === 'height' && n >= 1 && n <= 3) n *= 100;
    return n;
  }
  if (field.key === 'gallstones') {
    const v = clean(value);
    if (/^NO\b/i.test(v)) return 'No';
    if (/^S[IÍ]\b/i.test(v)) return 'Sí';
    if (/COLECISTECTOM[IÍ]A PREVIA|Operada \/ resuelta/i.test(v)) return 'Operada / resuelta';
  }
  if (field.key === 'idDocument') {
    const v = clean(value);
    if (/^[\d.kK-]+$/.test(v)) return normalizeRut(v);
    return v;
  }
  return clean(value);
}

export function prepareSellDeal({deal,cache=null}, csvRows=[]) {
  const id = clean(deal.deal_id), createdDay = dateOnly(deal.added_at);
  if (!/^\d+$/.test(id) || !createdDay || createdDay<'2026-01-01' || createdDay>='2027-01-01') throw new Error('restore_invalid_source_id_or_year');
  const pipeline = catalog.pipelines.find(p=>p.zendeskId===String(deal.pipeline_id));
  const stage = pipeline?.stages.find(s=>s.zendeskId===String(deal.stage_id));
  if (!pipeline || !stage) throw new Error('restore_unmapped_pipeline_or_stage');
  const issues = [], details = {}, provenance = {};
  const candidates = key => {
    const items = [];
    if (primaryFields[key]) items.push({value:deal[primaryFields[key]],source:'deals'});
    if (key==='idDocument') items.push({value:deal.rut_normalizado,source:'deals.rut_normalizado'});
    if (cacheFields[key]) items.push({value:cache?.[cacheFields[key]],source:'sell_deals_cache'});
    for (const {row,source} of csvRows) for (const column of aliases[key] || []) items.push({value:first(row[column]),source:`${source}:${column}`});
    return items.filter(item=>present(item.value));
  };
  for (const field of dealFields) {
    for (const item of candidates(field.key)) {
      if (field.key==='value') {
        const currency = item.source==='sell_deals_cache' ? cache?.currency : first(csvRows.find(r=>item.source.startsWith(`${r.source}:`))?.row.Moneda);
        if (clean(currency).toUpperCase()!=='CLP') {issues.push(problem(field.key,'currency_not_clp',item.source));continue;}
      }
      const value = normalized(field,item.value);
      if (value === null) {issues.push(problem(field.key,'invalid_format',item.source));continue;}
      try { details[field.key] = validateDealDetails({[field.key]:value})[field.key]; }
      catch { issues.push(problem(field.key,'invalid_value',item.source));continue; }
      provenance[field.key]=item.source;break;
    }
  }
  if (!details.dealName) throw new Error('restore_missing_deal_name');
  // Recover links put in the wrong export column only when the destination field is empty.
  for (const [to,from] of [['medinetUrl','examsUrl'],['examsUrl','medinetUrl']]) if (!details[to]) {
    for (const item of candidates(from)) {
      const value=normalizeDealUrl(to,item.value);
      if (!value) continue;
      details[to]=value;provenance[to]=item.source;issues.push(problem(to,'recovered_from_other_url_field',item.source));break;
    }
  }
  let owner = '';
  const ownerCandidates = [{value:deal.owner_name,source:'deals'},{value:cache?.owner_name,source:'sell_deals_cache'},...csvRows.map(r=>({value:first(r.row.Propiedad),source:r.source}))];
  for (const item of ownerCandidates.filter(i=>present(i.value))) {
    const value=clean(item.value);
    if (value.length<=80 && !/[\x00-\x1f]/.test(value)) {owner=value;provenance.owner=item.source;break;}
    issues.push(problem('owner','invalid_value',item.source));
  }
  const csvFirst = names => csvRows.flatMap(({row})=>names.map(n=>first(row[n]))).find(present);
  const branchRaw = clean(deal.sucursal || csvFirst(['SUCURSAL']));
  // Keep clinic-specific names rather than turning distinct clinics into one city.
  const branch = branchRaw.length<=80 && !/[\x00-\x1f]/.test(branchRaw) ? branchRaw : '';
  if (branchRaw && !branch) issues.push(problem('branch','invalid_value','deals_or_csv'));
  const labels = [...new Set(clean(csvFirst(['Etiquetas'])).split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean))];
  const whatsapp = computedDealDetails(details).whatsappUrl;
  for (const {row,source} of csvRows) if (present(row.WhatsApp_Contactar_LINK)) {
    const old=normalizeDealUrl('whatsappUrl',row.WhatsApp_Contactar_LINK);
    if (!old || old!==whatsapp) issues.push(problem('whatsappUrl',old?'different_from_phone':'invalid_format',source));
  }
  let createdAt = localMidnight(createdDay);
  if (cache?.created_at_sell && Number.isFinite(Date.parse(cache.created_at_sell))) {
    const cached = new Date(cache.created_at_sell);
    const cachedDay = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(cached);
    if (cachedDay===createdDay) createdAt=cached.toISOString();
  }
  const stamp = (value,field) => {if (!present(value)) return null;const result=localMidnight(value);if(!result)issues.push(problem(field,'invalid_date','deals'));return result;};
  return {sourceId:id,pipeline:pipeline.id,stage:stage.id,owner,branch,labels,details,createdAt,
    stageChangedAt:stamp(deal.fecha_cambio_fase,'stageChangedAt'),closedAt:stamp(deal.fecha_cierre,'closedAt'),
    payload:{deal,cache,csv:csvRows,provenance,issues,restoreId:RESTORE_ID}};
}

export function summarizePrepared(items) {
  const summary={candidates:items.length,pipelines:{},fields:{},links:{medinet:0,exams:0,whatsapp:0,telephone:0,email:0,chatwoot:0},issues:{},dealsWithIssues:0};
  for (const item of items) {
    summary.pipelines[item.pipeline]=(summary.pipelines[item.pipeline]||0)+1;
    for (const [key,value] of Object.entries(item.details)) if(present(value))summary.fields[key]=(summary.fields[key]||0)+1;
    if(item.details.medinetUrl)summary.links.medinet++;
    if(item.details.examsUrl)summary.links.exams++;
    if(item.details.email)summary.links.email++;
    if(item.details.phone)summary.links.telephone++;
    if(computedDealDetails(item.details).whatsappUrl)summary.links.whatsapp++;
    if(item.payload.issues.length)summary.dealsWithIssues++;
    for(const {field,reason} of item.payload.issues){const key=`${field}:${reason}`;summary.issues[key]=(summary.issues[key]||0)+1;}
  }
  return summary;
}

export async function restoreSell2026(pool,{apply=false,expectedPipelines=null,csv=null}={}) {
  await ensureWorkspace(pool);
  const files=csv || await loadSellCsv();
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query('SELECT pg_advisory_xact_lock(162472226)');
    const finished=(await client.query('SELECT summary FROM crm_sell_restore_runs WHERE id=$1',[RESTORE_ID])).rows[0];
    if (finished) {await client.query('COMMIT');return {...finished.summary,alreadyCompleted:true};}
    if(!expectedPipelines){try{expectedPipelines=JSON.parse(process.env.CRM_RESTORE_SELL_2026_COUNTS || 'null');}catch{}}
    if(!expectedPipelines || Array.isArray(expectedPipelines) || !Object.keys(expectedPipelines).length || Object.entries(expectedPipelines).some(([key,n])=>!catalog.pipelines.some(p=>p.id===key) || !Number.isSafeInteger(n) || n<0))throw new Error('restore_expected_counts_missing');
    const rows=(await client.query(`SELECT to_jsonb(d) AS deal,to_jsonb(c) AS cache FROM deals d
      LEFT JOIN sell_deals_cache c ON c.deal_id::text=d.deal_id
      WHERE d.added_at>=DATE '2026-01-01' AND d.added_at<DATE '2027-01-01' ORDER BY d.added_at,d.deal_id`)).rows;
    const prepared=rows.map(row=>prepareSellDeal(row,files.byId.get(String(row.deal.deal_id)) || []));
    const summary=summarizePrepared(prepared);
    if (new Set(prepared.map(r=>r.sourceId)).size!==prepared.length) throw new Error('restore_duplicate_source_ids');
    if (JSON.stringify(Object.entries(summary.pipelines).sort())!==JSON.stringify(Object.entries(expectedPipelines).sort())) throw new Error('restore_source_counts_changed');
    summary.csvHashes=files.hashes;
    summary.inserted=0;summary.alreadyPresent=0;
    const contactsBefore=Number((await client.query('SELECT count(*) AS n FROM crm_link_contacts')).rows[0].n);
    const existing=(await client.query("SELECT id,source_id,source_system,details FROM crm_opportunities")).rows;
    const archivedIds=new Set(existing.filter(o=>o.source_system==='zendesk_sell').map(o=>o.source_id));
    // A newly added live deal with the same strong identity needs reconciliation,
    // not an automatic merge or an additional duplicate. Never compare names alone.
    for (const item of prepared) {
      if (archivedIds.has(item.sourceId)) {summary.alreadyPresent++;continue;}
      const identity=normalizeRut(item.details.idDocument || ''), phone=normalizePhone(item.details.phone);
      if(existing.some(o=>o.source_system!=='zendesk_sell' && ((identity && normalizeRut(o.details?.idDocument||'')===identity) || (phone && normalizePhone(o.details?.phone)===phone)))) throw new Error('restore_live_identity_needs_reconciliation');
    }
    if (!apply) {await client.query('ROLLBACK');return {...summary,dryRun:true};}
    for (const item of prepared) {
      if (archivedIds.has(item.sourceId)) continue;
      if(item.owner)await client.query("INSERT INTO crm_options(kind,value) VALUES ('owner',$1) ON CONFLICT DO NOTHING",[item.owner]);
      const id=randomUUID();
      await client.query(`INSERT INTO crm_opportunities(id,contact_id,pipeline_id,stage_id,branch,labels,owner,details,
        source_system,source_id,source_payload,created_at,updated_at,stage_changed_at,closed_at)
        VALUES($1,NULL,$2,$3,$4,$5::jsonb,$6,$7::jsonb,'zendesk_sell',$8,$9::jsonb,$10,now(),$11,$12)`,
        [id,item.pipeline,item.stage,item.branch,JSON.stringify(item.labels),item.owner,JSON.stringify(item.details),item.sourceId,JSON.stringify(item.payload),item.createdAt,item.stageChangedAt,item.closedAt]);
      await client.query(`INSERT INTO crm_changes(entity,entity_id,previous_value,new_value,actor) VALUES('opportunity',$1,NULL,$2::jsonb,'sell-restore-2026')`,
        [id,JSON.stringify({id,stage_id:item.stage,source_system:'zendesk_sell',source_id:item.sourceId,restored:true})]);
      summary.inserted++;
    }
    const contactsAfter=Number((await client.query('SELECT count(*) AS n FROM crm_link_contacts')).rows[0].n);
    if(contactsAfter!==contactsBefore)throw new Error('restore_contact_count_changed');
    const stored=(await client.query("SELECT source_id,details FROM crm_opportunities WHERE source_system='zendesk_sell' AND source_id=ANY($1::text[])",[prepared.map(r=>r.sourceId)])).rows;
    if(stored.length!==prepared.length)throw new Error('restore_verification_failed');
    for(const row of stored){
      validateDealDetails(row.details);
      for(const field of ['medinetUrl','examsUrl'])if(row.details[field] && normalizeDealUrl(field,row.details[field])!==row.details[field])throw new Error('restore_link_verification_failed');
    }
    summary.contactsCreated=0;
    await client.query('INSERT INTO crm_sell_restore_runs(id,summary) VALUES($1,$2::jsonb)',[RESTORE_ID,JSON.stringify(summary)]);
    await client.query('COMMIT');
    return summary;
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}

export async function runConfiguredSellRestore(pool) {
  const mode=process.env.CRM_RESTORE_SELL_2026;
  if(!['dry-run','apply'].includes(mode)) return;
  try { console.log('CRM_SELL_RESTORE_RESULT',JSON.stringify(await restoreSell2026(pool,{apply:mode==='apply'}))); }
  catch(error) {
    // Import issues and raw values stay in the private database, not public logs.
    const code=/^restore_[a-z_]+$/.test(error.message)?error.message:'restore_failed';
    console.error('CRM_SELL_RESTORE_FAILED',code);
  }
}
