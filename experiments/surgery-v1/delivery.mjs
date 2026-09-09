/** Prototype delivery utilities. Not wired into production. */
import { setTimeout as sleep } from 'node:timers/promises';

export const MIN_PAUSE_MS = 2500;
export const MAX_PAUSE_MS = 5000;
export const MAX_ADDED_PAUSE_MS = 15000; // Up to three normally composed bubbles.

export function pauseMs(text, { elapsedMs = 0, urgent = false, random = Math.random } = {}) {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (urgent || elapsed >= MAX_PAUSE_MS) return 0;
  const sample = Number(random());
  const jitter = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
  const lengthPart = Math.min(1500, String(text || '').length * 10);
  const desired = Math.min(MAX_PAUSE_MS, MIN_PAUSE_MS + lengthPart + Math.round(jitter * 1000));
  // Include time already spent preparing the first response; never pad a slow turn.
  return Math.max(0, desired - elapsed);
}

export async function deliverBubbles({
  bubbles, send, isCurrent, wait = sleep,
  enabled = false, foundationReady = false, urgent = false, elapsedMs = 0,
  random = Math.random
}) {
  if (!enabled || !foundationReady) return { skipped: 'release_gate', sent: [] };
  if (!Array.isArray(bubbles) || typeof send !== 'function' || typeof isCurrent !== 'function') {
    throw new TypeError('bubbles, send and isCurrent required');
  }
  const sent = [];
  let pauseBudgetMs = MAX_ADDED_PAUSE_MS;
  const slowTurn = Number.isFinite(elapsedMs) && elapsedMs >= MAX_PAUSE_MS;
  // Typing is intentionally not called, even if a legacy caller passes setTyping.
  // Deferred at the user's request: GitHub issue #216.
  for (const text of bubbles.filter(x => typeof x === 'string' && x.trim())) {
    if (!await isCurrent()) return { skipped: 'stale_or_human_takeover', sent };
    const ms = Math.min(pauseBudgetMs, pauseMs(text, {
      elapsedMs: sent.length ? 0 : elapsedMs, urgent: urgent || slowTurn, random
    }));
    if (ms > 0) {
      await wait(ms);
      pauseBudgetMs -= ms;
    }
    if (!await isCurrent()) return { skipped: 'stale_or_human_takeover', sent };
    const receipt = await send(text);
    // The caller persists only receipts from successful sends, not plans.
    sent.push({ text, receipt });
  }
  return { sent, addedPauseMs: MAX_ADDED_PAUSE_MS - pauseBudgetMs };
}

// Keep the export compatible with earlier prototypes, but perform no network call.
// Future implementation is tracked in #216 and is not part of this delivery.
export function createChatwootTypingAdapter() {
  return async typingStatus => {
    if (!['on', 'off'].includes(typingStatus)) throw new TypeError('typingStatus must be on/off');
    return { skipped: 'typing_deferred_issue_216' };
  };
}
