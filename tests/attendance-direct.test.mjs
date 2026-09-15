import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {directAttendanceRouter} from '../review/attendance-direct.js';
import {notifyReconciledCompletion,choiceFromVisibleText,parsePreferredDateTime,rankSlotsNearPreference,pickDiverseSlots} from '../melania/direct-reschedule.js';
test('dashboard proxy keeps token server-side and propagates only report JSON',async()=>{
 let seen;const app=express();app.use(directAttendanceRouter({env:{CONFIRMATIONS_INTAKE_TOKEN:'synthetic'},fetchImpl:async(url,opts)=>{seen={url,opts};return {ok:true,json:async()=>({items:[],attention:[],mode:'test'})};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/?date=invalid')).status,400);assert.equal(seen,undefined);
 const r=await fetch(base+'/?date=2026-09-15');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.equal(seen.opts.headers.Authorization,'Bearer synthetic');assert.equal((await r.text()).includes('synthetic'),false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('missing gateway config cannot appear as an empty successful report',async()=>{
 const app=express();app.use(directAttendanceRouter({env:{}}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/?date=2026-09-15`);assert.equal(r.status,503);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('reconciliation notifier posts only external id with server-side bearer',async()=>{
 let seen;const env={CONFIRMATIONS_INTAKE_TOKEN:'synthetic',SELL_MEDINET_BACKEND_URL:'https://backend.example'};
 const result=await notifyReconciledCompletion(990000001,{env,fetchImpl:async(url,opts)=>{seen={url,opts};return {ok:true,status:200,json:async()=>({sent:true,duplicate:false})};}});
 assert.equal(result.sent,true);assert.equal(seen.url,'https://backend.example/attendance-direct/completion');
 assert.equal(seen.opts.headers.Authorization,'Bearer synthetic');assert.deepEqual(JSON.parse(seen.opts.body),{externalId:990000001});assert.equal(seen.opts.body.includes('Rodrigo'),false);
});
test('reconciliation notifier fails closed without bearer',async()=>{
 await assert.rejects(notifyReconciledCompletion(990000001,{env:{},fetchImpl:async()=>{throw Error('should not call');}}),/token_missing/);
});


test('Chatwoot visible list title resolves to the exact stored slot',()=>{
 const slots=[
  {dataDia:'2026-09-17',date:'17/09/2026',time:'11:00'},
  {dataDia:'2026-09-21',date:'21/09/2026',time:'10:20'},
 ];
 assert.equal(choiceFromVisibleText('17/09/2026 · 11:00',slots),0);
 assert.equal(choiceFromVisibleText('21/09/2026 · 10:20',slots),1);
 assert.equal(choiceFromVisibleText('21/09/2026 · 10:40',slots),null);
});

test('preferred date/time parser accepts RedSalud-style dd/mm hh:mm',()=>{
 const now=new Date('2026-09-15T03:00:00Z');
 assert.deepEqual(parsePreferredDateTime('18/09 15:30',now),{dataDia:'2026-09-18',time:'15:30'});
 assert.deepEqual(parsePreferredDateTime('18/09/2026 9:05',now),{dataDia:'2026-09-18',time:'09:05'});
 assert.equal(parsePreferredDateTime('31/02 10:00',now),null);
});

test('diverse and preferred slots are returned in chronological display order',()=>{
 const slots=[
  {dataDia:'2026-09-17',time:'11:00'},
  {dataDia:'2026-09-17',time:'12:20'},
  {dataDia:'2026-09-17',time:'12:40'},
  {dataDia:'2026-09-21',time:'10:20'},
  {dataDia:'2026-09-21',time:'10:40'},
  {dataDia:'2026-09-21',time:'11:00'},
 ];
 assert.deepEqual(pickDiverseSlots(slots,6).map(s=>`${s.dataDia} ${s.time}`),[
  '2026-09-17 11:00','2026-09-17 12:20','2026-09-17 12:40','2026-09-21 10:20','2026-09-21 10:40','2026-09-21 11:00'
 ]);
 assert.deepEqual(rankSlotsNearPreference(slots,{dataDia:'2026-09-20',time:'12:00'},3).map(s=>`${s.dataDia} ${s.time}`),[
  '2026-09-21 10:20','2026-09-21 10:40','2026-09-21 11:00'
 ]);
});
