import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const formatting=source.slice(source.indexOf('function formatReplyForWhatsApp('),source.indexOf('function buildReferralPromptContext('));
// No provider or network dependencies exist in this formatting boundary.
const split=vm.runInNewContext(formatting+'\nsplitAntoniaReplyBubbles');
const bubbles=s=>Array.from(split(s));
test('question and explanatory sentence become two bubbles locally',()=>{
  assert.deepEqual(bubbles('Me cuentas tu peso y estatura actual? Es solo para una orientación inicial.'),['Me cuentas tu peso y estatura actual?','Es solo para una orientación inicial']);
});
test('explicit boundaries remain authoritative',()=>{
  assert.deepEqual(bubbles('¿Me cuentas tu peso?[[MSG]]Es para orientarte. ¿Cuánto mides?'),['Me cuentas tu peso?','Es para orientarte. ¿Cuánto mides?']);
});
test('URL query separator does not become a question boundary',()=>{
  assert.equal(bubbles('Revisa https://example.test/? Busca el horario.').length,1);
});
test('single question and decimal measurements remain intact',()=>{
  assert.deepEqual(bubbles('¿Mides 1.70 y pesas 80.5 kg?'),['Mides 1.70 y pesas 80.5 kg?']);
});

const introSource=source.slice(source.indexOf('function appendAntoniaIntroduction('),source.indexOf('function buildOpenAISystemPrompt('));
const introduce=vm.runInNewContext(introSource+'\nappendAntoniaIntroduction');
for (const greeting of ['¡Hola!', 'Hola!', 'Hola,', 'Hola, soy Antonia.']) {
  test(`initial greeting ${greeting} is single and preserves two useful bubbles`,()=>{
    const state={system:{botMessagesSent:0}};
    const result=bubbles(introduce(state,`${greeting} Te ayudo a agendar.[[MSG]]¿Con qué especialidad?`));
    assert.deepEqual(result,['Hola, soy Antonia. Te ayudo a agendar','Con qué especialidad?']);
    assert.equal(state.system.introducedAsAntonia,true);
  });
}
test('later replies do not receive another presentation',()=>{
  const state={system:{botMessagesSent:1,introducedAsAntonia:true}};
  assert.equal(introduce(state,'¿En qué sede?'),'¿En qué sede?');
});
test('initial question and explanation still split locally without a model delimiter',()=>{
  const state={system:{botMessagesSent:0}};
  assert.deepEqual(bubbles(introduce(state,'¡Hola! ¿En qué sede? Es para consultar los cupos.')),
    ['Hola, soy Antonia. ¿En qué sede?','Es para consultar los cupos']);
});
