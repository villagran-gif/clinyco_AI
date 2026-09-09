import test from 'node:test';
import assert from 'node:assert/strict';
import { planReplyPause, deliverPacedReply } from '../conversation/reply-pacing.mjs';

const base = extras => ({ bubbles: ['Primera respuesta', 'Segunda respuesta'], isCurrent: () => true, send: async () => {}, sleep: async () => {}, now: () => 10000, startedAt: 10000, random: () => 0.5, ...extras });

test('first pause is bounded and text-dependent', () => {
  assert.ok(planReplyPause({ text: 'Hola', random: () => 0 }) >= 900);
  assert.equal(planReplyPause({ text: 'x'.repeat(10000), random: () => 1 }), 2800);
});
test('model latency consumes the first pause budget', () => {
  assert.equal(planReplyPause({ text: 'Hola', elapsedMs: 8000 }), 0);
});
test('between bubbles pause is 600-1100ms', () => {
  assert.equal(planReplyPause({ text: 'Hola', bubbleIndex: 1, random: () => 0 }), 600);
  assert.equal(planReplyPause({ text: 'Hola', bubbleIndex: 1, random: () => 1 }), 1100);
});
test('empty reply and urgent path have no artificial pause', () => {
  assert.equal(planReplyPause({ text: '' }), 0);
  assert.equal(planReplyPause({ text: 'Ayuda', urgent: true }), 0);
});
test('never sends stale turn', async () => {
  const r = await deliverPacedReply(base({ isCurrent: () => false, send: async () => assert.fail('stale send') }));
  assert.equal(r.sentCount, 0);
  assert.equal(r.stopped, 'superseded_or_human_takeover');
});
test('new message during pause cancels reply', async () => {
  let current = true;
  const r = await deliverPacedReply(base({ isCurrent: () => current, sleep: async () => { current = false; }, send: async () => assert.fail('stale send') }));
  assert.equal(r.sentCount, 0);
});
test('human takeover between bubbles cancels remaining delivery', async () => {
  let current = true;
  const sent = [];
  const r = await deliverPacedReply(base({ isCurrent: () => current, send: async text => { sent.push(text); current = false; } }));
  assert.equal(r.sentCount, 1);
  assert.deepEqual(sent, ['Primera respuesta']);
});
test('artificial pause total never exceeds six seconds', async () => {
  let elapsed = 0;
  const r = await deliverPacedReply(base({ bubbles: Array(20).fill('Hola'), sleep: async ms => { elapsed += ms; } }));
  assert.equal(r.sentCount, 20);
  assert.ok(elapsed <= 6000);
  assert.equal(r.artificialPauseMs, elapsed);
});
test('typing failure never blocks delivery', async () => {
  const r = await deliverPacedReply(base({ typing: async () => { throw new Error('provider down'); } }));
  assert.equal(r.sentCount, 2);
  assert.equal(r.typing.reason, 'provider_error');
});
test('typing timeout aborts provider without blocking delivery', async () => {
  const signals = [];
  const r = await deliverPacedReply(base({ typingTimeoutMs: 2, typing: (_, { signal }) => { signals.push(signal); return new Promise(() => {}); } }));
  assert.equal(r.sentCount, 2);
  assert.equal(r.typing.reason, 'timeout');
  assert.ok(signals.every(s => s.aborted));
});
test('send failure still clears typing', async () => {
  const statuses = [];
  await assert.rejects(deliverPacedReply(base({ typing: async on => { statuses.push(on); }, send: async () => { throw new Error('send failed'); } })), /send failed/);
  assert.deepEqual(statuses, [true, false]);
});
test('urgent path bypasses typing and pauses', async () => {
  const r = await deliverPacedReply(base({ urgent: true, sleep: async () => assert.fail('urgent sleep'), typing: async () => assert.fail('urgent typing') }));
  assert.equal(r.sentCount, 2);
  assert.equal(r.artificialPauseMs, 0);
});
test('current-turn check is repeated after typing', async () => {
  let current = true;
  const r = await deliverPacedReply(base({ isCurrent: () => current, typing: async () => { current = false; }, send: async () => assert.fail('stale send') }));
  assert.equal(r.sentCount, 0);
});
test('empty bubble list does not activate typing', async () => {
  const r = await deliverPacedReply(base({ bubbles: [], typing: async () => assert.fail('empty typing') }));
  assert.equal(r.sentCount, 0);
});
