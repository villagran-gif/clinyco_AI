import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

// ── Agent WAHA Sessions ──

export async function getSession(sessionName) {
  const { rows } = await pool.query(
    `SELECT * FROM agent_waha_sessions WHERE session_name = $1 AND is_active = true`,
    [sessionName]
  );
  return rows[0] || null;
}

export async function ensureSession(sessionName, agentName, agentPhone) {
  const { rows } = await pool.query(
    `INSERT INTO agent_waha_sessions (session_name, agent_name, agent_phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_name) DO UPDATE SET
       agent_name = EXCLUDED.agent_name,
       agent_phone = COALESCE(EXCLUDED.agent_phone, agent_waha_sessions.agent_phone)
     RETURNING *`,
    [sessionName, agentName, agentPhone]
  );
  return rows[0];
}

// ── Agent Direct Conversations ──

export async function findConversation(conversationKey) {
  const { rows } = await pool.query(
    `SELECT * FROM agent_direct_conversations WHERE conversation_key = $1`,
    [conversationKey]
  );
  return rows[0] || null;
}

export async function createConversation({ conversationKey, sessionName, clientPhone, customerId, matchStatus }) {
  // Idempotent upsert: if a concurrent webhook already created this row,
  // just return the existing one without overwriting customer_id/match_status.
  const { rows } = await pool.query(
    `INSERT INTO agent_direct_conversations
       (conversation_key, session_name, client_phone, customer_id, match_status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (conversation_key) DO UPDATE SET
       updated_at = now()
     RETURNING *`,
    [conversationKey, sessionName, clientPhone, customerId, matchStatus]
  );
  return rows[0];
}

export async function updateConversationStats(conversationId, sentAt) {
  await pool.query(
    `UPDATE agent_direct_conversations SET
       message_count = message_count + 1,
       first_message_at = COALESCE(first_message_at, $2),
       last_message_at = $2,
       updated_at = now()
     WHERE id = $1`,
    [conversationId, sentAt]
  );
}

// ── Customer Matching ──

export async function findCustomerByPhone(phone) {
  // Try customers.whatsapp_phone first
  const { rows } = await pool.query(
    `SELECT id, whatsapp_phone, nombres, apellidos, rut
     FROM customers
     WHERE whatsapp_phone = $1
     LIMIT 1`,
    [phone]
  );
  if (rows[0]) return rows[0];

  // Try customer_channels
  const { rows: channelRows } = await pool.query(
    `SELECT c.id, c.whatsapp_phone, c.nombres, c.apellidos, c.rut
     FROM customer_channels cc
     JOIN customers c ON c.id = cc.customer_id
     WHERE cc.channel_type = 'whatsapp' AND cc.channel_value = $1
     LIMIT 1`,
    [phone]
  );
  return channelRows[0] || null;
}

export async function findCustomerByRut(rutNormalized) {
  // rutNormalized is in canonical form: "XXXXXXXX-X" (no dots, uppercase DV).
  // customers.rut is stored in the same canonical form, so direct equality
  // works. See extraction/identity-normalizers.js :: normalizeRut.
  const { rows } = await pool.query(
    `SELECT id, whatsapp_phone, nombres, apellidos, rut
     FROM customers
     WHERE rut = $1
     LIMIT 1`,
    [rutNormalized]
  );
  return rows[0] || null;
}

// ── Agent Direct Messages ──

export async function insertMessage({
  conversationId, wahaMessageId, direction, body, hasMedia, mediaType,
  pushName, rawJson, bodyClean, bodyTextOnly, emojiList, emojiCount,
  emojiSentimentAvg, emojiSentimentMin, emojiSentimentMax,
  textSentimentScore, wordCount, hasQuestion, hasUrl, detectedSignals,
  hourOfDay, dayOfWeek, sentAt
}) {
  const { rows } = await pool.query(
    `INSERT INTO agent_direct_messages (
       conversation_id, waha_message_id, direction, body, has_media, media_type,
       push_name, raw_json, body_clean, body_text_only, emoji_list, emoji_count,
       emoji_sentiment_avg, emoji_sentiment_min, emoji_sentiment_max,
       text_sentiment_score, word_count, has_question, has_url, detected_signals,
       hour_of_day, day_of_week, sent_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12,
       $13, $14, $15,
       $16, $17, $18, $19, $20,
       $21, $22, $23
     )
     ON CONFLICT (waha_message_id) WHERE waha_message_id IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [
      conversationId, wahaMessageId, direction, body, hasMedia, mediaType,
      pushName, rawJson, bodyClean, bodyTextOnly, emojiList, emojiCount,
      emojiSentimentAvg, emojiSentimentMin, emojiSentimentMax,
      textSentimentScore, wordCount, hasQuestion, hasUrl, detectedSignals,
      hourOfDay, dayOfWeek, sentAt
    ]
  );
  return rows[0] || null; // null if dedup
}

// ── Behavior Metrics ──

export async function insertMetric(conversationId, metricType, metricValue, contextJson = null) {
  await pool.query(
    `INSERT INTO agent_behavior_metrics (conversation_id, metric_type, metric_value, context_json)
     VALUES ($1, $2, $3, $4)`,
    [conversationId, metricType, metricValue, contextJson]
  );
}

export async function getLastMessageByDirection(conversationId, direction) {
  const { rows } = await pool.query(
    `SELECT * FROM agent_direct_messages
     WHERE conversation_id = $1 AND direction = $2
     ORDER BY sent_at DESC LIMIT 1`,
    [conversationId, direction]
  );
  return rows[0] || null;
}

export async function getConversationMessages(conversationId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM agent_direct_messages
     WHERE conversation_id = $1
     ORDER BY sent_at ASC
     LIMIT $2`,
    [conversationId, limit]
  );
  return rows;
}

export async function getMessageCount(conversationId) {
  const { rows } = await pool.query(
    `SELECT message_count FROM agent_direct_conversations WHERE id = $1`,
    [conversationId]
  );
  return rows[0]?.message_count || 0;
}

// ── Emoji Sentiment Lookup ──

export async function getEmojiSentiment(emoji) {
  const { rows } = await pool.query(
    `SELECT sentiment_score, negative, neutral, positive
     FROM emoji_sentiment_lookup WHERE emoji = $1`,
    [emoji]
  );
  return rows[0] || null;
}

export async function getEmojiSentimentBatch(emojis) {
  if (!emojis.length) return new Map();
  const { rows } = await pool.query(
    `SELECT emoji, sentiment_score, negative, neutral, positive
     FROM emoji_sentiment_lookup WHERE emoji = ANY($1)`,
    [emojis]
  );
  const map = new Map();
  for (const row of rows) map.set(row.emoji, row);
  return map;
}

// ── Stats ──

export async function getStats() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*) FROM agent_waha_sessions WHERE is_active = true) AS active_sessions,
      (SELECT count(*) FROM agent_direct_conversations) AS total_conversations,
      (SELECT count(*) FROM agent_direct_messages) AS total_messages,
      (SELECT count(*) FROM agent_behavior_metrics) AS total_metrics
  `);
  return rows[0];
}

export async function getRecentConversations(limit = 20) {
  const { rows } = await pool.query(
    `SELECT adc.*, aws.agent_name,
            c.nombres AS customer_nombres, c.apellidos AS customer_apellidos
     FROM agent_direct_conversations adc
     JOIN agent_waha_sessions aws ON aws.session_name = adc.session_name
     LEFT JOIN customers c ON c.id = adc.customer_id
     ORDER BY adc.last_message_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export { pool };
