import assert from "node:assert/strict";
import {publishedProfessionals,publishedSlots,reservePublishedSlot} from "../melania/agendaweb-only.js";
const now=new Date("2026-09-08T15:00:00Z");
const p={id:13,branchId:41,branchName:"Santiago",nombres:"Rodrigo",paterno:"Villagran",especialidad:"Cirugia",especialidad_id:5,tipo_cita:276,duracion_cita:20,cupos:[{fecha:"2026-09-09",horas:["14:00","14:00","25:00"]},{fecha:"2026-10-01",horas:["10:00"]}]};
const rows=publishedProfessionals([p,{...p,duracion_cita:null},{...p,branchId:38},{...p,is_resource:true}],now);
assert.equal(rows.length,1);assert.deepEqual(rows[0].cupos,[{fecha:"2026-09-09",horas:["14:00"]}]);
const slots=publishedSlots(rows,{professionalId:13,branchId:41});
assert.equal(slots.length,1);assert.equal(slots[0].duration,20);
assert.equal(publishedSlots(rows,{professionalId:99}).length,0);
assert.equal(publishedSlots(rows,{query:"Gabriel Millanao"}).length,0);
assert.equal(publishedSlots(rows,{query:"Rodrigo Villagran"}).length,1);
let calls=0;
const args={slot:slots[0],patientData:{rut:"test"},load:async()=>rows,check:async()=>({paciente_existe:true}),post:async payload=>{calls++;assert.equal(payload.duracion,20);assert.equal(payload.tipo,"276");assert.equal(payload.ubicacion,41);return {status:"agendado_correctamente"};}};
assert.equal((await reservePublishedSlot(args)).success,true);assert.equal(calls,1);
for(const field of ["duration","branchId","tipoCitaId","specialtyId","professionalId","time","dataDia"]){
const result=await reservePublishedSlot({...args,slot:{...args.slot,[field]:"999"}});
assert.equal(result.success,false);assert.equal(calls,1);
}
assert.equal((await reservePublishedSlot({...args,load:async()=>[]})).success,false);
assert.equal((await reservePublishedSlot({...args,check:async()=>({paciente_existe:false})})).success,false);
await assert.rejects(reservePublishedSlot({...args,load:async()=>{throw Error("offline")}}));assert.equal(calls,1);
let attempts=0;await assert.rejects(reservePublishedSlot({...args,post:async()=>{attempts++;throw Error("timeout")}}));assert.equal(attempts,1);
console.log("PASS: published-only, 14 days, exact metadata, no invented duration, missing slot, failure closed, single POST");
