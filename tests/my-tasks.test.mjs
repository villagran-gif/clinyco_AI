import test from 'node:test';
import assert from 'node:assert/strict';
import {myTasks,saveMyTaskOwner} from '../review/my-tasks.js';
import {ensureWorkspace} from '../review/crm-workspace.js';
const path=process.env.CRM_TEST_PGLITE_PATH;
test('personal task counts use an explicit owner mapping and Chile completion day',{skip:!path},async()=>{
  const {PGlite}=await import(path),db=new PGlite();
  const pool={query:async(sql,params)=>{
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(!params&&sql.includes('CREATE TABLE')){await db.exec(sql);return {rows:[]};}
    return db.query(sql,params);
  },connect:async()=>({query:pool.query,release(){}})};
  try{
    await ensureWorkspace(pool);
    await pool.query("INSERT INTO crm_options(kind,value) VALUES('owner','Agente Uno'),('owner','Agente Dos')");
    const unconfigured=await myTasks(pool,'one@example.test');assert.equal(unconfigured.configured,false);assert.equal(unconfigured.counts,null);
    await assert.rejects(myTasks(pool,null),e=>e.status===401);
    await assert.rejects(saveMyTaskOwner(pool,'one@example.test','Inventado'),e=>e.status===400);
    await saveMyTaskOwner(pool,'ONE@example.test','Agente Uno');
    await saveMyTaskOwner(pool,'two@example.test','Agente Dos');
    const op='11111111-1111-4111-8111-111111111111';
    await pool.query("INSERT INTO crm_opportunities(id,pipeline_id,stage_id,details) VALUES($1,'bariatrica','bariatrica_1','{\"dealName\":\"Demo\"}')",[op]);
    await pool.query(`INSERT INTO crm_tasks(id,opportunity_id,title,owner,due_at,completed_at) VALUES
      ('11111111-1111-4111-8111-111111111112',$1,'Overdue','Agente Uno',now()-interval '1 hour',NULL),
      ('11111111-1111-4111-8111-111111111113',$1,'Soon','Agente Uno',now()+interval '1 day',NULL),
      ('11111111-1111-4111-8111-111111111114',$1,'No date','Agente Uno',NULL,NULL),
      ('11111111-1111-4111-8111-111111111115',$1,'Later','Agente Uno',now()+interval '8 days',NULL),
      ('11111111-1111-4111-8111-111111111116',$1,'Done today','Agente Uno',NULL,now()),
      ('11111111-1111-4111-8111-111111111117',$1,'Done yesterday','Agente Uno',NULL,now()-interval '1 day'),
      ('11111111-1111-4111-8111-111111111118',$1,'Someone else','Agente Dos',now()-interval '1 hour',NULL)`,[op]);
    const data=await myTasks(pool,'one@example.test');assert.deepEqual(data.counts,{pending:4,overdue:1,upcoming:1,undated:1,completed:1});
    assert.equal(data.items.length,5);assert.ok(data.items.every(t=>t.owner==='Agente Uno'));assert.ok(!data.items.some(t=>t.title==='Done yesterday'));
    const other=await myTasks(pool,'two@example.test');assert.equal(other.counts.pending,1);assert.equal(other.counts.completed,0);
    await saveMyTaskOwner(pool,'one@example.test','Agente Dos');assert.equal((await myTasks(pool,'one@example.test')).counts.pending,1);
  }finally{await db.close();}
});
