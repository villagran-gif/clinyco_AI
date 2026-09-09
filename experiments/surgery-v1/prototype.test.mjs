import test from 'node:test';
import assert from 'node:assert/strict';
import { planSurgicalTurn, recordQuestionDelivered, variantFor, QUESTIONS } from './policy.mjs';
import { pauseMs, deliverBubbles, createChatwootTypingAdapter } from './delivery.mjs';
const plan = options => planSurgicalTurn({ conversationId: 'synthetic-1', text: '', ...options });

test('price and financing answered before one useful question', () => {
  const r = plan({ text: 'Por una cirugía revisional valor\nY financiamiento\nGracias' });
  assert.equal(r.intents.price, true); assert.equal(r.intents.financing, true);
  assert.equal(r.questionKey, 'insurance');
  assert.match(r.bubbles[0], /presupuesto/); assert.match(r.bubbles[1], /pago/);
  assert.equal(r.bubbles.join(' ').match(/\?/g).length, 1);
});
test('known previous surgery is never asked again', () => {
  const r = plan({ text: 'cirugía revisional', known: { track: 'revisional', prior_surgery: 'manga' } });
  assert.notEqual(r.questionKey, 'prior_surgery');
});
test('semantic question ledger survives any elapsed time', () => {
  const r = plan({ text: 'cirugía revisional', asked: { prior_surgery: { count: 1, at: 1 } } });
  assert.equal(r.action, 'wait'); assert.equal(r.questionKey, null);
});
test('pending question is not repeated', () => {
  assert.equal(plan({ text: 'cirugía revisional', pendingKey: 'prior_surgery' }).action, 'wait');
});
test('repair complaint never becomes a clinical answer or another question', () => {
  const r = plan({ text: 'Ya respondí 2013' });
  assert.equal(r.action, 'reconcile_history'); assert.equal(r.questionKey, null);
});
test('robot question gets truthful identity', () => {
  const r = plan({ text: 'Es un robot?' });
  assert.equal(r.action, 'disclose_identity'); assert.match(r.bubbles[0], /asistente virtual/);
});
test('courtesy message does not restart questionnaire', () => {
  assert.equal(plan({ text: 'Gracias' }).bubbles.length, 0);
});
test('schedule intent preserves known facts for the agenda branch', () => {
  const r = plan({ text: 'Quiero agendar', known: { city: 'Santiago', prior_surgery: 'manga' } });
  assert.equal(r.action, 'handoff_to_agenda'); assert.equal(r.context.city, 'Santiago');
});
test('stop and explicit human request take priority', () => {
  assert.equal(plan({ text: 'No quiero continuar' }).action, 'stop');
  assert.equal(plan({ text: 'Quiero hablar con una persona' }).action, 'request_handoff');
});
test('templates vary by conversation, never by retry', () => {
  const values = new Set(Array.from({ length: 40 }, (_, i) => variantFor(String(i), 'goal', QUESTIONS.goal)));
  assert.equal(values.size, 3);
  assert.equal(variantFor('a', 'goal', QUESTIONS.goal), variantFor('a', 'goal', QUESTIONS.goal));
});
test('expired commercial statements are not quoted', () => {
  const r = plan({ text: 'Precio', approved: { price: { approved: true, text: 'EXPIRED', validUntil: '2020-01-01' } } });
  assert.doesNotMatch(r.bubbles.join(' '), /EXPIRED/);
});
test('reviewed current commercial statement is used verbatim', () => {
  const r = plan({ text: 'Precio', now: Date.parse('2026-09-09'), approved: {
    price: { approved: true, text: 'Texto comercial de prueba revisado.', validUntil: '2026-10-01' }
  } });
  assert.equal(r.bubbles[0], 'Texto comercial de prueba revisado.');
});
test('question is counted only after confirmed delivery', () => {
  const r = plan({ text: 'cirugía revisional' });
  assert.deepEqual(recordQuestionDelivered({}, r, null), {});
  assert.equal(recordQuestionDelivered({}, r, 'synthetic-message').prior_surgery.count, 1);
});
test('pauses have a bound and never add to a slow or urgent turn', () => {
  assert.equal(pauseMs('x'.repeat(10000)), 1600);
  assert.equal(pauseMs('x', { elapsedMs: 3000 }), 0);
  assert.equal(pauseMs('x', { urgent: true }), 0);
});
test('release gate sends nothing before P0 and explicit enablement', async () => {
  const r = await deliverBubbles({ bubbles: ['test'], send: () => assert.fail(), isCurrent: () => true });
  assert.equal(r.skipped, 'release_gate');
});
test('incoming interruption during pause cancels obsolete output', async () => {
  let current = true; const statuses = [];
  const r = await deliverBubbles({ enabled: true, foundationReady: true, bubbles: ['test'],
    isCurrent: () => current, send: () => assert.fail('stale send'),
    wait: async () => { current = false; }, setTyping: async s => statuses.push(s)
  });
  assert.equal(r.skipped, 'stale_or_human_takeover'); assert.deepEqual(statuses, ['on', 'off']);
});
test('typing failure cannot suppress a valid answer; total pauses bounded', async () => {
  const waits = []; const r = await deliverBubbles({ enabled: true, foundationReady: true,
    bubbles: Array(8).fill('Synthetic response.'), isCurrent: () => true,
    send: async () => ({ id: 'synthetic' }), wait: async n => waits.push(n),
    setTyping: async () => { throw new Error('offline'); }
  });
  assert.equal(r.sent.length, 8); assert.ok(waits.reduce((a, b) => a + b, 0) <= 4000);
});
test('sending failure clears typing and does not fabricate a receipt', async () => {
  const statuses = []; await assert.rejects(deliverBubbles({ enabled: true, foundationReady: true,
    bubbles: ['test'], isCurrent: () => true, wait: async () => {},
    send: async () => { throw new Error('failed'); }, setTyping: async s => statuses.push(s)
  })); assert.equal(statuses.at(-1), 'off');
});
test('typing is off by default and API acceptance is not a visibility claim', async () => {
  let calls = 0;
  const common = { accountId: '162472', conversationId: 'cw:1', token: 'synthetic',
    fetchImpl: async (_url, options) => { calls++; assert.equal(JSON.parse(options.body).is_private, false); return { ok: true, status: 200 }; }
  };
  assert.equal((await createChatwootTypingAdapter(common)('on')).skipped, 'customer_visibility_unverified');
  assert.equal(calls, 0);
  const r = await createChatwootTypingAdapter({ ...common, dryRun: false, customerVisibilityVerified: true })('on');
  assert.equal(r.accepted, true); assert.equal(calls, 1); assert.equal(r.visibleToCustomer, undefined);
});
