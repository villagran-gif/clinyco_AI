import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ensureWorkspace, configuration, addOption, saveOpportunity, board, saveTask, tasks } from '../review/crm-workspace.js';
import express from 'express';
import { workspaceRouter } from '../review/crm-workspace-router.js';
import { publicLinks, recordContactEvent } from '../review/crm-links.js';
const enabled = !!process.env.CRM_TEST_PGLITE_PATH;
test('CRM persists opportunities, assignments, stages and task lifecycle without exposing source identity', {skip:!enabled}, async () => {
  const { PGlite } = await import(process.env.CRM_TEST_PGLITE_PATH);
  const db = new PGlite();
  const pool = { query: async(sql,params) => {
    // WASM PostgreSQL is single-process; advisory locks are only relevant to the production multi-worker pool.
    if (sql.includes('pg_advisory_xact_lock')) return {rows:[]};
    if (!params && sql.includes('CREATE TABLE')) { await db.exec(sql); return {rows:[]}; }
    return db.query(sql,params);
  }, connect:async()=>({query:pool.query,release(){}}) };
  try {
    await ensureWorkspace(pool); await ensureWorkspace(pool);
    await pool.query("INSERT INTO crm_link_contacts(contact_id,initials,last_seen,rut_normalized) VALUES ('123','A. B.',now(),'PRIVATE_RUT')");
    const event = (name, stamp) => ({event:'message_created',account:{id:162472},message_type:'incoming',created_at:stamp,sender:{id:123,name},conversation:{id:456}});
    await recordContactEvent(pool,event('Nombre reciente','2026-09-10T12:00:00Z'));
    await recordContactEvent(pool,event('Nombre antiguo','2026-09-09T12:00:00Z'));
    await recordContactEvent(pool,event('','2026-09-11T12:00:00Z'));
    assert.equal((await pool.query("SELECT display_name FROM crm_link_contacts WHERE contact_id='123'")).rows[0].display_name,'Nombre reciente');
    await pool.query("INSERT INTO crm_link_activity(contact_id,activity_day) VALUES ('123','2026-09-10') ON CONFLICT DO NOTHING");
    await addOption(pool,{kind:'owner',value:'Ejecutiva de prueba'});
    await addOption(pool,{kind:'task_type',value:'Seguimiento'});
    const cfg=await configuration(pool); assert.equal(cfg.pipelines.length,3);
    const input={contactId:'123',pipeline:'bariatrica',stage:'bariatrica_1',branch:'Santiago',labels:['Conversión'],owner:'Ejecutiva de prueba'};
    const op=await saveOpportunity(pool,input);
    await assert.rejects(saveOpportunity(pool,input),e=>e.status===409);
    await assert.rejects(saveOpportunity(pool,{...input,stage:'balon_1'}),e=>e.status===400);
    await assert.rejects(saveOpportunity(pool,{...input,branch:'Inventada'}),e=>e.status===400);
    const moved=await saveOpportunity(pool,{...input,stage:'bariatrica_5',version:op.version},op.id);
    assert.equal(moved.version,2);
    await assert.rejects(saveOpportunity(pool,{...input,version:op.version},op.id),e=>e.status===409);
    let b=await board(pool,{pipeline:'bariatrica',month:'2026-09',branch:'Santiago'});
    assert.equal(b.items[0].links.contact.text,"Nombre reciente");assert.equal(b.items.length,1);assert.equal(b.items[0].stage,'bariatrica_5');
    assert.doesNotMatch(JSON.stringify(b),/PRIVATE_RUT|rut_normalized/);
    assert.equal((await board(pool,{pipeline:'bariatrica',month:'2026-08'})).items.length,0);
    assert.equal((await board(pool,{pipeline:'bariatrica',branch:'Calama'})).items.length,0);
    const t=await saveTask(pool,{opportunityId:op.id,title:'Confirmar documentos',owner:'Ejecutiva de prueba',type:'Seguimiento',status:'pending',due:'2020-01-01T12:00:00Z'});
    assert.equal((await tasks(pool,{status:'overdue'})).items.length,1);
    const done=await saveTask(pool,{...t,status:'done'},t.id);assert.ok(done.completedAt);
    assert.equal((await tasks(pool,{status:'overdue'})).items.length,0);
    await assert.rejects(saveTask(pool,{...t,status:'pending'},t.id),e=>e.status===409);
    const reopened=await saveTask(pool,{...done,status:'pending',due:'2090-01-01T12:00:00Z'},t.id);
    assert.equal(reopened.completedAt,null); assert.equal((await tasks(pool,{status:'pending'})).items.length,1);
    const audit=await pool.query('SELECT * FROM crm_changes');assert.equal(audit.rows.length,5);
    assert.ok(audit.rows.every(r=>r.actor==='anonymous'));
    const app=express();
    app.use('/crm',workspaceRouter({getPool:()=>pool,enabled:()=>true,allowedOrigins:()=>['https://clinyco-ai.netlify.app']}));
    const server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const root=`http://127.0.0.1:${server.address().port}/crm`;
    try {
      const read=await fetch(`${root}/opportunities?pipeline=bariatrica`);
      assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');
      assert.equal((await read.json()).items.length,1);
      const denied=await fetch(`${root}/options`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:JSON.stringify({kind:'owner',value:'No'})});
      assert.equal(denied.status,403);
      const accepted=await fetch(`${root}/options`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://clinyco-ai.netlify.app'},body:JSON.stringify({kind:'owner',value:'Otra ejecutiva'})});
      assert.equal(accepted.status,200);
      const invalid=await fetch(`${root}/tasks/not-a-uuid`,{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://clinyco-ai.netlify.app'},body:JSON.stringify({...t,version:1})});
      assert.equal(invalid.status,400);
      if (process.env.CRM_TEST_JSDOM_PATH) {
        const {JSDOM}=await import(process.env.CRM_TEST_JSDOM_PATH);
        const html=await readFile(new URL('../review/site/index.html',import.meta.url),'utf8');
        const dom=new JSDOM(html,{url:'https://clinyco-ai.netlify.app/',runScripts:'outside-only'});
        const w=dom.window;
        w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
        w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
        w.fetch=(url,options={})=>fetch(String(url).replace('/api/crm/workspace',root),{...options,headers:{...options.headers,Origin:'https://clinyco-ai.netlify.app'}});
        w.eval(await readFile(new URL('../review/site/crm-workspace.js',import.meta.url),'utf8'));
        await w.loadCrmWorkspace();
        assert.equal(w.document.querySelectorAll('.crm-column').length,8);
        assert.equal(w.document.querySelectorAll('.crm-card').length,1);
        const edit=[...w.document.querySelectorAll('.crm-card button')].find(b=>b.textContent==='Editar etapa');edit.click();
        const form=w.document.getElementById('crm-op-form');
        assert.ok(w.document.getElementById('crm-op-dialog').open);
        form.elements.stage.value='bariatrica_6';
        await form.onsubmit({preventDefault(){},currentTarget:form});
        assert.equal((await board(pool,{pipeline:'bariatrica'})).items[0].stage,'bariatrica_6');
        assert.equal(w.document.querySelector('[data-stage="bariatrica_6"] .crm-card')!==null,true);
        [...w.document.querySelectorAll('.crm-card button')].find(b=>b.textContent==='Nueva tarea').click();
        const taskForm=w.document.getElementById('crm-task-form');taskForm.elements.title.value='Seguimiento de prueba';
        taskForm.elements.due.value='2026-09-12T10:00';
        await taskForm.onsubmit({preventDefault(){},currentTarget:taskForm});
        assert.equal((await tasks(pool,{status:'pending'})).items.length,2);
        assert.match(w.document.getElementById('crm-tasks').textContent,/Seguimiento de prueba/);
        dom.window.close();
      }
    } finally { await new Promise(resolve=>server.close(resolve)); }
    assert.deepEqual(Object.keys(publicLinks({contact_id:'123',initials:'A. B.'})),['contact','conversations','record']);
  } finally { await db.close(); }
});
