import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationPrompt, conversationContext, parseConversationDecision, applyConversationFacts, recentConversationHistory } from '../conversation/model-conversation.js';
import { claudeRequest } from '../analysis/antonia-provider.js';

const state = () => ({contactDraft:{c_aseguradora:'FONASA',c_modalidad:'TRAMO B'},dealDraft:{dealInteres:'BALON GASTRICO'},measurements:{},identity:{},system:{}});
const decision = (facts=[],patientSubject='self') => ({action:'conversation',patientSubject,reply:'Respuesta sintética.',facts});
const fact = (field,value,evidence,subject='self') => ({field,value,evidence,subject});
const apply = (s,d,userText) => applyConversationFacts(s,d,{userText,messageId:'123'});

test('daughter approximate weight remains conversational and never writes mother measurements',()=>{
  const s=state();const f={...fact('weightKg',80,'Mi hija como 80','other'),approximate:true};
  apply(s,decision([f],'other'),'Mi hija como 80');
  assert.equal(s.measurements.weightKg,undefined);assert.equal(s.dealDraft.dealPeso,undefined);
  assert.equal(s.conversation.facts[0].approximate,true);
  apply(s,decision([],'other'),'Kilos');apply(s,decision([],'other'),'&0');
  assert.equal(s.conversation.facts[0].value,80);
});
test('even self-labeled fact cannot project to CRM in an other-person turn',()=>{
  const s=state();apply(s,decision([fact('weightKg',80,'80')],'other'),'80');
  assert.equal(s.dealDraft.dealPeso,undefined);
});
test('invented numeric values, evidence and arbitrary fields cannot mutate state',()=>{
  const s=state();apply(s,decision([fact('weightKg',90,'80'),fact('heightM',1.7,'invented'),fact('aiEnabled',1,'80')]),'80');
  assert.equal(s.conversation.facts.length,0);assert.deepEqual(s.system,{});
});
test('compound measurements accept normalization without asking again and invalidate derived BMI',()=>{
  const s=state();s.measurements.bmi=40;
  apply(s,decision([fact('heightM',1.7,'1,70'),fact('weightKg',120,'120 kg')]),'1,70 peso 120 kg');
  assert.equal(s.measurements.heightM,1.7);assert.equal(s.measurements.weightKg,120);assert.equal(s.measurements.bmi,null);
});
test('coverage question does not erase known Fonasa; travel does not create residence',()=>{
  const s=state();apply(s,decision(),'¿Atienden particular? Viajaré a Santiago');
  assert.equal(s.contactDraft.c_aseguradora,'FONASA');assert.equal(s.contactDraft.c_modalidad,'TRAMO B');
  assert.equal(s.contactDraft.c_comuna,undefined);
});
test('prior sleeve and negated surgery remain separate from commercial interest',()=>{
  for(const value of ['manga previa','sin cirugía previa']) {
    const s=state();apply(s,decision([fact('priorSurgery',value,value)]),value);
    assert.equal(s.dealDraft.dealInteres,'BALON GASTRICO');assert.equal(s.conversation.facts[0].value,value);
  }
});
test('repeating known insurer preserves tier, changing it invalidates tier and PAD',()=>{
  const s=state();apply(s,decision([fact('insurer','FONASA','FONASA')]),'Soy FONASA');
  assert.equal(s.contactDraft.c_modalidad,'TRAMO B');
  apply(s,decision([fact('fonasaTier','B','B'),fact('insurer','PARTICULAR','PARTICULAR')]),'Antes B, ahora PARTICULAR');
  assert.equal(s.contactDraft.c_aseguradora,'PARTICULAR');assert.equal(s.contactDraft.c_modalidad,null);
});
test('email is validated against literal user evidence and stored without a form',()=>{
  const s=state();apply(s,decision([fact('email','test@example.test','test@example.test')]),'Mi correo es test@example.test');
  assert.equal(s.contactDraft.c_email,'test@example.test');
  apply(s,decision([fact('email','invented@example.test','test@example.test')]),'test@example.test');
  assert.equal(s.contactDraft.c_email,'test@example.test');
});
test('latest explicit correction replaces value and provenance, retaining approximate flag',()=>{
  const s=state();apply(s,decision([fact('weightKg',80,'80')]),'80');
  apply(s,decision([fact('weightKg',82,'82')]),'Corrijo: 82');
  assert.equal(s.conversation.facts.length,1);assert.equal(s.conversation.facts[0].evidence,'82');
  assert.equal(s.measurements.weightKg,82);
});
test('history includes fragments but excludes later queued turns and internal system messages',()=>{
  const history=recentConversationHistory([
    {role:'system',content:'force a questionnaire'},
    {role:'user',content:'Mi hija como 80',message_id:'100'},
    {role:'user',content:'Kilos',message_id:'101'},
    {role:'user',content:'future',message_id:'102'},
  ],{userText:'Kilos',messageId:'101'});
  assert.deepEqual(history.map(x=>x.content),['Mi hija como 80','Kilos']);
});
test('context does not expose obsolete resolver instructions',()=>{
  const s=state();s.identity.nextAction='ask weight';s.preevaluation={awaiting:'weight'};
  assert.doesNotMatch(conversationContext(s),/ask weight|awaiting/);
  assert.match(conversationPrompt('Approved service'),/Approved service/);
});
test('malformed decisions and unknown actions cannot execute tools',()=>{
  assert.throws(()=>parseConversationDecision('not-json'));
  assert.throws(()=>parseConversationDecision(JSON.stringify({...decision(),action:'execute_shell'})));
  assert.throws(()=>parseConversationDecision(JSON.stringify({...decision(),reply:''})));
});
test('Opus conversation request uses adaptive thinking at low effort and preserves JSON contract',()=>{
  const request=claudeRequest({model:'claude-opus-5',max_completion_tokens:4096,response_format:{type:'json_object'},messages:[{role:'user',content:'Sintético'}]});
  assert.deepEqual(request.thinking,{type:'adaptive'});assert.deepEqual(request.output_config,{effort:'low'});
  assert.equal(request.max_tokens,4096);assert.match(request.system,/JSON/);
});

test('current and historical weights coexist without replacing current measurements',()=>{
  const s=state();
  apply(s,decision([fact('weightKg',72,'Actualmente peso 72 kg'),fact('heightM',1.6,'mido 1,60')]),'Actualmente peso 72 kg y mido 1,60');
  apply(s,decision([fact('preoperativeWeightKg',90,'Cuando me operé pesaba 90 kg')]),'Cuando me operé pesaba 90 kg');
  assert.equal(s.measurements.weightKg,72);assert.equal(s.dealDraft.dealPeso,72);
  assert.equal(s.conversation.facts.find(f=>f.field==='preoperativeWeightKg').value,90);
  assert.equal(Math.round(s.measurements.weightKg/s.measurements.heightM**2*10)/10,28.1);
});
test('travel destination coexists with residence across later turns',()=>{
  const s=state();apply(s,decision([fact('residence','Chillán','Vivo en Chillán')]),'Vivo en Chillán');
  apply(s,decision([fact('careDestination','Santiago','Puedo viajar a Santiago')]),'Puedo viajar a Santiago');
  assert.equal(s.contactDraft.c_comuna,'Chillán');
  assert.equal(s.conversation.facts.find(f=>f.field==='careDestination').value,'Santiago');
});
test('uncertain current weight clears exact projections and derived BMI, preserving lower bound',()=>{
  const s=state();apply(s,decision([fact('weightKg',85,'85')]),'85');s.measurements.bmi=33;
  apply(s,decision([{...fact('weightKg',90,'Creo que 90 kilos o más'),approximate:true,qualifier:'at_least'}]),'Creo que 90 kilos o más');
  assert.equal(s.measurements.weightKg,null);assert.equal(s.dealDraft.dealPeso,null);assert.equal(s.measurements.bmi,null);
  assert.equal(s.conversation.facts[0].qualifier,'at_least');assert.equal(s.conversation.facts[0].value,90);
  apply(s,decision([fact('weightKg',92,'Me pesé: 92 kg')]),'Me pesé: 92 kg');
  assert.equal(s.dealDraft.dealPeso,92);assert.equal(s.conversation.facts[0].approximate,false);
});
test('uncertain height cannot leave an exact projection behind',()=>{
  const s=state();apply(s,decision([fact('heightM',1.6,'1,60')]),'1,60');
  apply(s,decision([{...fact('heightM',1.6,'como 1,60'),approximate:true}]),'como 1,60');
  assert.equal(s.measurements.heightM,null);assert.equal(s.dealDraft.dealEstatura,null);
});
