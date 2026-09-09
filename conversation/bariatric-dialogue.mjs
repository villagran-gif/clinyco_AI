/** Structured presentation layer; never infers medical eligibility or invents prices. */
export const SURGERY_TRACKS = Object.freeze([
  'primary_sleeve', 'primary_rygb', 'metabolic_evaluation',
  'sleeve_to_bypass', 'revision_after_sleeve', 'revision_after_bypass',
  'other_revision', 'postoperative_support',
]);

// A question is a stable key. Its text is presentation, never the parser contract.
const QUESTIONS = Object.freeze({
  prior_surgery: [
    '¿Qué cirugía bariátrica te realizaron anteriormente?',
    'Para orientarte mejor, ¿tu cirugía anterior fue manga, bypass u otra?',
    '¿Cuál fue la operación bariátrica que te hicieron?',
  ],
  prior_year: [
    '¿En qué año te realizaron esa cirugía?',
    '¿De qué año es tu operación?',
    '¿Recuerdas el año en que te operaste?',
  ],
  revision_reason: [
    '¿Qué te gustaría resolver: recuperación de peso, reflujo u otro motivo?',
    '¿Estás consultando por el peso, por reflujo o por otra molestia?',
    '¿Cuál es el motivo principal por el que estás evaluando otra cirugía?',
  ],
  weight: ['¿Cuánto pesas actualmente?', '¿Cuál es tu peso actual?', '¿Me indicas tu peso de hoy?'],
  height: ['¿Cuánto mides?', '¿Cuál es tu estatura?', '¿Me indicas tu estatura?'],
  insurance: ['¿Tu previsión es Fonasa, Isapre o particular?', '¿Con qué previsión de salud cuentas?', '¿Tienes Fonasa, Isapre o atención particular?'],
  city: ['¿En qué ciudad te gustaría atenderte?', '¿Qué sede prefieres para tu atención?', '¿En qué ciudad buscas la evaluación?'],
});

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function isKnownAnswer(answers, key) {
  const value = answers?.[key];
  return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
}

/** Classification signals may coexist: e.g. a complaint plus a price question. */
export function detectConversationInterruptions(text = '') {
  const t = normalize(text);
  return {
    repair: /ya\s+(?:te\s+|le\s+|lo\s+)?(?:respondi|conteste|dije)|me\s+(?:lo\s+)?preguntaste|otra vez/.test(t),
    identity: /(?:eres|es|sos)\s+(?:un[ao]?\s+)?(?:robot|bot|ia|inteligencia artificial)|(?:eres|es)\s+(?:una\s+)?persona/.test(t),
    price: /\b(?:valor|precio|costo|cuesta|cotizar|presupuesto)\b/.test(t),
    financing: /financiam|\bcuotas\b|formas? de pago|medios? de pago/.test(t),
    location: /como (?:llego|llegar)|\bdireccion\b|\bubicacion\b|donde (?:estan|queda)/.test(t),
    scheduling: /\b(?:agendar|reagendar|reservar|cancelar)\b|\bcambiar (?:la )?hora\b|\btomar (?:una )?hora\b/.test(t),
    human: /(?:hablar|contactar|comunicar|pasame|deriva).*(?:persona|humano|agente|ejecutiv)/.test(t),
    acknowledgement: /^(?:gracias|ok|okay|perfecto|dale|ya|bueno)[!.\s]*$/.test(t.trim()),
  };
}

/** Known answers win. Any clarification is a distinct, audited action. */
export function presentBariatricQuestion(key, { answers = {}, askedKeys = {}, variantIndex = 0 } = {}) {
  if (!QUESTIONS[key]) throw new RangeError(`Unknown question key: ${key}`);
  if (isKnownAnswer(answers, key)) return { action: 'skip_known', questionKey: key };
  if (Number(askedKeys[key] || 0) > 0) return { action: 'repair_or_wait', questionKey: key };
  const options = QUESTIONS[key];
  const index = Number.isSafeInteger(variantIndex) ? ((variantIndex % options.length) + options.length) % options.length : 0;
  return { action: 'ask', questionKey: key, variantId: `${key}:${index}`, text: options[index] };
}

/** No clinical facts from generic "sí"; it only answers an explicit proposition. */
export function parsePriorSurgeryAnswer(text, question = {}) {
  const t = normalize(text).trim();
  if (/^(?:si|sip|claro|correcto)[.!\s]*$/.test(t)) {
    return question.key === 'prior_surgery' && ['manga', 'bypass'].includes(question.proposition)
      ? question.proposition : null;
  }
  if (/^(?:no|ninguna)[.!\s]*$/.test(t) || /nunca me he operado|no me he operado/.test(t)) return 'ninguna';
  if (/no tengo.*manga|no tengo.*bypass/.test(t)) return null;
  if (/\bmanga\b/.test(t) && !/quiero|precio|valor|cuesta|\?/.test(t)) return 'manga';
  if (/\bbypass\b/.test(t) && !/quiero|precio|valor|cuesta|\?/.test(t)) return 'bypass';
  return null;
}
