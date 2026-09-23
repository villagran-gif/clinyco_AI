import test from 'node:test';
import assert from 'node:assert/strict';
import { runModelBooking } from '../conversation/model-booking.js';

const slot={source:'agendaweb',professionalId:'10',branchId:1,specialtyId:'2',tipoCitaId:'3',duration:20,dataDia:'2026-09-20',date:'20/09/2026',time:'10:00',professional:'Profesional sintético',branchName:'Santiago'};
function fixture() {
  const state={identity:{},conversation:{facts:[{subject:'self',field:'rut',value:'12.345.678-5'},{subject:'self',field:'email',value:'test@example.test'},{subject:'self',field:'phone',value:'+56911111111'}]},booking:{pendingSlots:[slot]}};
  let posts=0,saves=0;
  const deps={state,search:async()=>({available_slots:[slot],patient_reply:'Cupo verificado'}),reserve:async({slot:s})=>{posts++;assert.equal(s,slot);return {success:true,slot:s,booking:{status:'agendado_correctamente'}}},persist:async()=>{saves++},assertActive:async()=>{},now:10000};
  return {state,deps,get posts(){return posts},get saves(){return saves},run:(plan,userText='1',messageId='2')=>runModelBooking({...deps,plan,userText,messageId})};
}
async function prepare(f) {
  await f.run({operation:'select',slotIndex:1},'la primera','1');
  f.state.booking.modelConfirmation.presented=true; // Simulated accepted public receipt.
}
test('published slot and explicitly confirmed unchanged details produce one booking',async()=>{
  const f=fixture();await prepare(f);
  assert.match(await f.run({operation:'confirm'},'Sí'),/Reserva confirmada/);
  assert.equal(f.posts,1);assert.equal(f.state.booking.chosenSlot,null);
  await f.run({operation:'confirm'},'Sí','3');assert.equal(f.posts,1);
});
test('invalid slot index cannot become a model-invented slot payload',async()=>{
  const f=fixture();await f.run({operation:'select',slotIndex:99});assert.equal(f.posts,0);assert.equal(f.state.booking.chosenSlot,undefined);
});
test('unpresented proposal or implicit answer cannot authorize a reservation',async()=>{
  const f=fixture();await f.run({operation:'select',slotIndex:1});
  await f.run({operation:'confirm'},'Sí','3');assert.equal(f.posts,0);
  f.state.booking.modelConfirmation.presented=true;
  await f.run({operation:'confirm'},'Sí, pero cambia mi correo','4');assert.equal(f.posts,0);
});
test('corrected data invalidates prior consent and requires a new presented summary',async()=>{
  const f=fixture();await prepare(f);f.state.conversation.facts[1].value='corrected@example.test';
  assert.match(await f.run({operation:'confirm'},'Sí'),/corrected@example.test/);assert.equal(f.posts,0);
  assert.equal(f.state.booking.modelConfirmation.presented,false);
});
test('expired consent is not reused',async()=>{
  const f=fixture();await prepare(f);f.deps.now+=11*60*1000;
  await f.run({operation:'confirm'},'Sí');assert.equal(f.posts,0);
});
test('unknown booking outcome blocks replay across a restored snapshot',async()=>{
  const f=fixture();await prepare(f);f.deps.reserve=async()=>{throw new Error('timeout')};
  await f.run({operation:'confirm'},'Sí');assert.equal(f.state.booking.modelAttempt.status,'uncertain');
  const restored=fixture();restored.deps.state=JSON.parse(JSON.stringify(f.state));
  assert.match(await restored.run({operation:'confirm'},'Sí','3'),/verificarse/);assert.equal(restored.posts,0);
});
test('failed persistence prevents external booking',async()=>{
  const f=fixture();await prepare(f);f.deps.persist=async()=>{throw new Error('DB unavailable')};
  await assert.rejects(f.run({operation:'confirm'},'Sí'),/DB unavailable/);assert.equal(f.posts,0);
});
test('human takeover after preparation blocks the operation',async()=>{
  const f=fixture();await prepare(f);f.deps.assertActive=async()=>{throw new Error('human control')};
  await assert.rejects(f.run({operation:'confirm'},'Sí'),/human control/);assert.equal(f.posts,0);
});
test('unverified historical identity cannot supply booking credentials',async()=>{
  const f=fixture();f.state.conversation.facts=[];f.state.contactDraft={c_rut:'12.345.678-5',c_email:'someone@example.test',c_tel1:'+56911111111'};
  assert.match(await f.run({operation:'select',slotIndex:1}),/faltan/);assert.equal(f.state.booking.modelConfirmation,null);
});
test('abandoning a draft never invokes cancellation or claims an existing appointment was cancelled',async()=>{
  const f=fixture();await prepare(f);
  assert.match(await f.run({operation:'cancel_draft'},'No quiero continuar'),/no cancela ninguna cita/);assert.equal(f.posts,0);
});

test('success without a verifiable matching receipt stays uncertain and cannot be retried',async()=>{
  for (const result of [null,{success:true,slot},{success:true,slot,booking:{status:'pending'}},
    {success:true,slot:{...slot,time:'11:00'},booking:{status:'agendado_correctamente'}}]) {
    const f=fixture();await prepare(f);let calls=0;
    f.deps.reserve=async()=>{calls++;return result};
    assert.doesNotMatch(await f.run({operation:'confirm'},'Sí'),/Reserva confirmada/);
    assert.equal(f.state.booking.modelAttempt.status,'uncertain');
    await f.run({operation:'confirm'},'Sí','3');assert.equal(calls,1);
  }
});
test('an informational question cannot authorize a POST even if the model proposes confirm',async()=>{
  const f=fixture();await prepare(f);
  await f.run({operation:'confirm'},'¿Cuánto cuesta la consulta?');assert.equal(f.posts,0);
});
