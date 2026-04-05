import * as db from "./db.js";

// ── Emoji extraction regex (Unicode Emoji_Presentation + text emojis with VS16) ──
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;

// ── URL detection ──
const URL_RE = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

// ── Question detection (Spanish) ──
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

// ── Formality markers (Chilean Spanish) ──
const INFORMAL_MARKERS = [
  "po", "poh", "cachai", "cachai?", "dale", "wena", "weno",
  "sipo", "nopo", "ya po", "onda", "bkn", "pulento",
];

// ── Text sentiment: simple keyword-based heuristic ──
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
 * Per-message analysis: extract emojis, sentiment, signals, text metrics.
 * Called for every incoming message before storage.
 */
export async function analyzeMessage(body, sentAt) {
  const text = body || "";

  // ── Clean body variants ──
  const bodyClean = text.replace(URL_RE, "").replace(/\s+/g, " ").trim();
  const emojiMatches = text.match(EMOJI_RE) || [];
  const bodyTextOnly = text.replace(EMOJI_RE, "").replace(URL_RE, "").replace(/\s+/g, " ").trim();

  // ── Emoji analysis ──
  const emojiList = [...new Set(emojiMatches)]; // unique emojis
  const emojiCount = emojiMatches.length;

  let emojiSentimentAvg = null;
  let emojiSentimentMin = null;
  let emojiSentimentMax = null;

  if (emojiList.length > 0) {
    const sentimentMap = await db.getEmojiSentimentBatch(emojiList);
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

  // ── Text sentiment (simple heuristic) ──
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
  };
}

// ════════════════════════════════════════════════════════════
// Behavioral metrics — computed after message is stored
// ════════════════════════════════════════════════════════════

/**
 * Main entry: compute all applicable metrics for a newly stored message.
 */
export async function onMessage(conversationId, message, direction) {
  try {
    // 1. Always: message length
    await trackMessageLength(conversationId, message, direction);

    // 2. Always: sales signals as metrics
    await trackSalesSignalMetrics(conversationId, message);

    // 3. Always: emoji metrics
    await trackEmojiMetrics(conversationId, message);

    // 4. Response time (only when agent replies to client)
    if (direction === "agent_to_client") {
      await trackResponseTime(conversationId, message);
    }

    // 5. Aggregate metrics every 5 messages
    const msgCount = await db.getMessageCount(conversationId);
    if (msgCount > 0 && msgCount % 5 === 0) {
      await computeAggregateMetrics(conversationId);
    }
  } catch (err) {
    console.error(`[behavior-tracker] Error computing metrics for conv #${conversationId}:`, err.message);
  }
}

// ── Temporal metrics ──

async function trackResponseTime(conversationId, agentMessage) {
  const lastClientMsg = await db.getLastMessageByDirection(conversationId, "client_to_agent");
  if (!lastClientMsg || !lastClientMsg.sent_at) return;

  const agentSentAt = new Date(agentMessage.sent_at);
  const clientSentAt = new Date(lastClientMsg.sent_at);
  const deltaSeconds = (agentSentAt - clientSentAt) / 1000;

  if (deltaSeconds <= 0 || deltaSeconds > 86400 * 7) return; // ignore negative or >7 days

  await db.insertMetric(conversationId, "response_time", deltaSeconds, {
    agent_message_id: agentMessage.id,
    client_message_id: lastClientMsg.id,
  });

  // First response time (only if this is the first agent message)
  const messages = await db.getConversationMessages(conversationId, 5);
  const agentMessages = messages.filter((m) => m.direction === "agent_to_client");
  if (agentMessages.length === 1) {
    await db.insertMetric(conversationId, "first_response_time", deltaSeconds, {
      agent_message_id: agentMessage.id,
    });
  }
}

async function trackMessageLength(conversationId, message, direction) {
  const length = (message.body || "").length;
  await db.insertMetric(conversationId, "message_length", length, {
    direction,
    message_id: message.id,
  });
}

// ── Emoji metrics ──

async function trackEmojiMetrics(conversationId, message) {
  if (message.emoji_count > 0) {
    await db.insertMetric(conversationId, "emoji_count", message.emoji_count, {
      message_id: message.id,
      emojis: message.emoji_list,
    });
  }
  if (message.emoji_sentiment_avg !== null) {
    await db.insertMetric(conversationId, "emoji_sentiment_score", message.emoji_sentiment_avg, {
      message_id: message.id,
      min: message.emoji_sentiment_min,
      max: message.emoji_sentiment_max,
    });
  }
}

// ── Sales signal metrics ──

async function trackSalesSignalMetrics(conversationId, message) {
  const signals = message.detected_signals || [];
  for (const signal of signals) {
    await db.insertMetric(conversationId, signal, 1, {
      message_id: message.id,
      direction: message.direction,
      body_preview: (message.body || "").substring(0, 100),
    });
  }
}

// ── Aggregate metrics (recomputed every 5 messages) ──

async function computeAggregateMetrics(conversationId) {
  const messages = await db.getConversationMessages(conversationId, 500);
  if (messages.length < 2) return;

  const agentMsgs = messages.filter((m) => m.direction === "agent_to_client");
  const clientMsgs = messages.filter((m) => m.direction === "client_to_agent");

  // Session duration
  const first = new Date(messages[0].sent_at);
  const last = new Date(messages[messages.length - 1].sent_at);
  const durationSeconds = (last - first) / 1000;
  if (durationSeconds > 0) {
    await db.insertMetric(conversationId, "session_duration", durationSeconds);
  }

  // Message cadence (avg interval between consecutive messages)
  const intervals = [];
  for (let i = 1; i < messages.length; i++) {
    const delta = (new Date(messages[i].sent_at) - new Date(messages[i - 1].sent_at)) / 1000;
    if (delta > 0 && delta < 86400 * 7) intervals.push(delta);
  }
  if (intervals.length > 0) {
    const avgCadence = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    await db.insertMetric(conversationId, "message_cadence", avgCadence);
  }

  // Turn-taking ratio
  if (clientMsgs.length > 0) {
    const ratio = agentMsgs.length / clientMsgs.length;
    await db.insertMetric(conversationId, "turn_taking_ratio", Math.round(ratio * 100) / 100);
  }

  // Question density (agent and client)
  if (agentMsgs.length > 0) {
    const agentQuestions = agentMsgs.filter((m) => m.has_question).length;
    await db.insertMetric(conversationId, "question_density_agent",
      Math.round((agentQuestions / agentMsgs.length) * 100) / 100);
  }
  if (clientMsgs.length > 0) {
    const clientQuestions = clientMsgs.filter((m) => m.has_question).length;
    await db.insertMetric(conversationId, "question_density_client",
      Math.round((clientQuestions / clientMsgs.length) * 100) / 100);
  }

  // Longest streaks
  let longestAgentStreak = 0;
  let longestClientStreak = 0;
  let currentStreak = 0;
  let currentDir = null;
  for (const m of messages) {
    if (m.direction === currentDir) {
      currentStreak++;
    } else {
      currentStreak = 1;
      currentDir = m.direction;
    }
    if (currentDir === "agent_to_client") longestAgentStreak = Math.max(longestAgentStreak, currentStreak);
    if (currentDir === "client_to_agent") longestClientStreak = Math.max(longestClientStreak, currentStreak);
  }
  await db.insertMetric(conversationId, "longest_agent_streak", longestAgentStreak);
  await db.insertMetric(conversationId, "longest_client_streak", longestClientStreak);

  // Conversation gap max (hours)
  if (intervals.length > 0) {
    const maxGapHours = Math.max(...intervals) / 3600;
    await db.insertMetric(conversationId, "conversation_gap_max", Math.round(maxGapHours * 100) / 100);
  }

  // Active hours distribution (peak hour)
  const hourCounts = new Array(24).fill(0);
  for (const m of messages) {
    const h = m.hour_of_day ?? new Date(m.sent_at).getHours();
    hourCounts[h]++;
  }
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  await db.insertMetric(conversationId, "active_hours", peakHour, {
    distribution: hourCounts,
  });

  // Response time trend (linear regression slope of response times)
  await computeResponseTimeTrend(conversationId, messages);

  // Linguistic metrics
  await computeLinguisticMetrics(conversationId, messages, agentMsgs, clientMsgs);

  // Emoji mirroring
  await computeEmojiMirroring(conversationId, agentMsgs, clientMsgs);
}

// ── Response time trend ──

async function computeResponseTimeTrend(conversationId, messages) {
  const responseTimes = [];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].direction === "agent_to_client" && messages[i - 1].direction === "client_to_agent") {
      const delta = (new Date(messages[i].sent_at) - new Date(messages[i - 1].sent_at)) / 1000;
      if (delta > 0 && delta < 86400) responseTimes.push(delta);
    }
  }
  if (responseTimes.length < 3) return;

  // Simple linear regression: y = mx + b, we want m (slope)
  const n = responseTimes.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += responseTimes[i];
    sumXY += i * responseTimes[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  if (isFinite(slope)) {
    await db.insertMetric(conversationId, "response_time_trend", Math.round(slope * 100) / 100, {
      data_points: n,
    });
  }
}

// ── Linguistic metrics ──

async function computeLinguisticMetrics(conversationId, messages, agentMsgs, clientMsgs) {
  // Formality shift: compare informal marker ratio in first vs last third
  if (agentMsgs.length >= 6) {
    const third = Math.floor(agentMsgs.length / 3);
    const firstThird = agentMsgs.slice(0, third);
    const lastThird = agentMsgs.slice(-third);

    const informalRatio = (msgs) => {
      const allWords = msgs.map((m) => (m.body || "").toLowerCase()).join(" ").split(/\s+/);
      if (allWords.length === 0) return 0;
      const informalCount = allWords.filter((w) =>
        INFORMAL_MARKERS.some((marker) => w === marker || w.startsWith(marker))
      ).length;
      return informalCount / allWords.length;
    };

    const firstRatio = informalRatio(firstThird);
    const lastRatio = informalRatio(lastThird);
    const shift = lastRatio - firstRatio; // positive = became more informal = trust building
    await db.insertMetric(conversationId, "formality_shift", Math.round(shift * 1000) / 1000, {
      first_third_ratio: firstRatio,
      last_third_ratio: lastRatio,
    });
  }

  // Lexical convergence (Jaccard similarity of unique tokens agent vs client)
  if (agentMsgs.length > 0 && clientMsgs.length > 0) {
    const agentTokens = new Set(
      agentMsgs.flatMap((m) => (m.body_text_only || m.body || "").toLowerCase().split(/\s+/).filter(Boolean))
    );
    const clientTokens = new Set(
      clientMsgs.flatMap((m) => (m.body_text_only || m.body || "").toLowerCase().split(/\s+/).filter(Boolean))
    );
    const intersection = new Set([...agentTokens].filter((t) => clientTokens.has(t)));
    const union = new Set([...agentTokens, ...clientTokens]);
    const jaccard = union.size > 0 ? intersection.size / union.size : 0;
    await db.insertMetric(conversationId, "lexical_convergence", Math.round(jaccard * 1000) / 1000);
  }

  // Personalization score: how often agent uses client's pushName
  if (agentMsgs.length > 0 && clientMsgs.length > 0) {
    const clientName = clientMsgs[0].push_name;
    if (clientName && clientName.length > 2) {
      const nameLower = clientName.toLowerCase().split(/\s+/)[0]; // first name
      const agentTexts = agentMsgs.map((m) => (m.body || "").toLowerCase());
      const mentions = agentTexts.filter((t) => t.includes(nameLower)).length;
      const score = mentions / agentMsgs.length;
      await db.insertMetric(conversationId, "personalization_score", Math.round(score * 1000) / 1000, {
        client_name: nameLower,
        mentions,
      });
    }
  }

  // Media sharing rate
  const mediaMessages = messages.filter((m) => m.has_media).length;
  if (messages.length > 0) {
    await db.insertMetric(conversationId, "media_sharing_rate",
      Math.round((mediaMessages / messages.length) * 1000) / 1000);
  }

  // Sentiment trajectory (slope of text_sentiment_score over messages)
  const sentimentScores = messages
    .map((m) => m.text_sentiment_score)
    .filter((s) => s !== null && s !== undefined);
  if (sentimentScores.length >= 3) {
    const n = sentimentScores.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      const val = parseFloat(sentimentScores[i]);
      sumX += i;
      sumY += val;
      sumXY += i * val;
      sumX2 += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    if (isFinite(slope)) {
      await db.insertMetric(conversationId, "sentiment_trajectory", Math.round(slope * 1000) / 1000);
    }
  }
}

// ── Emoji mirroring ──

async function computeEmojiMirroring(conversationId, agentMsgs, clientMsgs) {
  const agentEmojis = new Set(agentMsgs.flatMap((m) => m.emoji_list || []));
  const clientEmojis = new Set(clientMsgs.flatMap((m) => m.emoji_list || []));

  if (agentEmojis.size === 0 && clientEmojis.size === 0) return;

  const allEmojis = new Set([...agentEmojis, ...clientEmojis]);
  const shared = [...agentEmojis].filter((e) => clientEmojis.has(e)).length;
  const mirrorScore = allEmojis.size > 0 ? shared / allEmojis.size : 0;

  await db.insertMetric(conversationId, "emoji_mirroring", Math.round(mirrorScore * 1000) / 1000, {
    agent_unique: agentEmojis.size,
    client_unique: clientEmojis.size,
    shared,
  });

  // Emoji diversity (unique / total) for each side
  for (const [label, msgs] of [["agent", agentMsgs], ["client", clientMsgs]]) {
    const allEmojiOccurrences = msgs.flatMap((m) => {
      const text = m.body || "";
      return text.match(EMOJI_RE) || [];
    });
    if (allEmojiOccurrences.length > 0) {
      const unique = new Set(allEmojiOccurrences).size;
      const diversity = unique / allEmojiOccurrences.length;
      await db.insertMetric(conversationId, `emoji_diversity_${label}`,
        Math.round(diversity * 1000) / 1000, { unique, total: allEmojiOccurrences.length });
    }
  }
}
