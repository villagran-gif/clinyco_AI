import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {directAttendanceRouter} from '../review/attendance-direct.js';
import {notifyReconciledCompletion,choiceFromVisibleText,parsePreferredDateTime,rankSlotsNearPreference,pickDiverseSlots,availableDates,parseDateChoice,parseTimeChoice,shouldRestartReschedule,resolveProfessionalSlots,assertControlledWrite} from '../melania/direct-reschedule.js';
test('dashboard reads shared attendance tables directly and returns no-store JSON',async()=>{
 const calls=[];const pool={query:async(sql,args)=>{calls.push({sql,args});return sql.includes('attendance_direct.requests')?{rows:[{id:1,patient:'P',professional:'D',branch:'S',date:'2026-09-15',time:'10:00',phone:'56900000000',trial:false,state:'pending',delivery:'accepted',reply:null,intent:null,medinet_status:null,verified_at:null,error:null,chatwoot_conversation_id:null}]}:{rows:[]};}};
 const app=express();app.use(directAttendanceRouter({getPool:()=>pool}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const base=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(base+'/?date=invalid')).status,400);
 const r=await fetch(base+'/?date=2026-09-15');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const body=await r.json();assert.equal(body.items.length,1);assert.equal(body.items[0].patient,'P');assert.equal(calls.length,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('missing shared database cannot appear as an empty successful report',async()=>{
 const app=express();app.use(directAttendanceRouter({getPool:()=>null}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
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


test('date then time chooser needs no typed combined date-time format',()=>{
 const slots=[
  {dataDia:'2026-09-21',time:'10:40'},
  {dataDia:'2026-09-17',time:'12:20'},
  {dataDia:'2026-09-17',time:'11:00'},
  {dataDia:'2026-09-21',time:'10:20'},
 ];
 assert.deepEqual(availableDates(slots),[
  {dataDia:'2026-09-17',date:'17/09/2026'},
  {dataDia:'2026-09-21',date:'21/09/2026'},
 ]);
 assert.equal(parseDateChoice('17/09/2026'),'2026-09-17');
 assert.equal(parseDateChoice('2026-09-21'),'2026-09-21');
 assert.equal(parseDateChoice('18/09'),null);
 assert.equal(parseTimeChoice('10:20'),'10:20');
 assert.equal(parseTimeChoice('25:00'),null);
});

test('Otra fecha stays inside date/time chooser instead of restarting reschedule',()=>{ assert.equal(shouldRestartReschedule('Otra fecha',{state:'time_choosing'}),false); assert.equal(shouldRestartReschedule('Reagendar',{state:'time_choosing'}),true); assert.equal(shouldRestartReschedule('cambiar hora',{state:'time_choosing'}),true); });


test('reschedule resolves missing Medinet professional id from live slots',()=>{
 const available=[
  {professional:'Rodrigo Villagran Morales',professionalId:13,dataDia:'2026-09-17',time:'11:00'},
  {professional:'Rodrigo Villagran Morales',professionalId:13,dataDia:'2026-09-21',time:'10:20'},
  {professional:'Otro Profesional',professionalId:99,dataDia:'2026-09-17',time:'09:00'},
 ];
 const r=resolveProfessionalSlots(available,{id:null,name:'Rodrigo Villagran Morales'},'',39);
 assert.equal(r.professionalId,13);assert.equal(r.slots.length,2);assert.ok(r.slots.every(s=>s.branchId===39));
});

test('live reschedule write scope accepts real flow and rejects trial',()=>{
 const prior={enabled:process.env.MELANIA_DIRECT_RESCHEDULE_WRITE_ENABLED,scope:process.env.MELANIA_DIRECT_RESCHEDULE_WRITE_SCOPE};
 process.env.MELANIA_DIRECT_RESCHEDULE_WRITE_ENABLED='true';process.env.MELANIA_DIRECT_RESCHEDULE_WRITE_SCOPE='live';
 try{assert.equal(assertControlledWrite({trial:false,external_id:421207,professional:{id:null,name:'Rodrigo Villagran Morales'},branch_id:39,patient:{name:'Paciente'},appointment_at:'2026-09-15T10:00:00-03:00'},'56911111111'),true);
 assert.throws(()=>assertControlledWrite({trial:true,external_id:990000052,professional:{id:13},branch_id:39,patient:{name:'Rodrigo'},appointment_at:'2026-09-21T10:00:00-03:00'},'56987297033'),/rejects_trial/);}
 finally{process.env.MELANIA_DIRECT_RESCHEDULE_WRITE_ENABLED=prior.enabled;process.env.MELANIA_DIRECT_RESCHEDULE_WRITE_SCOPE=prior.scope;}
});
