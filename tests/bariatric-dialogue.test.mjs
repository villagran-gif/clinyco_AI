import test from 'node:test';
import assert from 'node:assert/strict';
import { SURGERY_TRACKS, isKnownAnswer, detectConversationInterruptions, presentBariatricQuestion, parsePriorSurgeryAnswer } from '../conversation/bariatric-dialogue.mjs';

test('variants preserve the same question key', () => {
  const variants = [0, 1, 2].map(variantIndex => presentBariatricQuestion('prior_year', { variantIndex }));
  assert.equal(new Set(variants.map(v => v.text)).size, 3);
  assert.ok(variants.every(v => v.questionKey === 'prior_year' && v.action === 'ask'));
});
test('confirmed manga cannot be asked again', () => {
  assert.equal(presentBariatricQuestion('prior_surgery', { answers: { prior_surgery: 'manga' } }).action, 'skip_known');
});
test('2013 cannot be asked again', () => {
  assert.equal(presentBariatricQuestion('prior_year', { answers: { prior_year: 2013 } }).action, 'skip_known');
});
test('asked-but-not-answered field requires repair, not another template', () => {
  assert.equal(presentBariatricQuestion('prior_surgery', { askedKeys: { prior_surgery: 1 }, variantIndex: 2 }).action, 'repair_or_wait');
});
test('valid negative and zero answers remain known', () => {
  assert.equal(isKnownAnswer({ reflujo: false }, 'reflujo'), true);
  assert.equal(isKnownAnswer({ n: 0 }, 'n'), true);
  assert.equal(isKnownAnswer({ field: ' ' }, 'field'), false);
});
test('original fragmented price request retains both intents', () => {
  const s = detectConversationInterruptions('Por una cirugía revisional valor\nY financiamiento\nGracias');
  assert.equal(s.price, true);
  assert.equal(s.financing, true);
  assert.equal(s.acknowledgement, false);
});
test('repair and identity are not clinical answers', () => {
  assert.equal(detectConversationInterruptions('Ya le conteste').repair, true);
  assert.equal(detectConversationInterruptions('Ya respondí 2013').repair, true);
  assert.equal(detectConversationInterruptions('Es un robot?').identity, true);
});
test('price question is recognized away from the first word', () => {
  assert.equal(detectConversationInterruptions('El valor de una cirugía revisional').price, true);
});
test('directions interrupt the questionnaire', () => {
  assert.equal(detectConversationInterruptions('¿Cómo llegar?').location, true);
});
test('human and appointment requests interrupt the questionnaire', () => {
  assert.equal(detectConversationInterruptions('Quiero hablar con una persona').human, true);
  assert.equal(detectConversationInterruptions('Quiero agendar una consulta').scheduling, true);
});
test('standalone thanks does not advance a clinical field', () => {
  assert.equal(detectConversationInterruptions('Gracias!').acknowledgement, true);
});
test('yes is only parsed with an explicit proposition', () => {
  assert.equal(parsePriorSurgeryAnswer('Sí', { key: 'prior_surgery', proposition: 'manga' }), 'manga');
  assert.equal(parsePriorSurgeryAnswer('Sí', { key: 'prior_surgery' }), null);
});
test('explicit answer survives alternate question wording', () => {
  assert.equal(parsePriorSurgeryAnswer('Una manga gastrica'), 'manga');
  assert.equal(parsePriorSurgeryAnswer('Quiero una manga'), null);
});
test('scope includes primary, metabolic, conversion and complex revision', () => {
  for (const track of ['primary_sleeve', 'primary_rygb', 'metabolic_evaluation', 'sleeve_to_bypass', 'other_revision']) assert.ok(SURGERY_TRACKS.includes(track));
});
