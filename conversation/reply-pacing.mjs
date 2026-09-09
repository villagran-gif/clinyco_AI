/** Branch prototype. Not imported by server.js until the P0 ingress fix is verified. */
import { setTimeout as delay } from 'node:timers/promises';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/** Budget is artificial delay only; real model latency reduces the first pause. */
export function planReplyPause({ text = '', bubbleIndex = 0, elapsedMs = 0, urgent = false, random = Math.random } = {}) {
  if (urgent || !String(text).trim()) return 0;
  const sample = Number(random());
  const jitter = Number.isFinite(sample) ? clamp(sample, 0, 1) : 0.5;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (bubbleIndex > 0) return Math.round(600 + jitter * 500);
  const target = clamp(900 + String(text).length * 7 + jitter * 400, 900, 2800);
  return Math.round(Math.max(0, target - elapsed));
}

/**
 * Adapter is best-effort and abortable. Failure of typing must never block text.
 * A fulfilled adapter promise means API accepted, NOT proof of visibility on a phone.
 */
async function toggleTyping(adapter, on, timeoutMs) {
  if (!adapter) return { accepted: false, reason: 'not_configured' };
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(() => adapter(on, { signal: controller.signal }))
        .then(() => ({ accepted: true })),
      new Promise(resolve => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve({ accepted: false, reason: 'timeout' });
        }, timeoutMs);
      }),
    ]);
  } catch {
    return { accepted: false, reason: 'provider_error' };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/**
 * Serial bubble delivery with latest-turn/human-takeover checks around every await.
 * isCurrent MUST consult ingress revision + human takeover, not last processed ID.
 * send MUST perform its own final check and use durable outbound idempotency.
 * Durable ingress, burst aggregation and provider adapters are intentionally external.
 */
export async function deliverPacedReply({
  bubbles, isCurrent, send, typing = null,
  sleep = ms => delay(ms), now = Date.now,
  startedAt = Date.now(), urgent = false,
  random = Math.random, maxArtificialPauseMs = 6000, typingTimeoutMs = 700,
}) {
  if (!Array.isArray(bubbles) || typeof isCurrent !== 'function' || typeof send !== 'function') {
    throw new TypeError('bubbles, isCurrent and send are required');
  }
  if (typing !== null && typeof typing !== 'function') throw new TypeError('typing must be a function');
  const parts = bubbles.map(part => String(part ?? '').trim()).filter(Boolean);
  const cap = Number.isFinite(maxArtificialPauseMs) ? clamp(maxArtificialPauseMs, 0, 6000) : 6000;
  const typingTimeout = Number.isFinite(typingTimeoutMs) ? clamp(typingTimeoutMs, 1, 1000) : 700;
  const result = { sentCount: 0, artificialPauseMs: 0, stopped: null, typing: { accepted: false, reason: 'not_configured' } };
  if (!parts.length) return result;
  if (!isCurrent()) return { ...result, stopped: 'superseded_or_human_takeover' };
  try {
    if (!urgent) result.typing = await toggleTyping(typing, true, typingTimeout);
    for (let i = 0; i < parts.length; i++) {
      if (!isCurrent()) { result.stopped = 'superseded_or_human_takeover'; break; }
      const planned = planReplyPause({ text: parts[i], bubbleIndex: i, elapsedMs: now() - startedAt, urgent, random });
      const pause = Math.min(planned, Math.max(0, cap - result.artificialPauseMs));
      if (pause) { await sleep(pause); result.artificialPauseMs += pause; }
      if (!isCurrent()) { result.stopped = 'superseded_or_human_takeover'; break; }
      await send(parts[i], { bubbleIndex: i });
      result.sentCount++;
    }
    return result;
  } finally {
    // A Meta adapter may implement "off" as a no-op: sending/expiry clears its indicator.
    if (!urgent && typing) await toggleTyping(typing, false, typingTimeout);
  }
}
