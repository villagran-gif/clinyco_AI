import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createMelaniaHandoffRouter} from '../melania/handoff-router.js';

test('attendance appointment read/write goes through authenticated Chile worker', async()=>{
  const prior={
    handoff:process.env.CONFIRMATIONS_HANDOFF_TOKEN,
    url:process.env.MEDINET_WORKER_URL,
    token:process.env.MEDINET_WORKER_TOKEN,
    writes:process.env.MELANIA_ATTENDANCE_WRITE_ENABLED,
  };
  const calls=[];
  const worker=express();worker.use(express.json());
  worker.post('/medinet/api/appointment/detail',(req,res)=>{calls.push({path:req.path,auth:req.get('authorization'),body:req.body});res.json({success:true,appointment:{id:req.body.appointmentId,estado:{nombre:'Agendado'}}});});
  worker.post('/medinet/api/appointment/state',(req,res)=>{calls.push({path:req.path,auth:req.get('authorization'),body:req.body});res.json({success:true,appointment:{id:req.body.appointmentId,estado:{nombre:req.body.action==='Confirm'?'Confirmado':'Cancelada'}}});});
  const ws=worker.listen(0,'127.0.0.1');await new Promise(r=>ws.once('listening',r));
  process.env.CONFIRMATIONS_HANDOFF_TOKEN='synthetic-handoff';
  process.env.MEDINET_WORKER_URL=`http://127.0.0.1:${ws.address().port}`;
  process.env.MEDINET_WORKER_TOKEN='synthetic-worker';
  process.env.MELANIA_ATTENDANCE_WRITE_ENABLED='true';
  const app=express();app.use(express.json());app.use('/melania',createMelaniaHandoffRouter());
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(body)=>fetch(base+'/melania/appointment-direct',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-handoff'},body:JSON.stringify(body)});
  try{
    let r=await post({appointmentId:421423,intent:'read'});assert.equal(r.status,200);assert.equal((await r.json()).appointment.id,421423);
    r=await post({appointmentId:421423,intent:'confirm'});assert.equal(r.status,200);assert.equal((await r.json()).appointment.estado.nombre,'Confirmado');
    assert.equal(calls.length,2);assert.equal(calls[0].path,'/medinet/api/appointment/detail');assert.equal(calls[1].path,'/medinet/api/appointment/state');
    assert.equal(calls[0].auth,'Bearer synthetic-worker');assert.equal(calls[1].body.action,'Confirm');
  } finally {
    server.closeAllConnections();await new Promise(r=>server.close(r));ws.closeAllConnections();await new Promise(r=>ws.close(r));
    process.env.CONFIRMATIONS_HANDOFF_TOKEN=prior.handoff;process.env.MEDINET_WORKER_URL=prior.url;process.env.MEDINET_WORKER_TOKEN=prior.token;process.env.MELANIA_ATTENDANCE_WRITE_ENABLED=prior.writes;
  }
});

test('attendance write is closed when the MelanIA write gate is off', async()=>{
  const prior={handoff:process.env.CONFIRMATIONS_HANDOFF_TOKEN,writes:process.env.MELANIA_ATTENDANCE_WRITE_ENABLED};
  process.env.CONFIRMATIONS_HANDOFF_TOKEN='synthetic-handoff';delete process.env.MELANIA_ATTENDANCE_WRITE_ENABLED;
  const app=express();app.use(express.json());app.use('/melania',createMelaniaHandoffRouter());const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const r=await fetch(`http://127.0.0.1:${server.address().port}/melania/appointment-direct`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-handoff'},body:JSON.stringify({appointmentId:421423,intent:'confirm'})});assert.equal(r.status,409);assert.equal((await r.json()).error,'attendance_write_disabled');}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));process.env.CONFIRMATIONS_HANDOFF_TOKEN=prior.handoff;process.env.MELANIA_ATTENDANCE_WRITE_ENABLED=prior.writes;}
});
