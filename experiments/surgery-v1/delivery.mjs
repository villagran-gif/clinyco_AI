/** Prototype delivery utilities. Not wired into production. */
import { setTimeout as sleep } from 'node:timers/promises';

export function pauseMs(text, { phase = 'first', elapsedMs = 0, urgent = false } = {}) {
  if (urgent || elapsedMs >= 3000) return 0; // Do not disguise slow infrastructure.
  const chars = String(text || '').length;
  const desired = phase === 'first' ? 700 + chars * 5 : 600 + chars * 4;
  return Math.max(0, Math.min(1600, desired) - Math.max(0, elapsedMs));
}

export async function deliverBubbles({
  bubbles, send, isCurrent, setTyping = async () => {}, wait = sleep,
  enabled = false, foundationReady = false, urgent = false, elapsedMs = 0
}) {
  if (!enabled || !foundationReady) return { skipped: 'release_gate', sent: [] };
  if (!Array.isArray(bubbles) || typeof send !== 'function' || typeof isCurrent !== 'function') {
    throw new TypeError('bubbles, send and isCurrent required');
  }
  const sent = [];
  let pauseBudgetMs = 4000;
  let typingAttempted = false;
  // Typing callbacks MUST enforce a short timeout and be scoped to this turn.
  const typing = async status => { try { await setTyping(status); } catch { /* best effort */ } };
  try {
    for (const text of bubbles.filter(x => typeof x === 'string' && x.trim())) {
      if (!await isCurrent()) return { skipped: 'stale_or_human_takeover', sent };
      const ms = Math.min(pauseBudgetMs, pauseMs(text, {
        phase: sent.length ? 'between' : 'first', elapsedMs, urgent
      }));
      if (ms > 0) {
        typingAttempted = true;
        await typing('on');
        await wait(ms);
        pauseBudgetMs -= ms;
      }
      if (!await isCurrent()) return { skipped: 'stale_or_human_takeover', sent };
      const receipt = await send(text);
      // The caller persists only receipts from successful sends, not plans.
      sent.push({ text, receipt });
    }
    return { sent, addedPauseMs: 4000 - pauseBudgetMs };
  } finally {
    if (typingAttempted) await typing('off');
  }
}

export function createChatwootTypingAdapter({
  apiUrl = 'https://app.chatwoot.com', accountId, conversationId,
  token, customerVisibilityVerified = false, dryRun = true, fetchImpl = fetch
}) {
  const id = String(conversationId || '').replace(/^cw:/, '');
  const base = new URL(apiUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new TypeError('A trusted HTTPS Chatwoot origin is required');
  }
  if (!/^\d+$/.test(id) || !/^\d+$/.test(String(accountId))) throw new TypeError('Numeric IDs required');
  return async typingStatus => {
    if (!['on', 'off'].includes(typingStatus)) throw new TypeError('typingStatus must be on/off');
    if (!customerVisibilityVerified) return { skipped: 'customer_visibility_unverified' };
    if (dryRun) return { dryRun: true, typingStatus };
    if (!token) return { skipped: 'credentials_missing' };
    try {
      const response = await fetchImpl(`${base.origin}/api/v1/accounts/${accountId}/conversations/${id}/toggle_typing_status`, {
        method: 'POST', signal: AbortSignal.timeout(800),
        headers: { 'Content-Type': 'application/json', api_access_token: token },
        body: JSON.stringify({ typing_status: typingStatus, is_private: false })
      });
      // An HTTP success alone does not prove visibility in the recipient's WhatsApp.
      return { accepted: response.ok, status: response.status };
    } catch { return { accepted: false, reason: 'typing_unavailable' }; }
  };
}
