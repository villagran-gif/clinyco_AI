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
//  DEALS — Zendesk Sell Performance
// ═══════════════════════════════════════════════════════════════════

/** Deal phase summary across all agents */
export async function dealsSummary() {
  const { rows } = await getPool().query(`
    SELECT pipeline_phase, count(*)::int AS total
    FROM deals
    WHERE pipeline_phase IS NOT NULL
    GROUP BY pipeline_phase
    ORDER BY total DESC
  `);
  return rows;
}

/** Deal performance per agent — success = CERRADO AGENDADO/OPERADO/INSTALADO */
export async function dealsPerAgent() {
  const { rows } = await getPool().query(`
    SELECT d.owner_name,
           count(*)::int AS total_deals,
           count(*) FILTER (WHERE d.pipeline_phase IN (
             'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
           ))::int AS deals_exitosos,
           count(*) FILTER (WHERE d.pipeline_phase = 'CERRADO OPERADO')::int AS operados,
           count(*) FILTER (WHERE d.pipeline_phase = 'CERRADO AGENDADO')::int AS agendados,
           count(*) FILTER (WHERE d.pipeline_phase = 'CERRADO INSTALADO')::int AS instalados,
           count(*) FILTER (WHERE d.pipeline_phase = 'SIN RESPUESTA')::int AS sin_respuesta,
           count(*) FILTER (WHERE d.pipeline_phase = 'SUSPENDIDO')::int AS suspendidos,
           count(*) FILTER (WHERE d.pipeline_phase = 'DESCALIFICADO')::int AS descalificados,
           count(*) FILTER (WHERE d.pipeline_phase IN (
             'EXAMENES ENVIADOS','EXAMENES PRE-PAD ENVIADOS','ORDEN DE EXAMENES',
             'EXAMENES ALLURION','EXAMENES ORBERA'
           ))::int AS en_examenes,
           count(*) FILTER (WHERE d.pipeline_phase IN (
             'PROCESO PREOP','PROCESO PRE-OPERATORIO','CONTROLES PRE-INSTALACIÓN'
           ))::int AS en_proceso,
           count(*) FILTER (WHERE d.pipeline_phase IN ('CANDIDATO','CANDIDATOS'))::int AS candidatos,
           CASE WHEN count(*) > 0
             THEN round(
               count(*) FILTER (WHERE d.pipeline_phase IN (
                 'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
               ))::numeric / count(*)::numeric * 100, 1)
             ELSE 0 END AS tasa_exito
    FROM deals d
    GROUP BY d.owner_name
    ORDER BY deals_exitosos DESC
  `);
  return rows;
}

/** Deal phase breakdown for a single agent */
export async function dealsForAgent(ownerName) {
  const { rows } = await getPool().query(
    `SELECT pipeline_phase, count(*)::int AS total,
            min(added_at)::text AS earliest, max(added_at)::text AS latest
     FROM deals
     WHERE owner_name = $1
     GROUP BY pipeline_phase
     ORDER BY total DESC`,
    [ownerName]
  );
  return rows;
}

/**
 * Commission per agent — calculates total CLP earned per collaborator.
 * Only for successful deals (CERRADO OPERADO/AGENDADO/INSTALADO).
 * BAR1-3: always paid to colaborador1-3 respectively.
 * BAR4-6: bonus paid to colaborador1-3 IF dias_added_cirugia <= 75.
 */
export async function commissionsPerAgent() {
  const { rows } = await getPool().query(`
    WITH exitosos AS (
      SELECT * FROM deals
      WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
    ),
    comisiones AS (
      -- Phase 1: colaborador1 earns BAR1, and BAR4 if bonus
      SELECT colaborador1 AS agent,
             COALESCE(comision_bar1, 0) AS base_clp,
             CASE WHEN bono_75_dias THEN COALESCE(comision_bar4, 0) ELSE 0 END AS bonus_clp,
             deal_id, bono_75_dias
      FROM exitosos WHERE colaborador1 IS NOT NULL

      UNION ALL

      -- Phase 2: colaborador2 earns BAR2, and BAR5 if bonus
      SELECT colaborador2,
             COALESCE(comision_bar2, 0),
             CASE WHEN bono_75_dias THEN COALESCE(comision_bar5, 0) ELSE 0 END,
             deal_id, bono_75_dias
      FROM exitosos WHERE colaborador2 IS NOT NULL

      UNION ALL

      -- Phase 3: colaborador3 earns BAR3, and BAR6 if bonus
      SELECT colaborador3,
             COALESCE(comision_bar3, 0),
             CASE WHEN bono_75_dias THEN COALESCE(comision_bar6, 0) ELSE 0 END,
             deal_id, bono_75_dias
      FROM exitosos WHERE colaborador3 IS NOT NULL
    )
    SELECT agent,
           count(DISTINCT deal_id)::int AS deals_participados,
           sum(base_clp)::int AS comision_base_clp,
           sum(bonus_clp)::int AS bono_75_dias_clp,
           sum(base_clp + bonus_clp)::int AS comision_total_clp,
           count(DISTINCT deal_id) FILTER (WHERE bono_75_dias)::int AS deals_con_bono
    FROM comisiones
    GROUP BY agent
    ORDER BY comision_total_clp DESC
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
//  ZENDESK — Patient messages (conversation_messages)
//  Sentiment analysis of what PATIENTS say to bot/agents
// ═══════════════════════════════════════════════════════════════════

/** Zendesk patient sentiment — per conversation */
export async function zendeskSentiment(days = 30) {
  const { rows } = await getPool().query(
    `SELECT c.conversation_id,
            c.channel,
            cust.nombres AS customer_nombres, cust.apellidos AS customer_apellidos,
            count(m.id)::int AS message_count,
            round(avg(m.text_sentiment_score) FILTER (WHERE m.role = 'user')::numeric, 3) AS avg_patient_sentiment,
            round(avg(m.emoji_sentiment_avg) FILTER (WHERE m.role = 'user')::numeric, 3)  AS avg_patient_emoji,
            count(*) FILTER (WHERE 'buying_signal'     = ANY(m.detected_signals))::int AS buying,
            count(*) FILTER (WHERE 'objection_signal'  = ANY(m.detected_signals))::int AS objections,
            count(*) FILTER (WHERE 'commitment_signal' = ANY(m.detected_signals))::int AS commitments,
            count(*) FILTER (WHERE 'referral_signal'   = ANY(m.detected_signals))::int AS referrals,
            count(*) FILTER (WHERE 'urgency_signal'    = ANY(m.detected_signals))::int AS urgency,
            CASE WHEN c.human_taken_over THEN 'Agente humano' ELSE 'Antonia (bot)' END AS attended_by
     FROM conversations c
     LEFT JOIN customers cust ON cust.id = c.customer_id
     JOIN conversation_messages m ON m.conversation_id = c.conversation_id
     WHERE m.created_at >= now() - ($1 || ' days')::interval
     GROUP BY c.conversation_id, c.channel, c.human_taken_over, cust.nombres, cust.apellidos
     ORDER BY max(m.created_at) DESC`,
    [days]
  );
  return rows;
}

/** Zendesk signal trends by day (patient messages) */
export async function zendeskSignals(days = 30) {
  const { rows } = await getPool().query(
    `SELECT date_trunc('day', m.created_at)::date AS day,
            count(*) FILTER (WHERE 'buying_signal'     = ANY(m.detected_signals))::int AS buying,
            count(*) FILTER (WHERE 'objection_signal'  = ANY(m.detected_signals))::int AS objections,
            count(*) FILTER (WHERE 'commitment_signal' = ANY(m.detected_signals))::int AS commitments,
            count(*) FILTER (WHERE 'referral_signal'   = ANY(m.detected_signals))::int AS referrals,
            count(*) FILTER (WHERE 'urgency_signal'    = ANY(m.detected_signals))::int AS urgency
     FROM conversation_messages m
     WHERE m.created_at >= now() - ($1 || ' days')::interval
       AND m.role = 'user'
       AND m.detected_signals IS NOT NULL
     GROUP BY 1 ORDER BY 1`,
    [days]
  );
  return rows;
}

/** Sentiment detail for a single Zendesk conversation */
export async function zendeskSentimentDetail(conversationId) {
  const { rows } = await getPool().query(
    `SELECT id, role, content,
            emoji_list, emoji_count,
            round(emoji_sentiment_avg::numeric, 3) AS emoji_sentiment_avg,
            round(text_sentiment_score::numeric, 3) AS text_sentiment_score,
            detected_signals, has_question, word_count, created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
//  AGENT REGISTRY — Consolidated agent view
// ═══════════════════════════════════════════════════════════════════

/** All registered agents with their stats from WAHA */
export async function registeredAgents() {
  const { rows } = await getPool().query(`
    SELECT ar.canonical_name, ar.email, ar.role, ar.waha_phone,
           ar.zendesk_admin_id, ar.waha_session_name,
           COALESCE(wa.conversations, 0)::int AS waha_conversations,
           COALESCE(wa.messages, 0)::int AS waha_messages,
           wa.avg_text_sentiment,
           wa.avg_emoji_sentiment,
           COALESCE(wa.buying, 0)::int AS buying_signals,
           COALESCE(wa.objections, 0)::int AS objection_signals,
           COALESCE(dl.total_deals, 0)::int AS total_deals,
           COALESCE(dl.deals_exitosos, 0)::int AS deals_exitosos,
           COALESCE(dl.tasa_exito, 0) AS tasa_exito,
           COALESCE(cm.comision_total, 0)::int AS comision_total_clp
    FROM agent_registry ar
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT c.id) AS conversations,
             sum(c.message_count) AS messages,
             round(avg(sub.avg_text)::numeric, 3) AS avg_text_sentiment,
             round(avg(sub.avg_emoji)::numeric, 3) AS avg_emoji_sentiment,
             sum(sub.buying) AS buying,
             sum(sub.objections) AS objections
      FROM agent_direct_conversations c
      JOIN LATERAL (
        SELECT avg(m.text_sentiment_score) AS avg_text,
               avg(m.emoji_sentiment_avg) AS avg_emoji,
               count(*) FILTER (WHERE 'buying_signal' = ANY(m.detected_signals)) AS buying,
               count(*) FILTER (WHERE 'objection_signal' = ANY(m.detected_signals)) AS objections
        FROM agent_direct_messages m WHERE m.conversation_id = c.id
      ) sub ON true
      WHERE c.session_name = ar.waha_session_name
    ) wa ON ar.waha_session_name IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total_deals,
             count(*) FILTER (WHERE d.pipeline_phase IN (
               'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
             ))::int AS deals_exitosos,
             CASE WHEN count(*) > 0
               THEN round(count(*) FILTER (WHERE d.pipeline_phase IN (
                 'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
               ))::numeric / count(*)::numeric * 100, 1)
               ELSE 0 END AS tasa_exito
      FROM deals d WHERE d.owner_name = ar.canonical_name
    ) dl ON true
    LEFT JOIN LATERAL (
      SELECT sum(base + bonus)::int AS comision_total
      FROM (
        SELECT COALESCE(comision_bar1,0) + CASE WHEN bono_75_dias THEN COALESCE(comision_bar4,0) ELSE 0 END AS base,
               0 AS bonus FROM deals WHERE colaborador1 = split_part(ar.canonical_name,' ',1)
               AND pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
        UNION ALL
        SELECT COALESCE(comision_bar2,0) + CASE WHEN bono_75_dias THEN COALESCE(comision_bar5,0) ELSE 0 END, 0
               FROM deals WHERE colaborador2 = split_part(ar.canonical_name,' ',1)
               AND pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
        UNION ALL
        SELECT COALESCE(comision_bar3,0) + CASE WHEN bono_75_dias THEN COALESCE(comision_bar6,0) ELSE 0 END, 0
               FROM deals WHERE colaborador3 = split_part(ar.canonical_name,' ',1)
               AND pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
      ) x
    ) cm ON true
    WHERE ar.is_active = true
    ORDER BY dl.total_deals DESC NULLS LAST
  `);
  return rows;
}

/** Deals per month per agent (owner) — ONLY active agents from registry */
export async function dealsPerMonthPerAgent() {
  const { rows } = await getPool().query(`
    SELECT date_trunc('month', d.added_at)::date AS month,
           d.owner_name,
           count(*)::int AS total_deals,
           count(*) FILTER (WHERE d.pipeline_phase IN (
             'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
           ))::int AS exitosos,
           count(*) FILTER (WHERE d.pipeline_phase = 'SIN RESPUESTA')::int AS sin_respuesta
    FROM deals d
    JOIN agent_registry ar ON ar.canonical_name = d.owner_name
    WHERE d.added_at IS NOT NULL AND ar.is_active = true
    GROUP BY 1, 2
    ORDER BY 1 DESC, total_deals DESC
  `);
  return rows;
}

/** Annual deals per active agent — for ranking chart */
export async function dealsPerYearPerAgent() {
  const { rows } = await getPool().query(`
    SELECT EXTRACT(YEAR FROM d.added_at)::int AS year,
           d.owner_name,
           count(*)::int AS total_deals,
           count(*) FILTER (WHERE d.pipeline_phase IN (
             'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
           ))::int AS exitosos
    FROM deals d
    JOIN agent_registry ar ON ar.canonical_name = d.owner_name
    WHERE d.added_at IS NOT NULL AND ar.is_active = true
    GROUP BY 1, 2
    ORDER BY 1, total_deals DESC
  `);
  return rows;
}

/** Agent participation by phase with optional year filter */
export async function agentPhaseParticipation(year = null) {
  const yearFilter = year ? `AND EXTRACT(YEAR FROM d.added_at) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(`
    WITH active_names AS (
      SELECT canonical_name, split_part(canonical_name, ' ', 1) AS first_name
      FROM agent_registry WHERE is_active = true
    )
    SELECT an.canonical_name AS agent,
           COALESCE(f1.cnt, 0)::int AS fase1_captacion,
           COALESCE(f1.exitosos, 0)::int AS fase1_exitosos,
           COALESCE(f2.cnt, 0)::int AS fase2_seguimiento,
           COALESCE(f2.exitosos, 0)::int AS fase2_exitosos,
           COALESCE(f3.cnt, 0)::int AS fase3_cierre,
           COALESCE(f3.exitosos, 0)::int AS fase3_exitosos
    FROM active_names an
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             count(*) FILTER (WHERE d.pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')) AS exitosos
      FROM deals d WHERE d.colaborador1 = an.first_name ${yearFilter}
    ) f1 ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             count(*) FILTER (WHERE d.pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')) AS exitosos
      FROM deals d WHERE d.colaborador2 = an.first_name ${yearFilter}
    ) f2 ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             count(*) FILTER (WHERE d.pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')) AS exitosos
      FROM deals d WHERE d.colaborador3 = an.first_name ${yearFilter}
    ) f3 ON true
    ORDER BY fase1_captacion DESC
  `);
  return rows;
}

/** Chain effectiveness: Colaborador1+2+3 combinations and their success rate */
export async function chainEffectiveness(year = null) {
  const yearFilter = year ? `AND EXTRACT(YEAR FROM added_at) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(`
    SELECT colaborador1, colaborador2, colaborador3,
           count(*)::int AS total_deals,
           count(*) FILTER (WHERE pipeline_phase IN (
             'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
           ))::int AS exitosos,
           CASE WHEN count(*) > 0
             THEN round(count(*) FILTER (WHERE pipeline_phase IN (
               'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
             ))::numeric / count(*)::numeric * 100, 1)
             ELSE 0 END AS efectividad
    FROM deals
    WHERE colaborador1 IS NOT NULL ${yearFilter}
    GROUP BY colaborador1, colaborador2, colaborador3
    HAVING count(*) >= 3
    ORDER BY exitosos DESC, efectividad DESC
  `);
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD — Consolidated summary (both sources)
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

      -- WhatsApp WAHA (direct agent)
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
      (SELECT count(*)::int FROM agent_behavior_metrics)            AS wa_total_metrics,

      -- WhatsApp Zendesk (bot + agent via Zendesk)
      (SELECT count(DISTINCT conversation_id)::int
       FROM conversation_messages)                                  AS zd_conversations,
      (SELECT count(*)::int FROM conversation_messages)             AS zd_messages,
      (SELECT count(DISTINCT author_display_name)::int
       FROM conversation_messages
       WHERE role = 'user' AND author_display_name IS NOT NULL)     AS zd_unique_users,
      (SELECT round(avg(text_sentiment_score)::numeric, 3)
       FROM conversation_messages
       WHERE text_sentiment_score IS NOT NULL)                      AS zd_avg_text_sentiment,
      (SELECT round(avg(emoji_sentiment_avg)::numeric, 3)
       FROM conversation_messages
       WHERE emoji_sentiment_avg IS NOT NULL)                       AS zd_avg_emoji_sentiment,
      (SELECT count(*)::int FROM conversation_messages
       WHERE 'buying_signal' = ANY(detected_signals))               AS zd_buying_signals,
      (SELECT count(*)::int FROM conversation_messages
       WHERE 'objection_signal' = ANY(detected_signals))            AS zd_objection_signals,
      (SELECT count(*)::int FROM conversation_messages
       WHERE 'commitment_signal' = ANY(detected_signals))           AS zd_commitment_signals,
      (SELECT count(*)::int FROM conversation_messages
       WHERE 'referral_signal' = ANY(detected_signals))             AS zd_referral_signals,
      (SELECT count(*)::int FROM conversation_messages
       WHERE 'urgency_signal' = ANY(detected_signals))              AS zd_urgency_signals,

      -- Deals (Zendesk Sell)
      (SELECT count(*)::int FROM deals)                              AS deals_total,
      (SELECT count(*)::int FROM deals
       WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))
                                                                     AS deals_exitosos,
      (SELECT count(*)::int FROM deals
       WHERE pipeline_phase = 'CERRADO OPERADO')                     AS deals_operados,
      (SELECT count(*)::int FROM deals
       WHERE pipeline_phase = 'CERRADO AGENDADO')                    AS deals_agendados,
      (SELECT count(DISTINCT owner_name)::int FROM deals)            AS deals_agents,
      (SELECT count(*)::int FROM deals
       WHERE bono_75_dias = true)                                    AS deals_con_bono,
      (SELECT sum(COALESCE(comision_bar1,0)+COALESCE(comision_bar2,0)+COALESCE(comision_bar3,0))::int
       FROM deals WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))
                                                                     AS comisiones_base_total,
      (SELECT sum(COALESCE(comision_bar4,0)+COALESCE(comision_bar5,0)+COALESCE(comision_bar6,0))::int
       FROM deals WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
       AND bono_75_dias = true)                                      AS bonos_total
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
    whatsapp_waha: {
      source: "WAHA (directo)",
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
    whatsapp_zendesk: {
      source: "Zendesk",
      total_conversations: r.zd_conversations,
      total_messages: r.zd_messages,
      unique_users: r.zd_unique_users,
      avg_text_sentiment: r.zd_avg_text_sentiment,
      avg_emoji_sentiment: r.zd_avg_emoji_sentiment,
      signals: {
        buying: r.zd_buying_signals,
        objection: r.zd_objection_signals,
        commitment: r.zd_commitment_signals,
        referral: r.zd_referral_signals,
        urgency: r.zd_urgency_signals,
      },
    },
    deals: {
      total: r.deals_total,
      exitosos: r.deals_exitosos,
      operados: r.deals_operados,
      agendados: r.deals_agendados,
      agents: r.deals_agents,
      con_bono_75: r.deals_con_bono,
      comisiones_base_clp: r.comisiones_base_total,
      bonos_clp: r.bonos_total,
      tasa_exito: r.deals_total > 0
        ? Math.round(r.deals_exitosos / r.deals_total * 1000) / 10
        : 0,
    },
  };
}
