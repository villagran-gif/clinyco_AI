import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import { ensureControlSchema, createControlStore, controlKey } from '../conversation/control.js';
import { antoniaControlRouter } from '../review/antonia-control-router.js';
import { reviewAuth, REVIEW_SITE_ORIGIN } from '../review/auth.js';

async function fixture(t) {
  const db = new PGlite();
  await db.exec("CREATE TABLE conversations(conversation_id text PRIMARY KEY,state_json jsonb DEFAULT '{}')");
  // Serialize database transactions for the WASM engine; external send work remains concurrent.
  let tail = Promise.resolve();
  const pool = {query: (sql, params) => params ? db.query(sql,params) : db.exec(sql).then(()=>({rows:[]})),
    async connect() {
      const previous = tail; let release; tail = new Promise(resolve => {release=resolve}); await previous;
      return {query:pool.query,release};
    }};
  await ensureControlSchema(pool);
  t.after(()=>db.close());
  const store = createControlStore(()=>pool);
  const key = controlKey('162472','123');
  const pause = (revision=0,eventId='take-1') => store.change(key,{mode:'human_active',actor:'human:1',reason:'atencion',eventId,expectedRevision:revision});
  const resume = (revision=1,eventId='resume-1') => store.change(key,{mode:'bot_active',actor:'human:1',reason:'terminada',eventId,expectedRevision:revision});
  return {db,pool,store,key,pause,resume};
}

test('R11/R16: human pause survives time, a new store and stale snapshot writes',async t=>{
  const {db,pool,store,key,pause}=await fixture(t);
  await pause();
  await db.query("UPDATE antonia_control SET changed_at=now()-interval '3 hours'");
  await db.query("INSERT INTO conversations VALUES('cw:123','{\"system\":{\"aiEnabled\":true,\"humanTakenOver\":false}}')");
  const restarted=createControlStore(()=>pool);
  assert.equal((await restarted.read(key)).mode,'human_active');
  await assert.rejects(restarted.assertActive(key,0),/human_control/);
  assert.equal((await store.read(key)).revision,1);
});
test('R11: adopt an expired legacy human pause conservatively',async t=>{
  const {db,store,key}=await fixture(t);
  await db.query("INSERT INTO conversations VALUES('cw:123','{\"system\":{\"humanTakenOver\":true,\"humanPauseUntil\":\"2000-01-01\"}}')");
  assert.equal((await store.read(key)).mode,'human_active');
});
test('R23: takeover invalidates a generated plan, even after explicit resume',async t=>{
  const {store,key,pause,resume}=await fixture(t); let sent=0;
  await store.read(key); await pause(); await resume();
  await assert.rejects(store.send(key,0,'text',async()=>{sent++;return {messageId:1}}),/stale_plan/);
  assert.equal(sent,0); assert.equal((await store.read(key)).revision,2);
});
test('R24/R30: stop later bubbles and handoff acknowledgements; keep earlier receipts',async t=>{
  const {store,key,pause,db}=await fixture(t);
  await store.send(key,0,'text',async()=>({messageId:101}));
  await pause();
  for (const kind of ['text','audio','booking','handoff_ack'])
    await assert.rejects(store.send(key,0,kind,async()=>assert.fail('unauthorized effect')),/human_control/);
  assert.equal((await db.query('SELECT message_id FROM antonia_control_sends')).rows[0].message_id,'101');
});
test('R29: pause during POST is pending until acceptance, and blocks reactivation',async t=>{
  const {store,key,pause,resume}=await fixture(t);
  let finish, started; const begun=new Promise(resolve=>started=resolve);
  const pending=store.send(key,0,'text',()=>{started();return new Promise(resolve=>finish=resolve)});
  await begun;
  assert.equal((await pause()).pause_status,'pause_pending');
  await assert.rejects(resume(),/reconciliation_required/);
  finish({messageId:202}); await pending;
  assert.equal((await store.read(key)).pause_status,'pause_confirmed');
  assert.equal((await resume()).mode,'bot_active');
});
test('R29: timeout or missing receipt remains uncertain across restart, no replay',async t=>{
  const {store,key,pause,resume,pool}=await fixture(t);
  await assert.rejects(store.send(key,0,'audio',async()=>{throw new Error('timeout')}),/timeout/);
  assert.equal((await pause()).pause_status,'pause_pending');
  assert.equal((await createControlStore(()=>pool).read(key)).pending[0].status,'uncertain');
  await assert.rejects(resume(),/reconciliation_required/);
  await assert.rejects(store.send(controlKey('162472','124'),0,'text',async()=>({messageId:null})),/reconciliation_required/);
});
test('duplicate takeover cannot re-pause after resume; stale revision and reused key conflict',async t=>{
  const {store,key,pause,resume}=await fixture(t);
  await pause(); await pause(); assert.equal((await store.read(key)).revision,1);
  await resume(); assert.equal((await pause()).mode,'bot_active');
  await assert.rejects(pause(0,'take-2'),/stale_control_revision/);
  await assert.rejects(store.change(key,{mode:'bot_active',actor:'human:1',reason:'changed',eventId:'take-1',expectedRevision:2}),/idempotency_conflict/);
});
test('human webhook pauses without a stale UI revision; cannot authorize resume',async t=>{
  const {store,key}=await fixture(t);
  const input={actor:'chatwoot:2',reason:'message',eventId:'msg:1',humanEvent:true};
  assert.equal((await store.change(key,{...input,mode:'human_active'})).mode,'human_active');
  await assert.rejects(store.change(key,{...input,mode:'bot_active'}),/invalid_human_event/);
});
test('R16: unavailable DB blocks reads and effects',async()=>{
  let effects=0; const store=createControlStore(()=>null); const key=controlKey('162472','123');
  await assert.rejects(store.read(key),/unavailable/);
  await assert.rejects(store.send(key,0,'text',async()=>{effects++}),/unavailable/);
  assert.equal(effects,0);
});
test('authenticated router: reject anonymous, foreign origin, forged actor, stale revision',async t=>{
  const {pool}=await fixture(t); const app=express(); app.use(express.json());
  app.use(reviewAuth({allowedEmails:()=> 'operator@example.test',fetchImpl:async()=>Response.json({id:'trusted',email:'operator@example.test',confirmed_at:'2026-01-01'})}));
  app.use('/control',antoniaControlRouter({getPool:()=>pool}));
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/control/123/control`;
  assert.equal((await fetch(url)).status,401);
  const headers={authorization:'Bearer test.token',origin:REVIEW_SITE_ORIGIN,'Content-Type':'application/json'};
  const body=JSON.stringify({action:'pause',reason:'testing',requestId:'request-1',expected_revision:0,actor:'forged'});
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,origin:'https://evil.example'},body})).status,403);
  const response=await fetch(url,{method:'POST',headers,body}); assert.equal(response.status,200);
  assert.equal((await response.json()).actor,'identity:trusted');
  const stale=await fetch(url,{method:'POST',headers,body:JSON.stringify({action:'resume',reason:'testing',requestId:'request-2',expected_revision:0})});
  assert.equal(stale.status,409);
});
