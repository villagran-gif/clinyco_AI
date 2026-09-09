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
test('repair complaint requests internal reconciliation without canned speech', () => {
  const r = plan({ text: 'Ya respondí 2013' });
  assert.equal(r.action, 'reconcile_history'); assert.equal(r.questionKey, null);
  assert.deepEqual(r.bubbles, []);
});
test('explicit robot question gets brief truthful identity, not an apology script', () => {
  const r = plan({ text: 'Es un robot?' });
  assert.equal(r.action, 'disclose_identity'); assert.equal(r.bubbles[0], 'Soy una asistente de IA.');
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
test('pauses span 2.5 to 5 seconds and do not add to a slow or urgent turn', () => {
  assert.equal(pauseMs('', { random: () => 0 }), 2500);
  assert.equal(pauseMs('x'.repeat(10000), { random: () => 1 }), 5000);
  assert.equal(pauseMs('x', { elapsedMs: 5000 }), 0);
  assert.equal(pauseMs('x', { urgent: true }), 0);
});
test('release gate sends nothing before P0 and explicit enablement', async () => {
  const r = await deliverBubbles({ bubbles: ['test'], send: () => assert.fail(), isCurrent: () => true });
  assert.equal(r.skipped, 'release_gate');
});
test('incoming interruption during pause cancels obsolete output without typing', async () => {
  let current = true; const statuses = [];
  const r = await deliverBubbles({ enabled: true, foundationReady: true, bubbles: ['test'],
    isCurrent: () => current, send: () => assert.fail('stale send'),
    wait: async () => { current = false; }, setTyping: async s => statuses.push(s)
  });
  assert.equal(r.skipped, 'stale_or_human_takeover'); assert.deepEqual(statuses, []);
});
test('legacy typing callback never runs; total added pauses bounded', async () => {
  const waits = []; let typingCalls = 0;
  const r = await deliverBubbles({ enabled: true, foundationReady: true,
    bubbles: Array(8).fill('Synthetic response.'), isCurrent: () => true,
    send: async () => ({ id: 'synthetic' }), wait: async n => waits.push(n),
    setTyping: async () => { typingCalls++; throw new Error('must not run'); }
  });
  assert.equal(r.sent.length, 8); assert.equal(typingCalls, 0);
  assert.ok(waits.reduce((a, b) => a + b, 0) <= 15000);
});
test('sending failure does not fabricate a receipt or call typing', async () => {
  const statuses = []; await assert.rejects(deliverBubbles({ enabled: true, foundationReady: true,
    bubbles: ['test'], isCurrent: () => true, wait: async () => {},
    send: async () => { throw new Error('failed'); }, setTyping: async s => statuses.push(s)
  })); assert.deepEqual(statuses, []);
});
test('typing stays deferred even when legacy provider flags are passed', async () => {
  let calls = 0;
  const adapter = createChatwootTypingAdapter({ accountId: '162472', conversationId: 'cw:1',
    token: 'synthetic', dryRun: false, customerVisibilityVerified: true,
    fetchImpl: async () => { calls++; return { ok: true, status: 200 }; }
  });
  assert.equal((await adapter('on')).skipped, 'typing_deferred_issue_216');
  assert.equal((await adapter('off')).skipped, 'typing_deferred_issue_216');
  assert.equal(calls, 0);
});
test('length and bounded variation stay inside the requested pause range', () => {
  for (const length of [0, 5, 100, 300, 10000]) for (const sample of [0, 0.25, 0.75, 1]) {
    const n = pauseMs('x'.repeat(length), { random: () => sample });
    assert.ok(n >= 2500 && n <= 5000);
  }
  assert.notEqual(pauseMs('test', { random: () => 0 }), pauseMs('test', { random: () => 1 }));
});
test('first response accounts for elapsed preparation without shortening later gaps', async () => {
  const waits = [];
  await deliverBubbles({ enabled: true, foundationReady: true, bubbles: ['a', 'b'],
    elapsedMs: 1000, random: () => 0, isCurrent: () => true,
    send: async () => ({}), wait: async ms => waits.push(ms)
  });
  assert.deepEqual(waits, [1510, 2510]);
});
test('slow or urgent replies skip artificial pauses entirely', async () => {
  for (const options of [{ urgent: true }, { elapsedMs: 5000 }]) {
    const waits = [];
    const r = await deliverBubbles({ enabled: true, foundationReady: true,
      bubbles: ['a', 'b', 'c'], ...options, isCurrent: () => true,
      send: async () => ({}), wait: async n => waits.push(n)
    });
    assert.equal(r.sent.length, 3); assert.deepEqual(waits, []);
  }
});
test('human takeover between bubbles cancels the remaining delivery', async () => {
  let current = true;
  const r = await deliverBubbles({ enabled: true, foundationReady: true, bubbles: ['a', 'b'],
    isCurrent: () => current, wait: async () => {},
    send: async () => { current = false; return { id: 'first' }; }
  });
  assert.equal(r.sent.length, 1); assert.equal(r.skipped, 'stale_or_human_takeover');
});
test('no automatic identity speech is added to a normal commercial answer', () => {
  assert.doesNotMatch(plan({ text: 'precio y financiamiento' }).bubbles.join(' '), /asistente|disculpa|revisare/i);
});
test('typing stub validates state without network access', async () => {
  await assert.rejects(createChatwootTypingAdapter()('unknown'), TypeError);
});
