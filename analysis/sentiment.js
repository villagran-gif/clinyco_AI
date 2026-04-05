/**
 * analysis/sentiment.js — Shared sentiment analysis for all message sources.
 * Reuses the same logic as waha-dev/observer/behavior-tracker.js
 * but works with the main db.js pool (no observer dependency).
 *
 * Used by: server.js (Zendesk messages), review backfill scripts.
 */

// ── Regex patterns ──
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;
const URL_RE = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
const QUESTION_RE = /\?|^(qué|cómo|cuándo|dónde|cuánto|cuál|quién|por qué)(?=\s|$)/im;

// ── Sales signal keywords (Chilean Spanish) ──
const BUYING_SIGNALS = [
  "cuánto cuesta", "cuanto cuesta", "cuánto vale", "cuanto vale",
  "precio", "valor", "costo",
  "agendar", "reservar", "cuándo puedo", "cuando puedo",
  "horario disponible",
  "tienen hora", "me interesa", "quiero hacerme",
  "cómo me inscribo", "como me inscribo",
  "formas de pago", "cuotas", "financiamiento",
];
const OBJECTION_SIGNALS = [
  "lo voy a pensar", "no estoy segur", "es muy caro", "muy costoso",
  "después te aviso", "no puedo", "no me alcanza", "tengo que consultar",
  "déjame ver", "lo converso", "no sé si", "me da miedo",
];
const COMMITMENT_SIGNALS = [
  "listo", "dale", "perfecto", "de acuerdo", "cuándo es",
  "nos vemos", "confirmo", "agendado", "ya está", "ok listo",
  "hecho", "genial", "excelente", "vamos",
];
const REFERRAL_SIGNALS = [
  "me recomendaron", "me recomendó", "un amigo", "una amiga",
  "mi doctor me dijo", "mi doctora", "me derivaron", "me derivó",
];
const URGENCY_SIGNALS = [
  "lo antes posible", "urgente", "esta semana", "mañana mismo",
  "lo más pronto", "cuanto antes", "hoy mismo",
];

// ── Text sentiment keywords ──
const POSITIVE_WORDS = [
  "gracias", "excelente", "genial", "perfecto", "maravilloso", "increíble",
  "feliz", "contento", "contenta", "agradecido", "agradecida", "bueno",
  "buena", "bien", "mejor", "encanta", "amor", "lindo", "linda", "hermoso",
  "tremendo", "bacán", "pulento", "filete",
];
const NEGATIVE_WORDS = [
  "malo", "mala", "horrible", "terrible", "pésimo", "pésima", "triste",
  "enojado", "enojada", "furioso", "furiosa", "decepcionado", "decepcionada",
  "dolor", "duele", "miedo", "preocupado", "preocupada", "problema",
  "queja", "reclamo", "molesto", "molesta", "fome", "penca",
];

/**
 * Analyze message text for sentiment, emojis, signals.
 * @param {string} body - Message text
 * @param {function} getEmojiSentimentBatch - async (emojis[]) => Map<emoji, {sentiment_score}>
 *   Pass null to skip emoji DB lookup (text-only analysis).
 * @returns {object} Analysis results
 */
export async function analyzeMessage(body, getEmojiSentimentBatch = null) {
  const text = body || "";

  // ── Emoji extraction ──
  const emojiMatches = text.match(EMOJI_RE) || [];
  const emojiList = [...new Set(emojiMatches)];
  const emojiCount = emojiMatches.length;

  let emojiSentimentAvg = null;
  if (emojiList.length > 0 && getEmojiSentimentBatch) {
    const sentimentMap = await getEmojiSentimentBatch(emojiList);
    const scores = [];
    for (const emoji of emojiMatches) {
      const data = sentimentMap.get(emoji);
      if (data) scores.push(parseFloat(data.sentiment_score));
    }
    if (scores.length > 0) {
      emojiSentimentAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }

  // ── Text sentiment ──
  const bodyTextOnly = text.replace(EMOJI_RE, "").replace(URL_RE, "").replace(/\s+/g, " ").trim();
  const lowerText = bodyTextOnly.toLowerCase();
  const words = lowerText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  let posCount = 0;
  let negCount = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.some((pw) => w.includes(pw))) posCount++;
    if (NEGATIVE_WORDS.some((nw) => w.includes(nw))) negCount++;
  }
  const total = posCount + negCount;
  const textSentimentScore = total > 0
    ? Math.round(((posCount - negCount) / total) * 1000) / 1000
    : 0;

  // ── Question detection ──
  const hasQuestion = QUESTION_RE.test(text);

  // ── Sales signals ──
  const detectedSignals = [];
  const lower = text.toLowerCase();
  if (BUYING_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("buying_signal");
  if (OBJECTION_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("objection_signal");
  if (COMMITMENT_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("commitment_signal");
  if (REFERRAL_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("referral_signal");
  if (URGENCY_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("urgency_signal");

  return {
    emojiList,
    emojiCount,
    emojiSentimentAvg,
    textSentimentScore,
    wordCount,
    hasQuestion,
    detectedSignals,
  };
}
