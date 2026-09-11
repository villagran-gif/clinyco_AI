import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {dealFields, validateDealDetails, computedDealDetails, DealFieldError} from './deal-fields.js';
import { ensureLinks, publicLinks } from './crm-links.js';
export const catalog = JSON.parse(await readFile(new URL('./site/crm-structure.json', import.meta.url), 'utf8'));
export class CrmError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
const bad = () => { throw new CrmError(400, 'invalid_fields'); };
const text = (value, max, required = false) => {
  if (typeof value !== 'string' || value.trim().length > max || /[\x00-\x1f]/.test(value) || (required && !value.trim())) bad();
  return value.trim();
};
const uuid = id => { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '')) bad(); return id; };
const version = value => { if (!Number.isSafeInteger(value) || value < 1) bad(); return value; };
const offset = value => { const n = Number(value || 0); if (!Number.isSafeInteger(n) || n < 0 || n > 1000000) bad(); return n; };
export function opportunityInput(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad();
  const pipeline = catalog.pipelines.find(p => p.id === input.pipeline);
  if (!pipeline || !pipeline.stages.some(s => s.id === input.stage)) bad();
  const branch = text(input.branch ?? '', 80);
  if (branch && !pipeline.branches.includes(branch) && branch !== existing?.branch) bad();
  const labels = input.labels ?? [];
  if (!Array.isArray(labels) || labels.some(l => !pipeline.labels.includes(l) && !existing?.labels?.includes(l))) bad();
  let details;
  try { details = input.details === undefined ? undefined : validateDealDetails(input.details); } catch(e) { if(e instanceof DealFieldError) throw new CrmError(400,e.message); throw e; }
  return { details, closed: /^(CERRADO|DESCALIFICADO)/.test(pipeline.stages.find(s=>s.id===input.stage).name), pipeline: pipeline.id, stage: input.stage, branch, labels: [...new Set(labels)], owner: text(input.owner ?? '', 80) };
}
export function taskInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad();
  let due = null;
  if (input.due !== null && input.due !== '' && input.due !== undefined) {
    if (typeof input.due !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.due) || !Number.isFinite(Date.parse(input.due))) bad();
    due = new Date(input.due).toISOString();
  }
  if (!['pending','done'].includes(input.status)) bad();
  return { title: text(input.title, 160, true), owner: text(input.owner ?? '', 80), type: text(input.type ?? '', 80), due, status: input.status };
}
const schema = `
CREATE TABLE IF NOT EXISTS crm_pipelines (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS crm_stages (pipeline_id text REFERENCES crm_pipelines(id), id text, name text NOT NULL, display_order integer NOT NULL, completed boolean NOT NULL, PRIMARY KEY(pipeline_id,id));
CREATE TABLE IF NOT EXISTS crm_options (kind text NOT NULL CHECK(kind IN ('owner','task_type')), value text NOT NULL, PRIMARY KEY(kind,value));
CREATE TABLE IF NOT EXISTS crm_opportunities (
 id uuid PRIMARY KEY, contact_id text NOT NULL REFERENCES crm_link_contacts(contact_id),
 pipeline_id text NOT NULL, stage_id text NOT NULL, branch text NOT NULL DEFAULT '', labels jsonb NOT NULL DEFAULT '[]', owner text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(pipeline_id,stage_id) REFERENCES crm_stages(pipeline_id,id), UNIQUE(contact_id,pipeline_id)
);
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS source_conversation_id text REFERENCES crm_link_conversations(conversation_id);
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}';
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz;
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE crm_opportunities ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS source_system text;
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS source_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunities_source ON crm_opportunities(source_system,source_id);
CREATE TABLE IF NOT EXISTS crm_sell_restore_runs (id text PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now(), summary jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS crm_deal_notes (id uuid PRIMARY KEY, opportunity_id uuid NOT NULL REFERENCES crm_opportunities(id), body text NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS crm_deal_notes_record ON crm_deal_notes(opportunity_id,created_at,id);
CREATE TABLE IF NOT EXISTS crm_tasks (
 id uuid PRIMARY KEY, opportunity_id uuid NOT NULL REFERENCES crm_opportunities(id), title text NOT NULL,
 owner text NOT NULL DEFAULT '', task_type text NOT NULL DEFAULT '', due_at timestamptz,
 completed_at timestamptz, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_opportunities_board ON crm_opportunities(pipeline_id,updated_at,id);
CREATE INDEX IF NOT EXISTS crm_tasks_due ON crm_tasks(opportunity_id,due_at,id);
CREATE TABLE IF NOT EXISTS crm_changes (
 id bigserial PRIMARY KEY, entity text NOT NULL, entity_id uuid NOT NULL, previous_value jsonb, new_value jsonb NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL DEFAULT 'anonymous'
);`;
const initialized = new WeakMap();
export async function ensureWorkspace(pool) {
  if (!pool) throw new CrmError(503, 'crm_unavailable');
  if (!initialized.has(pool)) initialized.set(pool, (async () => {
    await ensureLinks(pool);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // Serialize startup across backend workers/instances.
      await c.query('SELECT pg_advisory_xact_lock(162472220)');
      await c.query(schema);
      for (const p of catalog.pipelines) {
        await c.query('INSERT INTO crm_pipelines(id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.id,p.name]);
        for (const s of p.stages) await c.query('INSERT INTO crm_stages(pipeline_id,id,name,display_order,completed) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [p.id,s.id,s.name,s.displayOrder,s.completed]);
      }
      await c.query('COMMIT');
    } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  })().catch(e => { initialized.delete(pool); throw e; }));
  await initialized.get(pool);
}
async function transaction(pool, fn) {
  await ensureWorkspace(pool); const c = await pool.connect();
  try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
  catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
async function audit(c, entity, id, before, after, actor = 'anonymous') {
  await c.query('INSERT INTO crm_changes(entity,entity_id,previous_value,new_value,actor) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)', [entity,id,JSON.stringify(before),JSON.stringify(after),actor]);
}
async function optionsExist(c, fields) {
  for (const [kind,value] of fields) if (value) {
    const r = await c.query('SELECT 1 FROM crm_options WHERE kind=$1 AND value=$2', [kind,value]);
    if (!r.rows.length) bad();
  }
}
const opportunity = row => ({ id: row.id, pipeline: row.pipeline_id, stage: row.stage_id, branch: row.branch, labels: row.labels, owner: row.owner, version: row.version, sourceConversationId: row.source_conversation_id || null,
  source: row.source_system || null, sourceId: row.source_id || null,
  details: row.details || {}, computed: computedDealDetails(row.details || {}), createdAt: row.created_at,
  stageChangedAt: row.stage_changed_at || null, closedAt: row.closed_at || null,
  nextTask:row.next_task || null, overdueTasks:Number(row.overdue_tasks || 0) });
const workspaceLinks = row => publicLinks(row) || {contact:null,conversations:[],record:null};
const task = row => ({ id: row.id, opportunityId: row.opportunity_id, title: row.title, owner: row.owner, type: row.task_type, due: row.due_at ? new Date(row.due_at).toISOString() : null, status: row.completed_at ? 'done' : 'pending', completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null, version: row.version });
export async function configuration(pool) {
  await ensureWorkspace(pool);
  const {rows} = await pool.query('SELECT kind,value FROM crm_options ORDER BY value');
  const usedBranches = (await pool.query("SELECT DISTINCT pipeline_id,branch FROM crm_opportunities WHERE branch<>'' ORDER BY branch")).rows;
  return { dealFields, pipelines: catalog.pipelines, usedBranches,
    owners: rows.filter(r=>r.kind==='owner').map(r=>r.value), taskTypes: rows.filter(r=>r.kind==='task_type').map(r=>r.value) };
}
export async function addOption(pool, input) {
  if (!['owner','task_type'].includes(input.kind)) bad();
  const value = text(input.value,80,true); await ensureWorkspace(pool);
  await pool.query('INSERT INTO crm_options(kind,value) VALUES ($1,$2) ON CONFLICT DO NOTHING',[input.kind,value]);
}
export async function saveOpportunity(pool, input, id = null, actor = 'anonymous') {
  if (id) { uuid(id); version(input.version); }
  else if (!/^\d+$/.test(String(input.contactId || ''))) bad();
  return transaction(pool, async c => {
    let before = null, result;
    if (id) {
      before = (await c.query('SELECT * FROM crm_opportunities WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!before) throw new CrmError(404,'not_found');
      if (before.version !== input.version) throw new CrmError(409,'changed_by_another_operator');
      const values = opportunityInput(input,before);
      await optionsExist(c,[['owner',values.owner]]);
      if (before.pipeline_id !== values.pipeline) bad();
      result = await c.query(`UPDATE crm_opportunities SET stage_id=$2,branch=$3,labels=$4::jsonb,owner=$5,details=details || $6::jsonb,
        stage_changed_at=CASE WHEN stage_id<>$2 THEN now() ELSE stage_changed_at END,
        closed_at=CASE WHEN $7 THEN CASE WHEN stage_id<>$2 THEN COALESCE(closed_at,now()) ELSE closed_at END ELSE NULL END,
        version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[id,values.stage,values.branch,JSON.stringify(values.labels),values.owner,JSON.stringify(values.details || {}),values.closed]);
    } else {
      const values = opportunityInput(input);
      await optionsExist(c,[['owner',values.owner]]);
      if (!(await c.query('SELECT 1 FROM crm_link_contacts WHERE contact_id=$1',[String(input.contactId)])).rows.length) throw new CrmError(404,'contact_not_imported');
      if (input.sourceConversationId != null) {
        if (!/^\d+$/.test(String(input.sourceConversationId))) bad();
        const linked = await c.query('SELECT 1 FROM crm_link_conversations WHERE conversation_id=$1 AND contact_id=$2 FOR SHARE',[String(input.sourceConversationId),String(input.contactId)]);
        if (!linked.rows.length) throw new CrmError(400,'conversation_contact_mismatch');
      }
      id = randomUUID();
      result = await c.query(`INSERT INTO crm_opportunities(id,contact_id,pipeline_id,stage_id,branch,labels,owner,source_conversation_id,details,stage_changed_at,closed_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,now(),CASE WHEN $10 THEN now() END) ON CONFLICT(contact_id,pipeline_id) DO NOTHING RETURNING *`,[id,String(input.contactId),values.pipeline,values.stage,values.branch,JSON.stringify(values.labels),values.owner,input.sourceConversationId == null ? null : String(input.sourceConversationId),JSON.stringify(values.details || {}),values.closed]);
      if (!result.rows.length) throw new CrmError(409,'already_in_pipeline');
    }
    await audit(c,'opportunity',id,before,result.rows[0],actor); return opportunity(result.rows[0]);
  });
}
export async function board(pool, query) {
  if (!catalog.pipelines.some(p=>p.id===query.pipeline)) bad();
  const month = query.month || '';
  if (typeof month !== 'string' || (month && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))) bad();
  const branch = text(query.branch || '',80), owner = text(query.owner || '',80), pageOffset = offset(query.offset);
  await ensureWorkspace(pool);
  const {rows} = await pool.query(`SELECT o.*,
    (SELECT jsonb_build_object('title',t.title,'due',t.due_at) FROM crm_tasks t WHERE t.opportunity_id=o.id AND t.completed_at IS NULL ORDER BY t.due_at ASC NULLS LAST,t.created_at,t.id LIMIT 1) AS next_task,
    (SELECT count(*) FROM crm_tasks t WHERE t.opportunity_id=o.id AND t.completed_at IS NULL AND t.due_at<now()) AS overdue_tasks,
    c.display_name,c.initials,c.contact_id,c.medinet_id,c.medinet_section,c.verified_at,
    ARRAY(SELECT conversation_id FROM crm_link_conversations v WHERE v.contact_id=c.contact_id ORDER BY last_seen DESC) conversation_ids
    FROM crm_opportunities o LEFT JOIN crm_link_contacts c ON c.contact_id=o.contact_id
    WHERE o.pipeline_id=$1 AND ($2='' OR o.branch=$2) AND ($3='' OR o.owner=$3)
    AND ($4='' OR (o.source_system='zendesk_sell' AND (o.created_at AT TIME ZONE 'America/Santiago')::date>=NULLIF($4,'')::date AND (o.created_at AT TIME ZONE 'America/Santiago')::date<(NULLIF($4,'')::date+interval '1 month'))
      OR (o.source_system IS DISTINCT FROM 'zendesk_sell' AND EXISTS(SELECT 1 FROM crm_link_activity a WHERE a.contact_id=c.contact_id AND a.activity_day>=NULLIF($4,'')::date AND a.activity_day<(NULLIF($4,'')::date+interval '1 month'))))
    ORDER BY o.created_at,o.id LIMIT 101 OFFSET $5`,[query.pipeline,branch,owner,month ? `${month}-01` : '',pageOffset]);
  return { items: rows.slice(0,100).map(r=>({...opportunity(r),links:workspaceLinks(r)})), more: rows.length>100 };
}
export async function saveTask(pool, input, id = null, actor = 'anonymous') {
  const values = taskInput(input);
  if (id) { uuid(id); version(input.version); } else uuid(input.opportunityId);
  return transaction(pool, async c => {
    await optionsExist(c,[['owner',values.owner],['task_type',values.type]]);
    let before = null,result;
    if (id) {
      before = (await c.query('SELECT * FROM crm_tasks WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!before) throw new CrmError(404,'not_found');
      if (before.version !== input.version) throw new CrmError(409,'changed_by_another_operator');
      result = await c.query(`UPDATE crm_tasks SET title=$2,owner=$3,task_type=$4,due_at=$5,
        completed_at=CASE WHEN $6='done' THEN COALESCE(completed_at,now()) ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[id,values.title,values.owner,values.type,values.due,values.status]);
    } else {
      if (!(await c.query('SELECT 1 FROM crm_opportunities WHERE id=$1',[input.opportunityId])).rows.length) throw new CrmError(404,'not_found');
      id = randomUUID();
      result = await c.query(`INSERT INTO crm_tasks(id,opportunity_id,title,owner,task_type,due_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7='done' THEN now() ELSE NULL END) RETURNING *`,[id,input.opportunityId,values.title,values.owner,values.type,values.due,values.status]);
    }
    await audit(c,'task',id,before,result.rows[0],actor); return task(result.rows[0]);
  });
}
export async function tasks(pool, query) {
  const id = query.opportunityId ? uuid(query.opportunityId) : '';
  const owner = text(query.owner || '',80), status = query.status || 'pending';
  if (!['pending','done','overdue','all'].includes(status)) bad();
  const pageOffset = offset(query.offset); await ensureWorkspace(pool);
  const {rows} = await pool.query(`SELECT t.*,c.display_name,c.initials,c.contact_id,c.medinet_id,c.medinet_section,c.verified_at,
    ARRAY(SELECT conversation_id FROM crm_link_conversations v WHERE v.contact_id=c.contact_id ORDER BY last_seen DESC) conversation_ids
    FROM crm_tasks t JOIN crm_opportunities o ON o.id=t.opportunity_id LEFT JOIN crm_link_contacts c ON c.contact_id=o.contact_id
    WHERE ($1='' OR t.opportunity_id=NULLIF($1,'')::uuid) AND ($2='' OR t.owner=$2)
    AND ($3='all' OR ($3='done' AND t.completed_at IS NOT NULL) OR ($3='pending' AND t.completed_at IS NULL)
      OR ($3='overdue' AND t.completed_at IS NULL AND t.due_at<now()))
    ORDER BY t.due_at ASC NULLS LAST,t.created_at,t.id LIMIT 101 OFFSET $4`,[id,owner,status,pageOffset]);
  return {items:rows.slice(0,100).map(r=>({...task(r),links:workspaceLinks(r)})),more:rows.length>100};
}

export async function conversationContact(pool, id) {
  if (!/^\d+$/.test(String(id || ''))) bad();
  await ensureWorkspace(pool);
  const {rows} = await pool.query(`SELECT c.display_name,c.initials,c.contact_id,c.medinet_id,c.medinet_section,c.verified_at,
    ARRAY[$1::text] AS conversation_ids FROM crm_link_conversations v JOIN crm_link_contacts c ON c.contact_id=v.contact_id WHERE v.conversation_id=$1`,[String(id)]);
  if (!rows.length) throw new CrmError(404,'conversation_not_imported');
  return {...publicLinks(rows[0]),sourceConversationId:String(id)};
}

export async function dealActivity(pool,id,query={}) {
  uuid(id);await ensureWorkspace(pool);
  if(!(await pool.query('SELECT 1 FROM crm_opportunities WHERE id=$1',[id])).rows.length)throw new CrmError(404,'not_found');
  const {rows}=await pool.query(`SELECT id::text,changed_at AS at,actor,entity AS kind,previous_value AS before,new_value AS after,NULL::text AS body
    FROM crm_changes WHERE (entity='opportunity' AND entity_id=$1) OR (entity='task' AND new_value->>'opportunity_id'=$1::text)
    UNION ALL SELECT id::text,created_at AS at,actor,'note' AS kind,NULL::jsonb,NULL::jsonb,body FROM crm_deal_notes WHERE opportunity_id=$1
    ORDER BY at DESC,id DESC LIMIT 101 OFFSET $2`,[id,offset(query.offset)]);
  return {items:rows.slice(0,100).map(r=>({id:r.id,at:r.at,actor:r.actor==='anonymous'?null:r.actor,kind:r.kind,body:r.body,
    title:r.kind==='note'?'Nota interna':r.kind==='task'?(r.after.completed_at?'Tarea completada':r.before?'Tarea actualizada':'Tarea creada'):
      !r.before?'DEAL creado':r.before.stage_id!==r.after.stage_id?'Cambio de fase':'Datos actualizados',
    stage:r.kind==='opportunity'?r.after.stage_id:null,task:r.kind==='task'?r.after.title:null})),more:rows.length>100};
}
export async function addDealNote(pool,id,input,actor) {
  uuid(id);if(typeof input?.body!=='string'||!input.body.trim()||input.body.length>10000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.body))bad();
  if(!actor)throw new CrmError(401,'authentication_required');
  return transaction(pool,async c=>{if(!(await c.query('SELECT 1 FROM crm_opportunities WHERE id=$1 FOR SHARE',[id])).rows.length)throw new CrmError(404,'not_found');
    const noteId=randomUUID();await c.query('INSERT INTO crm_deal_notes(id,opportunity_id,body,actor) VALUES($1,$2,$3,$4)',[noteId,id,input.body.trim(),actor]);return {id:noteId,saved:true};});
}
