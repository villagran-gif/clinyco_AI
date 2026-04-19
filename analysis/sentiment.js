/**
 * analysis/sentiment.js — Shared sentiment analysis for all message sources.
 *
 * Used by: server.js (Zendesk messages), waha-dev/observer (WAHA messages),
 *          review backfill scripts, refill scripts.
 */

export const ANALYSIS_VERSION = 2;

// ── Regex patterns ──
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;
const URL_RE = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
const QUESTION_RE = /\?|^(qué|cómo|cuándo|dónde|cuánto|cuál|quién|por qué)\b/im;

// ── Sales signal keywords (Chilean Spanish) ──
const BUYING_SIGNALS = [
  "cuánto cuesta", "cuánto vale", "precio", "valor", "costo",
  "agendar", "reservar", "cuándo puedo", "horario disponible",
  "tienen hora", "me interesa", "quiero hacerme", "cómo me inscribo",
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
  "lo antes posible", "urgente", "esta semana", "mañana",
  "lo más pronto", "cuanto antes", "hoy mismo", "ya",
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
 * @param {object} [opts]
 * @param {boolean} [opts.useLLM=false] - Use LLM classifier (requires sentiment-llm.js)
 * @param {function} [opts.getGoldSamples] - async () => gold samples for few-shot
 * @returns {object} Analysis results
 */
export async function analyzeMessage(body, getEmojiSentimentBatch = null, opts = {}) {
  const text = body || "";

  // ── Emoji extraction ──
  const emojiMatches = text.match(EMOJI_RE) || [];
  const emojiList = [...new Set(emojiMatches)];
  const emojiCount = emojiMatches.length;

  let emojiSentimentAvg = null;
  let emojiSentimentMin = null;
  let emojiSentimentMax = null;
  if (emojiList.length > 0 && getEmojiSentimentBatch) {
    const sentimentMap = await getEmojiSentimentBatch(emojiList);
    const scores = [];
    for (const emoji of emojiMatches) {
      const data = sentimentMap.get(emoji);
      if (data) scores.push(parseFloat(data.sentiment_score));
    }
    if (scores.length > 0) {
      emojiSentimentAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
      emojiSentimentMin = Math.min(...scores);
      emojiSentimentMax = Math.max(...scores);
    }
  }

  // ── Text sentiment ──
  const bodyClean = text.replace(URL_RE, "").replace(/\s+/g, " ").trim();
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
  let textSentimentScore = total > 0
    ? Math.round(((posCount - negCount) / total) * 1000) / 1000
    : 0;

  // ── Question & URL detection ──
  const hasQuestion = QUESTION_RE.test(text);
  const hasUrl = URL_RE.test(text);

  // ── Sales signals ──
  const detectedSignals = [];
  const lower = text.toLowerCase();
  if (BUYING_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("buying_signal");
  if (OBJECTION_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("objection_signal");
  if (COMMITMENT_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("commitment_signal");
  if (REFERRAL_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("referral_signal");
  if (URGENCY_SIGNALS.some((s) => lower.includes(s))) detectedSignals.push("urgency_signal");

  let sentimentModel = "keyword-v1";
  let sentimentConfidence = total > 0 ? 0.3 : 0.1;
  let sentimentRationale = null;

  if (opts.useLLM) {
    try {
      const { classifyWithLLM } = await import("./sentiment-llm.js");
      const llmResult = await classifyWithLLM(bodyTextOnly, opts.getGoldSamples);
      if (llmResult) {
        textSentimentScore = llmResult.score;
        sentimentModel = llmResult.model;
        sentimentConfidence = llmResult.confidence;
        sentimentRationale = llmResult.rationale;
      }
    } catch {
      // LLM failed — keep keyword results as fallback
    }
  }

  return {
    bodyClean,
    bodyTextOnly,
    emojiList,
    emojiCount,
    emojiSentimentAvg,
    emojiSentimentMin,
    emojiSentimentMax,
    textSentimentScore,
    wordCount,
    hasQuestion,
    hasUrl,
    detectedSignals,
    sentimentModel,
    sentimentConfidence,
    sentimentRationale,
    analysisVersion: ANALYSIS_VERSION,
  };
}
