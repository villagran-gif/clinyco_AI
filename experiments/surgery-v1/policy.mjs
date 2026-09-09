/**
 * Surgical conversation prototype. Not imported by production server.js.
 * Inputs are trusted application state, NEVER a raw patient-supplied object.
 * This module does not diagnose, prescribe, quote unverified prices or book.
 */
export const SURGICAL_SCOPE = Object.freeze([
  'manga_gastrica', 'bypass_roux_en_y', 'conversion_manga_bypass',
  'revisional_post_manga', 'revisional_post_bypass', 'otra_bariatrica'
]);
export const STRUCTURE = Object.freeze([
  'responder_duda', 'contexto_minimo', 'orientacion_aprobada',
  'resolver_objecion', 'siguiente_paso'
]);
export const QUESTIONS = Object.freeze({
  prior_surgery: [
    '¿Qué cirugía bariátrica te realizaron?',
    '¿Cuál fue tu cirugía bariátrica anterior?',
    '¿Qué tipo de operación bariátrica tienes?'
  ],
  insurance: [
    '¿Tu previsión es Fonasa, Isapre o particular?',
    '¿Tienes Fonasa, Isapre o atención particular?',
    '¿Consultarías con Fonasa, Isapre o de forma particular?'
  ],
  goal: [
    '¿Qué te gustaría resolver en la evaluación?',
    '¿Cuál es tu principal objetivo al consultar?',
    '¿Qué es lo más importante para ti en esta evaluación?'
  ],
  evaluation: [
    '¿Te ayudo a coordinar una evaluación con el cirujano?',
    '¿Revisamos cómo coordinar tu evaluación con el cirujano?',
    '¿Te gustaría avanzar a una evaluación con el cirujano?'
  ]
});

export function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[¿?.,!;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function variantFor(conversationId, key, options) {
  if (!Array.isArray(options) || !options.length) throw new TypeError('options required');
  // Stable per conversation and question: retries never rotate the same question.
  let hash = 2166136261;
  for (const ch of `${conversationId}:${key}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return options[(hash >>> 0) % options.length];
}

export function detectSurgicalIntents(text) {
  const n = normalize(text);
  return {
    stop: /\b(no me contacten|no me escriban|no quiero continuar|no sigas)\b/.test(n),
    human: /\b(hablar con (una persona|un humano|un agente)|quiero un agente)\b/.test(n),
    identity: /\b(eres (un )?(robot|bot|ia)|es un robot|eres humana|eres una persona)\b/.test(n),
    repair: /\b(ya (respondi|conteste|te dije|le conteste)|me preguntaste|otra vez lo mismo)\b/.test(n),
    price: /\b(valor|precio|cuanto (vale|cuesta|sale)|costo|presupuesto)\b/.test(n),
    financing: /\b(financiamiento|financiar|cuotas|credito|formas? de pago|condiciones de pago)\b/.test(n),
    concern: /\b(miedo|temor|riesgo|complicacion|complicaciones)\b/.test(n),
    scheduling: /\b(agendar|reservar|quiero (una )?hora|quiero (una )?cita)\b/.test(n),
    revisional: /\b(revisional|revision|conversion)\b/.test(n),
    acknowledgement: /^(gracias|muchas gracias|ok|okay|perfecto|dale|ya|bueno)$/.test(n)
  };
}

const present = value => value !== null && value !== undefined && value !== '';
function approvedText(entry, now) {
  if (!entry || entry.approved !== true || typeof entry.text !== 'string' || !entry.text.trim()) return null;
  // Commercial facts must be explicitly reviewed and have a non-expired validity.
  const expiry = Date.parse(entry.validUntil);
  return Number.isFinite(expiry) && expiry > now ? entry.text.trim() : null;
}

export function planSurgicalTurn({
  conversationId, text, known = {}, asked = {}, pendingKey = null,
  stage = 'discovery', approved = {}, now = Date.now()
}) {
  if (!conversationId) throw new TypeError('conversationId required');
  const intents = detectSurgicalIntents(text);
  const result = { structure: STRUCTURE, intents, action: 'respond', bubbles: [], questionKey: null };
  if (intents.stop) return { ...result, action: 'stop', bubbles: ['De acuerdo, no continuaré con las preguntas.'] };
  if (intents.human) return { ...result, action: 'request_handoff' };
  if (intents.identity) return { ...result, action: 'disclose_identity', bubbles: ['Sí, soy Antonia, la asistente virtual de Clinyco.'] };
  if (intents.repair) return {
    ...result, action: 'reconcile_history',
    bubbles: ['Disculpa la repetición. Revisaré lo que ya respondiste antes de continuar.']
  };
  if (intents.scheduling) return { ...result, action: 'handoff_to_agenda', context: { ...known } };
  if (intents.acknowledgement) return { ...result, action: 'wait' };

  if (intents.price) result.bubbles.push(approvedText(approved.price, now)
    || 'Para darte un valor correcto, el equipo debe confirmar el presupuesto de tu caso.');
  if (intents.financing) result.bubbles.push(approvedText(approved.financing, now)
    || 'Puedo ayudarte a consultar con el equipo las condiciones de pago, sin adelantarte cuotas que no estén confirmadas.');
  if (intents.concern) result.bubbles.push(
    'Puedes plantear tus dudas al cirujano y revisar los riesgos y las alternativas antes de tomar una decisión.'
  );

  // A direct commercial question is answered FIRST, without a mandatory medical form.
  const commercial = intents.price || intents.financing;
  let nextKey = null;
  if (commercial) nextKey = present(known.insurance) ? 'evaluation' : 'insurance';
  else if (stage === 'ready_for_evaluation' || intents.concern) nextKey = 'evaluation';
  else if ((known.track === 'revisional' || intents.revisional) && !present(known.prior_surgery)) nextKey = 'prior_surgery';
  else if (!present(known.goal)) nextKey = 'goal';
  else nextKey = 'evaluation';

  // Data already known, deferred, declined or previously requested are not re-asked.
  const record = asked[nextKey];
  const alreadyAsked = typeof record === 'number' ? record > 0
    : Boolean(record && (Number(record.count || 0) > 0 || record.status));
  if (present(known[nextKey]) || alreadyAsked || nextKey === pendingKey) {
    return { ...result, action: result.bubbles.length ? 'answer_only' : 'wait' };
  }
  result.questionKey = nextKey;
  result.bubbles.push(variantFor(conversationId, nextKey, QUESTIONS[nextKey]));
  return result;
}

export function recordQuestionDelivered(asked, plan, deliveredMessageId, at = Date.now()) {
  if (!plan.questionKey || !deliveredMessageId) return { ...asked };
  const previous = asked[plan.questionKey];
  const count = typeof previous === 'number' ? previous : Number(previous?.count || 0);
  return { ...asked, [plan.questionKey]: {
    count: count + 1, status: 'asked', messageId: String(deliveredMessageId), at
  } };
}
