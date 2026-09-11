import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeDealUrl,normalizeEmail,normalizePhone} from '../review/deal-link-normalizers.js';
import {prepareSellDeal,restoreSell2026,RESTORE_ID} from '../review/sell-restore.js';
import {board,configuration,ensureWorkspace,saveOpportunity,saveTask,tasks,addDealNote,dealActivity} from '../review/crm-workspace.js';

const medical='https://clinyco.medinetapp.com/pacientes/ficha/00000000-0000-4000-8000-000000000123/1/';
const drive='https://drive.google.com/drive/folders/example';
const raw=(id,pipeline=1290779,stage=10693252)=>({deal_id:String(id),deal_name:`Prueba ${id}`,pipeline_id:pipeline,stage_id:stage,added_at:'2026-03-31',fecha_cambio_fase:'2026-03-31',fecha_cierre:null,contact_id:'900',contact_phone:'+56 9 1234 5678',contact_email:'patient@example.test',url_medinet:medical,owner_name:'Operador de prueba',sucursal:'Clínica de origen'});
const csvRow={source:'fixture.csv',row:{'Nombre del trato':'No debe reemplazar el nombre reciente','URL-MEDINET':'https://evil.example/patient','URL-EXAMENES':'https://drive.google.com/drive/u/3/folders/example?usp=sharing','Peso':'90','Estatura':'1,80','Valor':'1850000.00','Moneda':'CLP','Etiquetas':'Seguimiento;Evaluación','Fecha de nacimiento':'1990-03-01','WhatsApp_Contactar_LINK':'https://wa.me/','RUT o ID':'12.345.678-5'}};

test('normalizes destination formats without inventing IDs or accepting unsafe links',()=>{
  assert.equal(normalizeDealUrl('medinetUrl',medical+'2/3/'),medical);
  assert.equal(normalizeDealUrl('medinetUrl',medical.replace('https:','http:')),medical);
  assert.equal(normalizeDealUrl('medinetUrl',medical.replace('https://','')),medical);
  assert.equal(normalizeDealUrl('examsUrl','https://drive.google.com/drive/u/2/folders/example?usp=sharing&resourcekey=abc_123'),drive+'?resourcekey=abc_123');
  assert.equal(normalizeDealUrl('examsUrl','https://drive.google.com/open?id=example'),'https://drive.google.com/file/d/example/view');
  for(const u of ['javascript:alert(1)','https://drive.google.com.evil.test/drive/folders/example','https://user:pass@drive.google.com/drive/folders/example','https://drive.google.com/','IMC 29','https://drive.google.com/drive/folders/{{deal.id}}'])assert.equal(normalizeDealUrl('examsUrl',u),null);
  for(const u of ['V',medical.replace('clinyco','inyco'),medical+'?redirect=https://evil.test',medical+'#tab'])assert.equal(normalizeDealUrl('medinetUrl',u),null);
  assert.equal(normalizeDealUrl('chatwootUrl','https://app.chatwoot.com/app/accounts/162472/conversations/123/'),'https://app.chatwoot.com/app/accounts/162472/conversations/123');
  assert.equal(normalizeDealUrl('chatwootUrl','https://app.chatwoot.com/app/accounts/1/conversations/123'),null);
  for(const p of ["'+56 9 1234 5678",'9 1234 5678','0056912345678'])assert.equal(normalizePhone(p),'+56912345678');
  for(const p of ['12345678','Fecha de nacimiento','19/05/1991','+12.345.678-5','+56','+56012345678','9+12345678','+56++9'])assert.equal(normalizePhone(p),null);
  assert.equal(normalizeEmail(' mailto:patient@EXAMPLE.TEST '),'patient@example.test');
  assert.equal(normalizeEmail('patient@example.test?subject=bad'),null);
});

test('merges only same-ID sources, preserves raw rejected fields and derives safe communication links',()=>{
  const result=prepareSellDeal({deal:raw(100),cache:{currency:'USD',value:'22'}},[csvRow]);
  assert.equal(result.details.dealName,'Prueba 100');
  assert.equal(result.details.value,1850000);
  assert.equal(result.details.height,180);
  assert.equal(result.details.examsUrl,drive);
  assert.equal(result.details.medinetUrl,medical);
  assert.equal(result.details.idDocument,'12345678-5');
  assert.equal(result.details.phone,'+56912345678');
  assert.equal(result.payload.csv[0].row.WhatsApp_Contactar_LINK,'https://wa.me/');
  assert.ok(result.payload.issues.some(i=>i.reason==='currency_not_clp'));
  assert.equal(result.createdAt,'2026-03-31T03:00:00.000Z');
  assert.equal(result.closedAt,null);
  const invalid=prepareSellDeal({deal:{...raw(101),url_medinet:'V',contact_phone:'+fecha',contact_email:'invalid'}});
  assert.equal(invalid.details.medinetUrl,undefined);assert.equal(invalid.details.phone,undefined);assert.equal(invalid.details.email,undefined);
  assert.throws(()=>prepareSellDeal({deal:{...raw(101),stage_id:9999}}),/unmapped/);
  assert.throws(()=>prepareSellDeal({deal:{...raw(101),added_at:'2025-12-31'}}),/year/);
});

test('restoration is atomic, idempotent and usable without importing contacts',{skip:!process.env.CRM_TEST_PGLITE_PATH},async()=>{
  const {PGlite}=await import(process.env.CRM_TEST_PGLITE_PATH);const db=new PGlite();
  let failAudit=false;
  const pool={query:async(sql,params)=>{
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(failAudit && sql.includes('INSERT INTO crm_changes'))throw new Error('injected_failure');
    if(!params && sql.includes('CREATE TABLE')){await db.exec(sql);return {rows:[]};}
    return db.query(sql,params);
  },connect:async()=>({query:pool.query,release(){}})};
  try {
    await ensureWorkspace(pool);
    await db.exec(`CREATE TABLE deals(deal_id text PRIMARY KEY,deal_name text,pipeline_id integer,stage_id integer,added_at date,fecha_cambio_fase date,fecha_cierre date,contact_id text,contact_phone text,contact_email text,url_medinet text,owner_name text,sucursal text);
      CREATE TABLE sell_deals_cache(deal_id bigint PRIMARY KEY);
      INSERT INTO crm_link_contacts(contact_id,initials,last_seen) VALUES('1','X.',now());`);
    const existing=await saveOpportunity(pool,{contactId:'1',pipeline:'bariatrica',stage:'bariatrica_1',details:{dealName:'Actual'},owner:'',branch:'',labels:[]});
    for(const row of [raw(100),raw(101),raw(102,5049979,37619391),{...raw(103),added_at:'2025-12-31'}]){
      await db.query(`INSERT INTO deals(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));
    }
    const options={expectedPipelines:{bariatrica:2,general:1},csv:{byId:new Map([['100',[csvRow]],['101',[csvRow]]]),hashes:{}}};
    const dry=await restoreSell2026(pool,options);assert.equal(dry.candidates,3);assert.equal(dry.dryRun,true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_opportunities')).rows[0].n,1);
    await assert.rejects(restoreSell2026(pool,{...options,apply:true,expectedPipelines:{bariatrica:3}}),/counts_changed/);
    failAudit=true;await assert.rejects(restoreSell2026(pool,{...options,apply:true}),/injected_failure/);failAudit=false;
    assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_opportunities')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_sell_restore_runs')).rows[0].n,0);
    const result=await restoreSell2026(pool,{...options,apply:true});assert.equal(result.inserted,3);assert.equal(result.contactsCreated,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_link_contacts')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_opportunities')).rows[0].n,4);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_opportunities WHERE contact_id IS NULL')).rows[0].n,3);
    const b=await board(pool,{pipeline:'bariatrica',month:'2026-03'});assert.equal(b.items.length,2);
    assert.equal((await board(pool,{pipeline:'bariatrica',month:'2026-02'})).items.length,0);
    assert.doesNotMatch(JSON.stringify(b),/source_payload|fixture\.csv|evil\.example|900/);
    const op=b.items.find(item=>item.sourceId==='100');
    assert.ok(op);assert.equal(op.links.contact,null);
    const edited=await saveOpportunity(pool,{...op,stage:'bariatrica_2',details:{...op.details,city:'Nueva ciudad'}},op.id,'operator@example.test');
    assert.deepEqual(edited.labels,['Seguimiento','Evaluación']);assert.equal(edited.branch,'Clínica de origen');
    await assert.rejects(saveOpportunity(pool,{...edited,labels:['Etiqueta inventada']},op.id),e=>e.status===400);
    await addDealNote(pool,op.id,{body:'Nota nueva'},'operator@example.test');assert.ok((await dealActivity(pool,op.id)).items.some(i=>i.body==='Nota nueva'));
    await saveTask(pool,{opportunityId:op.id,title:'Tarea nueva',status:'pending'});assert.equal((await tasks(pool,{opportunityId:op.id})).items.length,1);
    const repeated=await restoreSell2026(pool,{...options,apply:true});assert.equal(repeated.alreadyCompleted,true);
    assert.equal((await db.query('SELECT details FROM crm_opportunities WHERE id=$1',[op.id])).rows[0].details.city,'Nueva ciudad');
    assert.equal((await db.query('SELECT details FROM crm_opportunities WHERE id=$1',[existing.id])).rows[0].details.dealName,'Actual');
    assert.equal((await db.query('SELECT id FROM crm_sell_restore_runs')).rows[0].id,RESTORE_ID);
    if(process.env.CRM_TEST_JSDOM_PATH){
      const {JSDOM}=await import(process.env.CRM_TEST_JSDOM_PATH);
      const dom=new JSDOM(await readFile(new URL('../review/site/index.html',import.meta.url),'utf8'),{url:'https://clinyco-ai.netlify.app/',runScripts:'outside-only'}),w=dom.window;
      w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
      w.fetch=async url=>{const parsed=new URL(url,'https://clinyco-ai.netlify.app');const q=Object.fromEntries(parsed.searchParams);let data;
        if(parsed.pathname.endsWith('/config'))data=await configuration(pool);
        else if(parsed.pathname.endsWith('/opportunities'))data=await board(pool,q);
        else if(parsed.pathname.endsWith('/tasks'))data=await tasks(pool,q);
        else if(parsed.pathname.endsWith('/activity'))data={items:[],more:false};
        else throw new Error('unexpected_request');
        return {ok:true,json:async()=>data};};
      w.eval(await readFile(new URL('../review/site/crm-workspace.js',import.meta.url),'utf8'));await w.loadCrmWorkspace();
      assert.match(w.document.getElementById('crm-workspace-state').textContent,/3 DEALS/);
      [...w.document.querySelectorAll('.crm-deal-name')].find(b=>b.textContent==='Prueba 100').click();
      assert.ok(w.document.getElementById('crm-op-dialog').open);
      for(const href of [medical,drive,'tel:+56912345678','https://wa.me/56912345678','mailto:patient%40example.test'])assert.ok(w.document.querySelector(`a[href="${href}"]`),href);
      assert.match(w.document.getElementById('crm-deal-computed').textContent,/ID del trato100/);
      assert.equal(w.document.getElementById('crm-record-conversations').textContent,'Sin conversaciones vinculadas');
      w.document.getElementById('crm-record-edit').click();assert.equal(w.document.getElementById('crm-op-form').elements.branch.value,'Clínica de origen');
      for(let tries=0;tries<100 && (w.document.getElementById('crm-activity-refresh').disabled || !w.document.getElementById('crm-record-tasks').textContent.includes('Tarea nueva'));tries++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.match(w.document.getElementById('crm-record-tasks').textContent,/Tarea nueva/);
      assert.equal(w.document.getElementById('crm-activity-refresh').disabled,false);
      dom.window.close();
    }
  } finally {await db.close();}
});
