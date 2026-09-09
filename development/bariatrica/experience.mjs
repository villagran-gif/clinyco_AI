/** Experimental, NOT wired to server.js. No patient traffic until the P0 gates pass. */
export const PACING = Object.freeze({
  quietWindowMs: 1800,
  maxBatchWaitMs: 6000,
  firstReplyMinMs: 700,
  firstReplyMaxMs: 1800,
  bubbleMinMs: 350,
  bubbleMaxMs: 850,
  maxAddedDelayPerTurnMs: 3000,
});

export const QUESTIONS = Object.freeze({
  prior_surgery: Object.freeze([
    '¿Te has realizado alguna cirugía bariátrica: manga, bypass, otra o ninguna?',
    '¿Tienes una cirugía bariátrica previa? Puede ser manga, bypass, otra o ninguna.',
    'Para orientarte, ¿qué cirugía bariátrica te han realizado? Si no te has operado, indícamelo.',
  ]),
  prior_year: Object.freeze([
    '¿En qué año te realizaron esa cirugía?',
    '¿De qué año es tu cirugía bariátrica?',
    '¿Recuerdas el año de tu operación bariátrica?',
  ]),
  revision_reason: Object.freeze([
    '¿Consultas por recuperación de peso, reflujo, ambos u otro motivo?',
    '¿Qué te gustaría evaluar: recuperación de peso, reflujo, ambos u otra molestia?',
    '¿El motivo de tu consulta es el peso, el reflujo, ambos o algo diferente?',
  ]),
  studies: Object.freeze([
    '¿Tienes alguna endoscopia u otro estudio reciente disponible?',
    '¿Cuentas con una endoscopia u otros estudios recientes?',
    '¿Dispones de estudios recientes, como una endoscopia?',
  ]),
  weight: Object.freeze(['¿Cuánto pesas actualmente?', '¿Cuál es tu peso actual?', '¿Me indicas tu peso actual en kilos?']),
  height: Object.freeze(['¿Cuánto mides?', '¿Cuál es tu estatura?', '¿Me indicas tu estatura?']),
  age: Object.freeze(['¿Qué edad tienes?', '¿Cuántos años tienes?', '¿Me indicas tu edad?']),
  insurance: Object.freeze([
    '¿Tu previsión es Fonasa, Isapre o particular?',
    '¿Tienes Fonasa, Isapre o te atenderías de forma particular?',
    'Para revisar las opciones, ¿cuentas con Fonasa, Isapre o atención particular?',
  ]),
  city: Object.freeze(['¿En qué ciudad vives?', '¿En qué ciudad resides actualmente?', '¿Cuál es tu ciudad de residencia?']),
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

/** The caller must deduct the real model/queue elapsed time and share remainingMs across bubbles. */
export function additionalDelayMs({ phase = 'first', elapsedMs = 0, remainingMs = PACING.maxAddedDelayPerTurnMs,
  urgent = false, rng = Math.random } = {}) {
  if (urgent) return 0;
  const [min, max] = phase === 'bubble'
    ? [PACING.bubbleMinMs, PACING.bubbleMaxMs]
    : [PACING.firstReplyMinMs, PACING.firstReplyMaxMs];
  const random = Math.max(0, Math.min(1, finite(rng(), 0.5)));
  const target = Math.round(min + random * (max - min));
  return Math.round(Math.max(0, Math.min(target - Math.max(0, finite(elapsedMs)), Math.max(0, finite(remainingMs)))));
}

/** Pure timing calculation. Durable ingestion, dedupe and actual scheduling are integration work. */
export function batchReadyAtMs(firstReceivedAtMs, lastReceivedAtMs) {
  if (!Number.isFinite(firstReceivedAtMs) || !Number.isFinite(lastReceivedAtMs) || lastReceivedAtMs < firstReceivedAtMs) {
    throw new TypeError('Invalid receive timestamps');
  }
  return Math.min(lastReceivedAtMs + PACING.quietWindowMs, firstReceivedAtMs + PACING.maxBatchWaitMs);
}

/** intent is supplied by the router, NOT inferred from clinical text by this presentation module. */
export function planQuestion(preevaluation, key, { intent = 'evaluation', clarify = false, rng = Math.random } = {}) {
  const p = preevaluation || {};
  if (intent === 'urgent') return { action: 'clinical_escalation', key: null };
  if (intent === 'human') return { action: 'handoff', key: null };
  if (intent === 'repair') return { action: 'reconcile_history', key: null };
  if (intent === 'bot_identity') return { action: 'disclose_ai_identity', key: null };
  if (['price', 'financing', 'location', 'faq', 'booking'].includes(intent)) {
    return { action: intent === 'booking' ? 'route_booking' : 'answer_request', intent, resumeKey: p.awaiting || null };
  }
  const options = QUESTIONS[key];
  if (!options) throw new TypeError(`Unknown question key: ${key}`);
  const answer = p.answers?.[key];
  if (answer !== undefined && answer !== null && answer !== '') return { action: 'skip_known', key };
  const ledger = p.questionLedger?.[key] || {};
  const sentCount = Math.max(0, finite(ledger.sentCount), finite(p.askedKeys?.[key]));
  if (sentCount >= 2) return { action: 'handoff', key, reason: 'clarification_limit' };
  if (sentCount > 0 && !clarify) return { action: 'wait', key, reason: 'already_asked' };
  let variant = Math.min(options.length - 1, Math.floor(Math.max(0, Math.min(1, finite(rng(), 0.5))) * options.length));
  if (variant === ledger.variant && options.length > 1) variant = (variant + 1) % options.length;
  return { action: 'ask', key, variant, text: options[variant], clarification: sentCount > 0 };
}

/** Call only AFTER delivery succeeds. Preserve the actual provider message ID for idempotency. */
export function recordQuestionSent(preevaluation, decision, { messageId, sentAt = new Date().toISOString() } = {}) {
  if (decision?.action !== 'ask' || !QUESTIONS[decision.key]) throw new TypeError('Expected an ask decision');
  if (!messageId || !Number.isFinite(Date.parse(sentAt))) throw new TypeError('Delivery evidence is required');
  const p = preevaluation || {};
  const previous = p.questionLedger?.[decision.key] || {};
  const ids = previous.deliveryIds || [];
  if (ids.includes(String(messageId))) return p;
  const count = Math.max(0, finite(previous.sentCount), finite(p.askedKeys?.[decision.key])) + 1;
  return { ...p, awaiting: decision.key,
    askedKeys: { ...p.askedKeys, [decision.key]: count },
    questionLedger: { ...p.questionLedger, [decision.key]: {
      sentCount: count, variant: decision.variant, sentAt, deliveryIds: [...ids, String(messageId)].slice(-2),
    } },
  };
}

/** Chatwoot acceptance does NOT establish visibility on the customer's WhatsApp device. */
export function createChatwootTypingAdapter({ enabled = false, baseUrl, accountId, apiToken,
  fetchImpl = globalThis.fetch, timeoutMs = 800 } = {}) {
  return async function setTyping(conversationId, status) {
    if (!enabled) return { accepted: false, reason: 'disabled' };
    const id = String(conversationId || '').replace(/^cw:/, '');
    if (!/^\d+$/.test(id) || !/^\d+$/.test(String(accountId || '')) || !['on', 'off'].includes(status)) {
      return { accepted: false, reason: 'invalid_parameters' };
    }
    if (!apiToken || !baseUrl || typeof fetchImpl !== 'function') return { accepted: false, reason: 'not_configured' };
    try {
      const base = new URL(baseUrl);
      if (base.protocol !== 'https:' || base.username || base.password) return { accepted: false, reason: 'invalid_base_url' };
      const timeout = Math.min(1500, Math.max(100, finite(timeoutMs, 800)));
      const response = await fetchImpl(`${base.origin}/api/v1/accounts/${accountId}/conversations/${id}/toggle_typing_status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', api_access_token: apiToken },
        body: JSON.stringify({ typing_status: status, is_private: false }), signal: AbortSignal.timeout(timeout),
        redirect: 'error',
      });
      return { accepted: response.ok, customerVisible: null, reason: response.ok ? 'accepted_not_visually_verified' : 'provider_rejected' };
    } catch {
      // Presence is best-effort: do not expose credentials or block a patient response.
      return { accepted: false, reason: 'provider_unavailable' };
    }
  };
}

/** Use one scoped instance per turn; the real sender must also re-check staleness/human takeover. */
export async function withTyping(work, { setTyping, isCurrent = () => true } = {}) {
  if (!isCurrent()) return { skipped: 'stale_or_human_takeover' };
  const update = async (status) => { try { await setTyping?.(status); } catch { /* Non-critical presence failure. */ } };
  try {
    await update('on');
    if (!isCurrent()) return { skipped: 'stale_or_human_takeover' };
    return await work();
  } finally {
    await update('off');
  }
}
