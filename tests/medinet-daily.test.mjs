import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildDailyReport, validDay, chileDate, dailyMedinetRouter, dailyFailure, checkDailyConnection } from '../review/medinet-daily.js';
const date='2026-09-14', now=new Date('2026-09-14T14:00:00Z');
const appointment=(id,status='Agendado',extra={})=>({id,fecha:'2026/09/14',hora:'10:00:00',estado:{nombre:status},tipo_id:3,tipo:'Consulta',profesional:{nombres:'Profesional',paterno:'Prueba'},sucursal:{id:2,nombre:'Sede prueba'},paciente:{nombres:'Paciente',paterno:'Prueba'},...extra});
const report=extra=>buildDailyReport({date,now,appointments:[],...extra});
test('Chile day and date validation handle timezone boundaries and invalid dates',()=>{assert.equal(chileDate(new Date('2026-09-14T01:00:00Z')),'2026-09-13');assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2026-09-14'),true);assert.equal(validDay(['2026-09-14']),false);});
test('deduplicates actual appointments, excludes other days, separates cancellation and attendance',()=>{const r=report({appointments:[appointment(1),appointment(1),appointment(2,'Atendido'),appointment(3,'Cancelada'),appointment(4,'Re-Agendado'),appointment(5,'Ausente'),appointment(6,'Agendado',{fecha:'2026/09/15'})]});assert.equal(r.items.length,5);const p=r.professionals[0];assert.equal(p.occupied,3);assert.equal(p.cancelled,2);assert.equal(p.attended,1);assert.equal(p.absent,1);assert.equal(p.missingTariffs,3);assert.equal(p.paidAmount,null);assert.equal(p.blocked,null);});
test('only counts fresh published availability, never interprets missing/stale as zero',()=>{const slots={syncedAt:now.toISOString(),sucursales:{2:{nombre:'Sede prueba',profesionales:[{nombre:'Profesional Prueba',slots:[{fecha:date,horas:['10:00','11:00']}]}]}}};assert.equal(report({slots}).professionals[0].free,2);slots.syncedAt='2026-09-13T14:00:00Z';assert.equal(report({slots}).professionals[0].free,null);slots.syncedAt=now.toISOString();slots.sucursales[2].profesionales[0].slots=[];assert.equal(report({slots}).professionals[0].free,null);});
test('confirmation joins exact appointment ID and date; free consultations and cancelled fees are correct',()=>{const r=report({appointments:[appointment(1),appointment(2,'Confirmado'),appointment(3,'Cancelada')],confirmations:[{external_id:1,appointment_at:'2026-09-13T14:00:00Z',state:'confirmed'},{external_id:2,appointment_at:'2026-09-14T14:00:00Z',state:'reschedule_requested',chatwoot_conversation_id:99}],tariffs:[{professional_key:'profesional prueba',type_id:'3',amount_clp:'0'}]});assert.equal(r.items[0].confirmation,'Sin confirmación registrada');assert.equal(r.items[1].confirmation,'Solicita reagendar');assert.match(r.items[1].conversationUrl,/conversations\/99$/);assert.equal(r.professionals[0].expectedKnown,2);assert.equal(r.professionals[0].expectedAmount,0);assert.equal(r.professionals[0].missingTariffs,0);});
test('route fails visibly on incomplete Medinet response and validates writes before database access',async()=>{const pool={query:async()=>({rows:[]})};const app=express();app.use((req,res,next)=>{req.reviewUser={email:'agent@example.test'};next();});app.use(dailyMedinetRouter({getPool:()=>pool,appointments:async()=>({results:[],next:'page2'}),fetchSlots:async()=>null}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;try{assert.equal((await fetch(base+'/daily?date=bad')).status,400);assert.equal((await fetch(base+'/daily?date='+date)).status,503);assert.equal((await fetch(base+'/daily/tariff',{method:'PUT',headers:{'Content-Type':'application/json','Origin':'https://other.example'},body:'{}'})).status,403);assert.equal((await fetch(base+'/daily/tariff',{method:'PUT',headers:{'Content-Type':'application/json','Origin':'https://clinyco-ai.netlify.app'},body:JSON.stringify({professionalKey:'prueba',typeId:3,amount:-1})})).status,400);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}});

test('cancelled appointments are not confirmed; sent reminders cannot downgrade a Medinet confirmation',()=>{const r=report({appointments:[appointment(1,'Cancelada'),appointment(2,'Confirmado')],confirmations:[{external_id:1,appointment_at:'2026-09-14T14:00:00Z',state:'confirmed'},{external_id:2,appointment_at:'2026-09-14T14:00:00Z',state:'reminder_sent',first_msg_sent_at:'2026-09-12T14:00:00Z'}]});assert.equal(r.items[0].confirmation,'Cita cancelada o reagendada');assert.equal(r.items[1].confirmation,'Confirmada en Medinet');assert.equal(r.professionals[0].confirmed,1);});

test('cash review separates expected booked value from expected attended consultations',()=>{const r=report({appointments:[appointment(1,'Atendido'),appointment(2,'Agendado'),appointment(3,'Ausente'),appointment(4,'Cancelada')],tariffs:[{professional_key:'profesional prueba',type_id:'3',amount_clp:20000}]});const p=r.professionals[0];assert.equal(p.expectedAmount,60000);assert.equal(p.attendedExpectedAmount,20000);assert.equal(p.attendedExpectedKnown,1);assert.equal(p.paidAmount,null);});

test('connection check never logs patients or upstream error bodies',async()=>{
  const ok=await checkDailyConnection({now,appointments:async()=>[appointment(1)]});
  assert.deepEqual(ok,{ok:true,date,count:1});
  const bad=await checkDailyConnection({now,appointments:async()=>{throw new Error('Medinet API GET /path → 401: private upstream content');}});
  assert.deepEqual(bad,{ok:false,date,stage:'appointments',code:'access_denied',status:401});
  assert.equal(JSON.stringify(bad).includes('private'),false);
  assert.equal(dailyFailure({name:'TimeoutError'}).code,'timeout');
});

test('documented reception tariffs fill expected values without overriding manual tariff',()=>{
  const ingrid=appointment(10,'Agendado',{tipo_id:63,tipo:'Atención Nutriología (Agenda web)',profesional:{nombres:'Ingrid',paterno:'Yevenes Marquez'},paciente:{nombres:'Paciente',prevision:'Fonasa'}});
  const r=report({appointments:[ingrid]});
  assert.equal(r.items[0].expectedAmount,60000);assert.equal(r.items[0].tariffSource,'recepcion-2026-09-15');
  const manual=report({appointments:[ingrid],tariffs:[{professional_key:'ingrid yevenes marquez',type_id:'63',amount_clp:61000}]});
  assert.equal(manual.items[0].expectedAmount,61000);assert.equal(manual.items[0].tariffSource,'manual');
});

test('payer-specific and ambiguous documented tariffs fail closed',()=>{
  const fonasa=appointment(20,'Agendado',{tipo_id:2,tipo:'Evaluación Cirugía - Nuevo',profesional:{nombres:'Edmundo',paterno:'Ziede Rojas'},paciente:{nombres:'Paciente',prevision:'Fonasa'}});
  const isapre=appointment(21,'Agendado',{tipo_id:2,tipo:'Evaluación Cirugía - Nuevo',profesional:{nombres:'Edmundo',paterno:'Ziede Rojas'},paciente:{nombres:'Paciente',prevision:'Colmena'}});
  const ph=appointment(22,'Agendado',{tipo_id:999,tipo:'PHmetría con impedancia 24 horas',profesional:{nombres:'Examen',paterno:'PH'},paciente:{nombres:'Paciente',prevision:'Particular'}});
  const r=report({appointments:[fonasa,isapre,ph]});
  assert.equal(r.items.find(x=>x.id==='20').expectedAmount,20000);
  assert.equal(r.items.find(x=>x.id==='21').expectedAmount,null);
  assert.equal(r.items.find(x=>x.id==='22').expectedAmount,null);
});
