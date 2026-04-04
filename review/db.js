/**
 * review/db.js — Read-only queries for EugenIA + WhatsApp review dashboard.
 * Reuses the main db.js pool (same DATABASE_URL).
 */
import pg from "pg";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || null;
const DATABASE_SSL =
  String(process.env.DATABASE_SSL || "false").toLowerCase() === "true";

let pool = null;

function getPool() {
  if (!pool && DATABASE_URL) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
    });
    pool.on("error", (err) =>
      console.error("[review/db] pool error:", err.message)
    );
  }
  return pool;
}

// ═══════════════════════════════════════════════════════════════════
//  EUGENIA — Learning Review
// ═══════════════════════════════════════════════════════════════════

/** Global accuracy breakdown */
export async function eugeniaAccuracy() {
  const { rows } = await getPool().query(`
    SELECT
      count(*)::int                                              AS total,
      count(*) FILTER (WHERE match_type = 'same_intent')::int   AS same_intent,
      count(*) FILTER (WHERE match_type = 'partial_match')::int AS partial_match,
      count(*) FILTER (WHERE match_type = 'different_topic')::int AS different_topic,
      round(avg(match_score)::numeric, 3)                       AS avg_match_score,
      round(avg(outcome_score)::numeric, 1)                     AS avg_outcome_score,
      count(*) FILTER (WHERE is_gold_sample = true)::int        AS gold_samples
    FROM eugenia_predictions
    WHERE human_actual_action IS NOT NULL
  `);
  return rows[0];
}

/** Weekly trends for the last N weeks */
export async function eugeniaTrends(weeks = 12) {
  const { rows } = await getPool().query(
    `SELECT
       date_trunc('week', predicted_at)::date                    AS week,
       count(*)::int                                             AS predictions,
       round(avg(match_score)::numeric, 3)                       AS avg_match,
       count(*) FILTER (WHERE match_type = 'same_intent')::int   AS same_intent,
       count(*) FILTER (WHERE match_type = 'partial_match')::int AS partial,
       count(*) FILTER (WHERE match_type = 'different_topic')::int AS different,
       round(avg(outcome_score)::numeric, 1)                     AS avg_outcome
     FROM eugenia_predictions
     WHERE human_actual_action IS NOT NULL
       AND predicted_at >= now() - ($1 || ' weeks')::interval
     GROUP BY 1 ORDER BY 1`,
    [weeks]
  );
  return rows;
}

/** Gold samples ordered by outcome */
export async function eugeniaGoldSamples(limit = 50) {
  const { rows } = await getPool().query(
    `SELECT id, conversation_id, turn_number, prediction_type,
            ai_suggested_action, human_actual_action,
            match_type, round(match_score::numeric,3) AS match_score,
            outcome_phase, outcome_score, gold_reason,
            predicted_at, compared_at, outcome_at
     FROM eugenia_predictions
     WHERE is_gold_sample = true
     ORDER BY outcome_score DESC, compared_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Agent directives (corrections) */
export async function eugeniaDirectives(limit = 50) {
  const { rows } = await getPool().query(
    `SELECT id, conversation_id, ticket_id, directive_type,
            parsed_field, parsed_value, raw_text, created_at
     FROM eugenia_directives
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Help/feedback sessions */
export async function eugeniaFeedback(limit = 50) {
  const { rows } = await getPool().query(
    `SELECT id, conversation_id, ticket_id, agent_author_id,
            trigger_text, feedback_text,
            prompt_published_at, closed_at, sheet_synced_at
     FROM eugenia_help_sessions
     WHERE feedback_text IS NOT NULL
     ORDER BY closed_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Best/worst suggested actions ranked by outcome */
export async function eugeniaActions() {
  const { rows } = await getPool().query(`
    SELECT ai_suggested_action,
           count(*)::int                          AS times_suggested,
           round(avg(outcome_score)::numeric, 1)  AS avg_outcome,
           round(avg(match_score)::numeric, 3)    AS avg_match,
           count(*) FILTER (WHERE match_type = 'same_intent')::int AS accepted
    FROM eugenia_predictions
    WHERE prediction_type = 'action'
      AND outcome_score IS NOT NULL
    GROUP BY ai_suggested_action
    ORDER BY avg_outcome DESC
  `);
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
//  WHATSAPP — Sentiment & Metrics Review
// ═══════════════════════════════════════════════════════════════════

/** Per-conversation sentiment summary */
export async function whatsappSentiment(days = 30) {
  const { rows } = await getPool().query(
    `SELECT c.id, c.conversation_key, c.client_phone, c.message_count,
            s.agent_name,
            cust.nombres AS customer_nombres, cust.apellidos AS customer_apellidos,
            round(avg(m.text_sentiment_score)::numeric, 3) AS avg_text_sentiment,
            round(avg(m.emoji_sentiment_avg)::numeric, 3)  AS avg_emoji_sentiment,
            count(*) FILTER (WHERE 'buying_signal'     = ANY(m.detected_signals))::int AS buying,
            count(*) FILTER (WHERE 'objection_signal'  = ANY(m.detected_signals))::int AS objections,
            count(*) FILTER (WHERE 'commitment_signal' = ANY(m.detected_signals))::int AS commitments,
            count(*) FILTER (WHERE 'referral_signal'   = ANY(m.detected_signals))::int AS referrals,
            count(*) FILTER (WHERE 'urgency_signal'    = ANY(m.detected_signals))::int AS urgency
     FROM agent_direct_conversations c
     JOIN agent_waha_sessions s ON s.session_name = c.session_name
     LEFT JOIN customers cust ON cust.id = c.customer_id
     JOIN agent_direct_messages m ON m.conversation_id = c.id
     WHERE m.sent_at >= now() - ($1 || ' days')::interval
     GROUP BY c.id, s.agent_name, cust.nombres, cust.apellidos
     ORDER BY c.last_message_at DESC`,
    [days]
  );
  return rows;
}

/** Sentiment trajectory for a single conversation */
export async function whatsappSentimentDetail(conversationId) {
  const { rows } = await getPool().query(
    `SELECT id, direction, body_clean,
            emoji_list, emoji_count,
            round(emoji_sentiment_avg::numeric, 3) AS emoji_sentiment_avg,
            round(text_sentiment_score::numeric, 3) AS text_sentiment_score,
            detected_signals, has_question, word_count, sent_at
     FROM agent_direct_messages
     WHERE conversation_id = $1
     ORDER BY sent_at ASC`,
    [conversationId]
  );
  return rows;
}

/** Signal trends aggregated by day */
export async function whatsappSignals(days = 30) {
  const { rows } = await getPool().query(
    `SELECT date_trunc('day', m.sent_at)::date AS day,
            count(*) FILTER (WHERE 'buying_signal'     = ANY(m.detected_signals))::int AS buying,
            count(*) FILTER (WHERE 'objection_signal'  = ANY(m.detected_signals))::int AS objections,
            count(*) FILTER (WHERE 'commitment_signal' = ANY(m.detected_signals))::int AS commitments,
            count(*) FILTER (WHERE 'referral_signal'   = ANY(m.detected_signals))::int AS referrals,
            count(*) FILTER (WHERE 'urgency_signal'    = ANY(m.detected_signals))::int AS urgency
     FROM agent_direct_messages m
     WHERE m.sent_at >= now() - ($1 || ' days')::interval
     GROUP BY 1 ORDER BY 1`,
    [days]
  );
  return rows;
}

/** Agent performance — average metrics per agent */
export async function whatsappAgents() {
  const { rows } = await getPool().query(`
    SELECT s.agent_name, s.session_name,
           count(DISTINCT c.id)::int AS conversations,
           sum(c.message_count)::int AS total_messages,
           round(avg(sub.avg_text_sentiment)::numeric, 3) AS avg_text_sentiment,
           round(avg(sub.avg_emoji_sentiment)::numeric, 3) AS avg_emoji_sentiment,
           round(avg(sub.buying)::numeric, 1) AS avg_buying_signals,
           round(avg(sub.objections)::numeric, 1) AS avg_objection_signals
    FROM agent_waha_sessions s
    JOIN agent_direct_conversations c ON c.session_name = s.session_name
    JOIN LATERAL (
      SELECT avg(m.text_sentiment_score) AS avg_text_sentiment,
             avg(m.emoji_sentiment_avg)  AS avg_emoji_sentiment,
             count(*) FILTER (WHERE 'buying_signal'    = ANY(m.detected_signals)) AS buying,
             count(*) FILTER (WHERE 'objection_signal' = ANY(m.detected_signals)) AS objections
      FROM agent_direct_messages m WHERE m.conversation_id = c.id
    ) sub ON true
    GROUP BY s.agent_name, s.session_name
    ORDER BY conversations DESC
  `);
  return rows;
}

/** All behavior metrics for a single conversation */
export async function whatsappMetrics(conversationId) {
  const { rows } = await getPool().query(
    `SELECT metric_type, round(metric_value::numeric, 4) AS metric_value,
            context_json, calculated_at
     FROM agent_behavior_metrics
     WHERE conversation_id = $1
     ORDER BY calculated_at DESC`,
    [conversationId]
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD — Consolidated summary
// ═══════════════════════════════════════════════════════════════════

export async function dashboardSummary() {
  const { rows } = await getPool().query(`
    SELECT
      -- EugenIA
      (SELECT count(*)::int FROM eugenia_predictions
       WHERE human_actual_action IS NOT NULL)                       AS ep_total,
      (SELECT count(*)::int FROM eugenia_predictions
       WHERE match_type = 'same_intent')                            AS ep_same_intent,
      (SELECT count(*)::int FROM eugenia_predictions
       WHERE match_type = 'partial_match')                          AS ep_partial,
      (SELECT count(*)::int FROM eugenia_predictions
       WHERE match_type = 'different_topic')                        AS ep_different,
      (SELECT round(avg(match_score)::numeric, 3) FROM eugenia_predictions
       WHERE match_score IS NOT NULL)                               AS ep_avg_match,
      (SELECT round(avg(outcome_score)::numeric, 1) FROM eugenia_predictions
       WHERE outcome_score IS NOT NULL)                             AS ep_avg_outcome,
      (SELECT count(*)::int FROM eugenia_predictions
       WHERE is_gold_sample = true)                                 AS ep_gold_samples,
      (SELECT count(*)::int FROM eugenia_directives)                AS ep_directives,
      (SELECT count(*)::int FROM eugenia_help_sessions
       WHERE feedback_text IS NOT NULL)                             AS ep_feedback_sessions,

      -- WhatsApp Observer
      (SELECT count(*)::int FROM agent_direct_conversations)        AS wa_conversations,
      (SELECT count(*)::int FROM agent_direct_messages)             AS wa_messages,
      (SELECT count(*)::int FROM agent_waha_sessions
       WHERE is_active = true)                                      AS wa_active_agents,
      (SELECT round(avg(text_sentiment_score)::numeric, 3)
       FROM agent_direct_messages
       WHERE text_sentiment_score IS NOT NULL)                      AS wa_avg_text_sentiment,
      (SELECT round(avg(emoji_sentiment_avg)::numeric, 3)
       FROM agent_direct_messages
       WHERE emoji_sentiment_avg IS NOT NULL)                       AS wa_avg_emoji_sentiment,
      (SELECT count(*)::int FROM agent_direct_messages
       WHERE 'buying_signal' = ANY(detected_signals))               AS wa_buying_signals,
      (SELECT count(*)::int FROM agent_direct_messages
       WHERE 'objection_signal' = ANY(detected_signals))            AS wa_objection_signals,
      (SELECT count(*)::int FROM agent_direct_messages
       WHERE 'commitment_signal' = ANY(detected_signals))           AS wa_commitment_signals,
      (SELECT count(*)::int FROM agent_direct_messages
       WHERE 'referral_signal' = ANY(detected_signals))             AS wa_referral_signals,
      (SELECT count(*)::int FROM agent_direct_messages
       WHERE 'urgency_signal' = ANY(detected_signals))              AS wa_urgency_signals,
      (SELECT count(*)::int FROM agent_behavior_metrics)            AS wa_total_metrics
  `);

  const r = rows[0];
  return {
    eugenia: {
      total_predictions: r.ep_total,
      accuracy: {
        same_intent: r.ep_same_intent,
        partial_match: r.ep_partial,
        different_topic: r.ep_different,
      },
      avg_match_score: r.ep_avg_match,
      avg_outcome_score: r.ep_avg_outcome,
      gold_samples: r.ep_gold_samples,
      directives_received: r.ep_directives,
      feedback_sessions: r.ep_feedback_sessions,
    },
    whatsapp: {
      total_conversations: r.wa_conversations,
      total_messages: r.wa_messages,
      active_agents: r.wa_active_agents,
      avg_text_sentiment: r.wa_avg_text_sentiment,
      avg_emoji_sentiment: r.wa_avg_emoji_sentiment,
      signals: {
        buying: r.wa_buying_signals,
        objection: r.wa_objection_signals,
        commitment: r.wa_commitment_signals,
        referral: r.wa_referral_signals,
        urgency: r.wa_urgency_signals,
      },
      total_metrics: r.wa_total_metrics,
    },
  };
}
