import assert from 'node:assert/strict';
import {isEndoscopyBooking} from '../melania/booking-policy.js';
import {startMelaniaFlow,handleMelaniaMessage,setMelaniaSlots} from '../melania/flow.js';
const endo={id:10,branchId:38,nombres:'Prueba',paterno:'Endoscopia',especialidad:'Gastroenterologia'};
const consultation={id:12,branchId:39,especialidad:'Gastroenterologia Adulto'};
for(const v of [endo,{branchId:'38'},{especialidad_id:58},{tipo:235},{appointmentTypeName:'Endoscopía digestiva'}]) assert.ok(isEndoscopyBooking(v));
assert.equal(isEndoscopyBooking(consultation),false);
assert.deepEqual(startMelaniaFlow({},[endo,consultation]).melaniaState.professionals,[consultation]);
for(const step of ['choose_slot','collecting_data','confirming']){
const r=handleMelaniaMessage({active:true,step,chosenProfessional:endo,collectedData:{}},'1');
assert.equal(r.failReason,'endoscopy_human_only');assert.ok(!r.bookingReady);assert.equal(r.melaniaState.active,false);
}
const stale=handleMelaniaMessage({active:true,step:'choose_professional',professionals:[endo],collectedData:{}},'1');assert.equal(stale.failReason,'endoscopy_human_only');
const r=setMelaniaSlots({chosenProfessional:consultation},[{branchId:38},{branchId:39,time:'10:00'}],'Prueba','Gastro');assert.equal(r.melaniaState.availableSlots.length,1);
console.log('PASS: metadata, consultations, menus, stale sessions, confirmation, slots');
