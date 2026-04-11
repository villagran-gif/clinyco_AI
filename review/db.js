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

// ── Helper: check if colaborador4-6 columns exist (migration 008) ──
let _hasC456 = null;
async function hasColaborador456() {
  if (_hasC456 !== null) return _hasC456;
  const { rows } = await getPool().query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'deals' AND column_name = 'colaborador4'`
  );
  _hasC456 = rows.length > 0;
  return _hasC456;
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

/** Deal performance per agent — by colaborador participation (1-6), NOT owner */
export async function dealsPerAgent() {
  const c456 = await hasColaborador456();
  const c456Union = c456 ? `
      UNION ALL SELECT colaborador4 FROM deals WHERE colaborador4 IS NOT NULL
      UNION ALL SELECT colaborador5 FROM deals WHERE colaborador5 IS NOT NULL
      UNION ALL SELECT colaborador6 FROM deals WHERE colaborador6 IS NOT NULL` : '';
  const c456Expand = c456 ? `
      UNION ALL SELECT d.*, d.colaborador4 AS _agent FROM deals d WHERE d.colaborador4 IS NOT NULL
      UNION ALL SELECT d.*, d.colaborador5 FROM deals d WHERE d.colaborador5 IS NOT NULL
      UNION ALL SELECT d.*, d.colaborador6 FROM deals d WHERE d.colaborador6 IS NOT NULL` : '';
  const { rows } = await getPool().query(`
    WITH agent_deals AS (
      SELECT colaborador1 AS agent FROM deals WHERE colaborador1 IS NOT NULL
      UNION ALL
      SELECT colaborador2 FROM deals WHERE colaborador2 IS NOT NULL
      UNION ALL
      SELECT colaborador3 FROM deals WHERE colaborador3 IS NOT NULL
      ${c456Union}
    )
    SELECT ad.agent,
           count(*)::int AS total_participaciones,
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
    FROM (
      SELECT d.*, d.colaborador1 AS _agent FROM deals d WHERE d.colaborador1 IS NOT NULL
      UNION ALL
      SELECT d.*, d.colaborador2 FROM deals d WHERE d.colaborador2 IS NOT NULL
      UNION ALL
      SELECT d.*, d.colaborador3 FROM deals d WHERE d.colaborador3 IS NOT NULL
      ${c456Expand}
    ) d
    JOIN (SELECT DISTINCT agent FROM agent_deals) ad ON ad.agent = d._agent
    GROUP BY ad.agent
    ORDER BY deals_exitosos DESC
  `);
  return rows;
}

/**
 * Commission per agent — calculates total CLP earned per collaborator.
 * Only for successful deals (CERRADO OPERADO/AGENDADO/INSTALADO).
 * BAR1-3: always paid to colaborador1-3 respectively.
 * BAR4-6: bonus paid to colaborador1-3 IF dias_added_cirugia <= 75.
 * Colaborador4-6 earn BAR4-6 as base (if they exist as separate positions).
 */
export async function commissionsPerAgent(year = null) {
  const c456 = await hasColaborador456();
  const yearFilter = year ? `AND EXTRACT(YEAR FROM added_at) = ${parseInt(year)}` : '';
  const c456Union = c456 ? `
      UNION ALL
      -- Position 4: colaborador4 earns BAR4
      SELECT colaborador4, COALESCE(comision_bar4, 0), 0, deal_id, bono_75_dias
      FROM exitosos WHERE colaborador4 IS NOT NULL
      UNION ALL
      -- Position 5: colaborador5 earns BAR5
      SELECT colaborador5, COALESCE(comision_bar5, 0), 0, deal_id, bono_75_dias
      FROM exitosos WHERE colaborador5 IS NOT NULL
      UNION ALL
      -- Position 6: colaborador6 earns BAR6
      SELECT colaborador6, COALESCE(comision_bar6, 0), 0, deal_id, bono_75_dias
      FROM exitosos WHERE colaborador6 IS NOT NULL` : '';
  const { rows } = await getPool().query(`
    WITH exitosos AS (
      SELECT * FROM deals
      WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
        ${yearFilter}
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
      ${c456Union}
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

/** Zendesk patient sentiment — per conversation with identified agent */
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
            CASE WHEN c.human_taken_over THEN
              COALESCE(
                (SELECT ar.canonical_name FROM conversation_events ce
                 JOIN agent_registry ar ON ce.user_name ILIKE ar.canonical_name || '%'
                    OR ce.user_name ILIKE split_part(ar.canonical_name, ' ', 1) || ' ' || split_part(ar.canonical_name, ' ', 2) || '%'
                 WHERE ce.conversation_id = c.conversation_id
                   AND ar.is_active = true
                 ORDER BY ce.created_at DESC LIMIT 1),
                'Agente humano'
              )
            ELSE 'Antonia (bot)' END AS attended_by
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

/** Zendesk conversations per agent — sentiment effectiveness */
export async function zendeskAgentEffectiveness() {
  const { rows } = await getPool().query(`
    WITH agent_convs AS (
      SELECT DISTINCT ON (c.conversation_id)
             c.conversation_id,
             ar.canonical_name AS agent_name
      FROM conversations c
      JOIN conversation_events ce ON ce.conversation_id = c.conversation_id
      JOIN agent_registry ar ON ce.user_name ILIKE ar.canonical_name || '%'
        OR ce.user_name ILIKE split_part(ar.canonical_name, ' ', 1) || ' ' || split_part(ar.canonical_name, ' ', 2) || '%'
      WHERE c.human_taken_over = true AND ar.is_active = true
      ORDER BY c.conversation_id, ce.created_at DESC
    )
    SELECT ac.agent_name,
           count(DISTINCT ac.conversation_id)::int AS conversations,
           count(m.id)::int AS total_messages,
           round(avg(m.text_sentiment_score) FILTER (WHERE m.role = 'user')::numeric, 3) AS avg_patient_sentiment,
           round(avg(m.emoji_sentiment_avg) FILTER (WHERE m.role = 'user')::numeric, 3) AS avg_patient_emoji,
           count(*) FILTER (WHERE 'buying_signal' = ANY(m.detected_signals))::int AS buying,
           count(*) FILTER (WHERE 'objection_signal' = ANY(m.detected_signals))::int AS objections,
           count(*) FILTER (WHERE 'commitment_signal' = ANY(m.detected_signals))::int AS commitments
    FROM agent_convs ac
    JOIN conversation_messages m ON m.conversation_id = ac.conversation_id
    GROUP BY ac.agent_name
    ORDER BY conversations DESC
  `);
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

/** All registered agents with their stats from WAHA + Zendesk Sell */
export async function registeredAgents() {
  const c456 = await hasColaborador456();
  const c456DealWhere = c456
    ? `OR d.colaborador4 = split_part(ar.canonical_name, ' ', 1)
       OR d.colaborador5 = split_part(ar.canonical_name, ' ', 1)
       OR d.colaborador6 = split_part(ar.canonical_name, ' ', 1)` : '';
  const c456ComUnion = c456 ? `
        UNION ALL
        SELECT COALESCE(comision_bar4,0), 0
               FROM deals WHERE colaborador4 = split_part(ar.canonical_name,' ',1)
               AND pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
        UNION ALL
        SELECT COALESCE(comision_bar5,0), 0
               FROM deals WHERE colaborador5 = split_part(ar.canonical_name,' ',1)
               AND pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
        UNION ALL
        SELECT COALESCE(comision_bar6,0), 0
               FROM deals WHERE colaborador6 = split_part(ar.canonical_name,' ',1)
               AND pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')` : '';
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
      FROM deals d WHERE d.colaborador1 = split_part(ar.canonical_name, ' ', 1)
         OR d.colaborador2 = split_part(ar.canonical_name, ' ', 1)
         OR d.colaborador3 = split_part(ar.canonical_name, ' ', 1)
         ${c456DealWhere}
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
        ${c456ComUnion}
      ) x
    ) cm ON true
    WHERE ar.is_active = true
    ORDER BY dl.total_deals DESC NULLS LAST
  `);
  return rows;
}

/** Deals per month per agent (by colaborador1 = captación) */
export async function dealsPerMonthPerAgent() {
  const { rows } = await getPool().query(`
    SELECT date_trunc('month', d.added_at)::date AS month,
           d.colaborador1 AS agent,
           count(*)::int AS total_deals,
           count(*) FILTER (WHERE d.pipeline_phase IN (
             'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
           ))::int AS exitosos,
           count(*) FILTER (WHERE d.pipeline_phase = 'SIN RESPUESTA')::int AS sin_respuesta,
           COALESCE(sum(CASE WHEN d.pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')
             THEN COALESCE(d.comision_bar1,0) + CASE WHEN d.bono_75_dias THEN COALESCE(d.comision_bar4,0) ELSE 0 END
             ELSE 0 END), 0)::int AS comision_clp
    FROM deals d
    WHERE d.added_at IS NOT NULL AND d.colaborador1 IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1 DESC, total_deals DESC
  `);
  return rows;
}

/** Annual deals per agent (by colaborador1 = captación) — for ranking chart */
export async function dealsPerYearPerAgent() {
  const { rows } = await getPool().query(`
    SELECT EXTRACT(YEAR FROM d.added_at)::int AS year,
           d.colaborador1 AS agent,
           count(*)::int AS total_deals,
           count(*) FILTER (WHERE d.pipeline_phase IN (
             'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
           ))::int AS exitosos
    FROM deals d
    WHERE d.added_at IS NOT NULL AND d.colaborador1 IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1, total_deals DESC
  `);
  return rows;
}

/** Deal detail for a specific agent (by first name in colaborador fields) */
export async function dealsForAgentDetail(agentFirstName, year = null) {
  const yearFilter = year ? `AND EXTRACT(YEAR FROM d.added_at) = ${parseInt(year)}` : '';
  const hasC456 = await hasColaborador456();
  const c456Select = hasC456
    ? 'd.colaborador4, d.colaborador5, d.colaborador6,'
    : "null AS colaborador4, null AS colaborador5, null AS colaborador6,";
  const c456Where = hasC456
    ? 'OR d.colaborador4 = $1 OR d.colaborador5 = $1 OR d.colaborador6 = $1'
    : '';
  const { rows } = await getPool().query(
    `SELECT d.deal_id, d.deal_name, d.pipeline_phase, d.pipeline_name,
            d.added_at::text, d.fecha_cirugia::text, d.cirugia,
            d.colaborador1, d.colaborador2, d.colaborador3,
            ${c456Select}
            d.comision_bar1, d.comision_bar2, d.comision_bar3,
            d.comision_bar4, d.comision_bar5, d.comision_bar6,
            d.dias_added_cirugia, d.bono_75_dias,
            d.contact_name, d.contact_phone, d.rut_normalizado,
            d.url_medinet, d.synced_at
     FROM deals d
     WHERE (d.colaborador1 = $1 OR d.colaborador2 = $1 OR d.colaborador3 = $1
            ${c456Where}) ${yearFilter}
     ORDER BY d.added_at DESC
     LIMIT 200`,
    [agentFirstName]
  );
  return rows;
}

/** Audit log: recent changes (only collaborator + commission fields) */
export async function auditLogRecent(limit = 100) {
  const { rows } = await getPool().query(
    `SELECT * FROM deal_audit_log
     WHERE field_name IN (
       'colaborador1','colaborador2','colaborador3',
       'colaborador4','colaborador5','colaborador6',
       'comision_bar1','comision_bar2','comision_bar3',
       'comision_bar4','comision_bar5','comision_bar6'
     )
     ORDER BY detected_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Deletion log: recent deletions */
export async function deletionLogRecent(limit = 50) {
  const hasC456Del = await (async () => {
    const { rows } = await getPool().query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'deal_deletions_log' AND column_name = 'colaborador4'`);
    return rows.length > 0;
  })();
  const c456 = hasC456Del
    ? 'colaborador4, colaborador5, colaborador6,'
    : "null AS colaborador4, null AS colaborador5, null AS colaborador6,";
  const { rows } = await getPool().query(
    `SELECT id, deal_id, deal_name, rut_normalizado, pipeline_phase, owner_name,
            colaborador1, colaborador2, colaborador3,
            ${c456} detected_at
     FROM deal_deletions_log ORDER BY detected_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Raw deals table — all deals with key fields for transparency */
export async function dealsRaw(limit = 200) {
  const hasC456 = await hasColaborador456();
  const c456Select = hasC456
    ? 'colaborador4, colaborador5, colaborador6,'
    : "null AS colaborador4, null AS colaborador5, null AS colaborador6,";
  const { rows } = await getPool().query(
    `SELECT deal_id, deal_name, pipeline_phase, pipeline_name,
            added_at::text, fecha_cirugia::text,
            contact_name, contact_phone, rut_normalizado,
            owner_name, cirugia, ciudad, sucursal,
            colaborador1, colaborador2, colaborador3,
            ${c456Select}
            comision_bar1, comision_bar2, comision_bar3,
            comision_bar4, comision_bar5, comision_bar6,
            dias_added_cirugia, bono_75_dias, synced_at
     FROM deals
     WHERE synced_at IS NOT NULL
     ORDER BY added_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Last sync status — multi-source */
export async function lastSyncStatus() {
  const { rows } = await getPool().query(`
    SELECT
      (SELECT max(synced_at) FROM deals WHERE synced_at IS NOT NULL)   AS deals_last_sync,
      (SELECT count(*)::int FROM deals)                                AS deals_total,
      (SELECT max(created_at) FROM conversation_messages)              AS zendesk_last_msg,
      (SELECT count(*)::int FROM conversation_messages)                AS zendesk_total_msgs,
      (SELECT max(sent_at) FROM agent_direct_messages)                 AS waha_last_msg,
      (SELECT count(*)::int FROM agent_direct_messages)                AS waha_total_msgs
  `);
  return rows[0];
}

/** Gold standard analysis — aggregate patterns from evaluated conversations */
export async function goldPatterns() {
  const { rows } = await getPool().query(`
    SELECT
      ce.deal_phase,
      ce.role,
      count(*)::int AS total_evals,
      -- Patient state averages (only for user messages)
      round(avg((ce.evaluation->'patient_state'->>'motivacion')::numeric) FILTER (WHERE ce.role = 'user'), 2) AS avg_motivacion,
      round(avg((ce.evaluation->'patient_state'->>'miedo')::numeric) FILTER (WHERE ce.role = 'user'), 2) AS avg_miedo,
      round(avg((ce.evaluation->'patient_state'->>'vergüenza')::numeric) FILTER (WHERE ce.role = 'user'), 2) AS avg_verguenza,
      round(avg((ce.evaluation->'patient_state'->>'compromiso')::numeric) FILTER (WHERE ce.role = 'user'), 2) AS avg_compromiso,
      round(avg((ce.evaluation->'patient_state'->>'readiness')::numeric) FILTER (WHERE ce.role = 'user'), 2) AS avg_readiness,
      round(avg((ce.evaluation->'patient_state'->>'sensibilidad_precio')::numeric) FILTER (WHERE ce.role = 'user'), 2) AS avg_sensibilidad_precio,
      -- MQS averages (only for assistant messages)
      round(avg((ce.evaluation->'mqs'->>'composite')::numeric) FILTER (WHERE ce.role = 'assistant'), 2) AS avg_mqs,
      round(avg((ce.evaluation->'mqs'->>'information_quality')::numeric) FILTER (WHERE ce.role = 'assistant'), 2) AS avg_info_quality,
      round(avg((ce.evaluation->'mqs'->>'clarity')::numeric) FILTER (WHERE ce.role = 'assistant'), 2) AS avg_clarity,
      -- Antonia eval
      round(avg((ce.evaluation->'antonia_eval'->>'empathy_level')::numeric) FILTER (WHERE ce.role = 'assistant'), 2) AS avg_empathy,
      round(avg((ce.evaluation->'antonia_eval'->>'adherence_to_protocol')::numeric) FILTER (WHERE ce.role = 'assistant'), 2) AS avg_adherence
    FROM conversation_evaluations ce
    GROUP BY ce.deal_phase, ce.role
    ORDER BY ce.deal_phase, ce.role
  `);
  return rows;
}

/** Gold — most common patient signals in successful deals */
export async function goldSignals() {
  const { rows } = await getPool().query(`
    SELECT signal, count(*)::int AS occurrences,
           count(DISTINCT ce.conversation_id)::int AS conversations
    FROM conversation_evaluations ce,
         jsonb_array_elements_text(ce.evaluation->'signals'->'patient_signals') AS signal
    WHERE ce.role = 'user'
    GROUP BY signal
    ORDER BY occurrences DESC
  `);
  return rows;
}

/** Gold — Antonia empathy distribution */
export async function goldAntoniaStats() {
  const { rows } = await getPool().query(`
    SELECT ce.deal_id, ce.deal_phase,
           round((ce.evaluation->'mqs'->>'composite')::numeric, 2) AS mqs,
           round((ce.evaluation->'antonia_eval'->>'empathy_level')::numeric, 2) AS empathy,
           round((ce.evaluation->'antonia_eval'->>'adherence_to_protocol')::numeric, 2) AS adherence,
           ce.evaluation->'boundary'->>'boundary_risk' AS boundary_risk,
           left(ce.content, 100) AS content_preview
    FROM conversation_evaluations ce
    WHERE ce.role = 'assistant'
    ORDER BY empathy ASC NULLS LAST
    LIMIT 50
  `);
  return rows;
}

/** Gold — patient emotional journey (avg per message position) */
export async function goldEmotionalJourney() {
  const { rows } = await getPool().query(`
    WITH numbered AS (
      SELECT ce.*,
             row_number() OVER (PARTITION BY ce.conversation_id ORDER BY ce.created_at) AS msg_pos
      FROM conversation_evaluations ce
      WHERE ce.role = 'user'
    )
    SELECT msg_pos,
           count(*)::int AS samples,
           round(avg((evaluation->'patient_state'->>'motivacion')::numeric), 2) AS motivacion,
           round(avg((evaluation->'patient_state'->>'miedo')::numeric), 2) AS miedo,
           round(avg((evaluation->'patient_state'->>'compromiso')::numeric), 2) AS compromiso,
           round(avg((evaluation->'patient_state'->>'readiness')::numeric), 2) AS readiness,
           round(avg((evaluation->'patient_state'->>'sensibilidad_precio')::numeric), 2) AS sensibilidad_precio
    FROM numbered
    WHERE msg_pos <= 10
    GROUP BY msg_pos
    ORDER BY msg_pos
  `);
  return rows;
}
export async function agentPhaseParticipation(year = null) {
  const yearFilter = year ? `AND EXTRACT(YEAR FROM d.added_at) = ${parseInt(year)}` : '';
  const c456 = await hasColaborador456();
  const c456Select = c456 ? `,
           COALESCE(f4.cnt, 0)::int AS fase4,
           COALESCE(f4.exitosos, 0)::int AS fase4_exitosos,
           COALESCE(f5.cnt, 0)::int AS fase5,
           COALESCE(f5.exitosos, 0)::int AS fase5_exitosos,
           COALESCE(f6.cnt, 0)::int AS fase6,
           COALESCE(f6.exitosos, 0)::int AS fase6_exitosos` : `,
           0::int AS fase4, 0::int AS fase4_exitosos,
           0::int AS fase5, 0::int AS fase5_exitosos,
           0::int AS fase6, 0::int AS fase6_exitosos`;
  const c456Joins = c456 ? `
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             count(*) FILTER (WHERE d.pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')) AS exitosos
      FROM deals d WHERE d.colaborador4 = an.first_name ${yearFilter}
    ) f4 ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             count(*) FILTER (WHERE d.pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')) AS exitosos
      FROM deals d WHERE d.colaborador5 = an.first_name ${yearFilter}
    ) f5 ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             count(*) FILTER (WHERE d.pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO')) AS exitosos
      FROM deals d WHERE d.colaborador6 = an.first_name ${yearFilter}
    ) f6 ON true` : '';
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
           ${c456Select}
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
    ${c456Joins}
    ORDER BY fase1_captacion DESC
  `);
  return rows;
}

/** Chain effectiveness: Colaborador1+2+3 combinations and their success rate + velocity */
export async function chainEffectiveness(year = null) {
  const yearFilter = year ? `AND EXTRACT(YEAR FROM added_at) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(`
    SELECT colaborador1, colaborador2, colaborador3,
           count(*)::int AS total_deals,
           count(*) FILTER (WHERE pipeline_phase IN (
             'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
           ))::int AS exitosos,
           count(*) FILTER (WHERE bono_75_dias)::int AS con_bono,
           round(avg(dias_added_cirugia) FILTER (WHERE pipeline_phase IN (
             'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
           ))::numeric, 1) AS avg_dias,
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

/** Velocity ranking: avg days to close per agent (across all colaborador positions) */
export async function velocityPerAgent() {
  const hasC456 = await hasColaborador456();
  const c456Unions = hasC456 ? `
    UNION ALL SELECT colaborador4, dias_added_cirugia, pipeline_phase, bono_75_dias FROM deals WHERE colaborador4 IS NOT NULL AND dias_added_cirugia IS NOT NULL
    UNION ALL SELECT colaborador5, dias_added_cirugia, pipeline_phase, bono_75_dias FROM deals WHERE colaborador5 IS NOT NULL AND dias_added_cirugia IS NOT NULL
    UNION ALL SELECT colaborador6, dias_added_cirugia, pipeline_phase, bono_75_dias FROM deals WHERE colaborador6 IS NOT NULL AND dias_added_cirugia IS NOT NULL
  ` : '';
  const { rows } = await getPool().query(`
    WITH agent_deals AS (
      SELECT colaborador1 AS agent, dias_added_cirugia AS dias, pipeline_phase, bono_75_dias FROM deals WHERE colaborador1 IS NOT NULL AND dias_added_cirugia IS NOT NULL
      UNION ALL
      SELECT colaborador2, dias_added_cirugia, pipeline_phase, bono_75_dias FROM deals WHERE colaborador2 IS NOT NULL AND dias_added_cirugia IS NOT NULL
      UNION ALL
      SELECT colaborador3, dias_added_cirugia, pipeline_phase, bono_75_dias FROM deals WHERE colaborador3 IS NOT NULL AND dias_added_cirugia IS NOT NULL
      ${c456Unions}
    )
    SELECT agent,
      count(*)::int AS total_deals,
      count(*) FILTER (WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))::int AS exitosos,
      count(*) FILTER (WHERE bono_75_dias)::int AS con_bono,
      round(avg(dias)::numeric, 1) AS avg_dias,
      round(avg(dias) FILTER (WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))::numeric, 1) AS avg_dias_exitosos,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dias) FILTER (WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))::numeric, 0)::int AS mediana_dias_exitosos,
      count(*) FILTER (WHERE dias <= 30 AND pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))::int AS rapidos_30d,
      count(*) FILTER (WHERE dias > 30 AND dias <= 75 AND pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))::int AS normales_31_75d,
      count(*) FILTER (WHERE dias > 75 AND pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))::int AS lentos_75d_plus
    FROM agent_deals
    GROUP BY agent
    ORDER BY avg_dias_exitosos ASC NULLS LAST
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
      (SELECT count(DISTINCT colaborador1)::int FROM deals WHERE colaborador1 IS NOT NULL) AS deals_agents,
      (SELECT count(*)::int FROM deals
       WHERE bono_75_dias = true)                                    AS deals_con_bono,
      (SELECT sum(COALESCE(comision_bar1,0)+COALESCE(comision_bar2,0)+COALESCE(comision_bar3,0))::int
       FROM deals WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))
                                                                     AS comisiones_base_total,
      (SELECT sum(COALESCE(comision_bar4,0)+COALESCE(comision_bar5,0)+COALESCE(comision_bar6,0))::int
       FROM deals WHERE pipeline_phase IN ('CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'))
                                                                     AS bonos_total
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

// ═══════════════════════════════════════════════════════════════════
//  MARKETING COSTS + KPIs (saascalc-enriched)
// ═══════════════════════════════════════════════════════════════════

export async function marketingCosts(year = null) {
  const filter = year ? `WHERE EXTRACT(YEAR FROM month) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(
    `SELECT id, month::text, source, description, amount_clp, updated_at
     FROM marketing_costs ${filter}
     ORDER BY month DESC, source`
  );
  return rows;
}

export async function marketingCostsByMonth(year = null) {
  const filter = year ? `WHERE EXTRACT(YEAR FROM month) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(
    `SELECT month::text,
            sum(amount_clp) FILTER (WHERE source = 'google_ads')::int AS google_ads,
            sum(amount_clp) FILTER (WHERE source = 'meta_ads')::int AS meta_ads,
            sum(amount_clp) FILTER (WHERE source = 'agency')::int AS agency,
            sum(amount_clp) FILTER (WHERE source = 'salaries')::int AS salaries,
            sum(amount_clp) FILTER (WHERE source = 'other')::int AS other,
            sum(amount_clp)::int AS total
     FROM marketing_costs ${filter}
     GROUP BY month ORDER BY month DESC`
  );
  return rows;
}

export async function upsertMarketingCost({ month, source, description, amount_clp }) {
  const desc = description || source;
  const { rows } = await getPool().query(
    `INSERT INTO marketing_costs (month, source, description, amount_clp, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (month, source, description)
     DO UPDATE SET amount_clp = $4, updated_at = now()
     RETURNING *`,
    [month, source, desc, amount_clp]
  );
  return rows[0];
}

export async function deleteMarketingCost(id) {
  await getPool().query(`DELETE FROM marketing_costs WHERE id = $1`, [id]);
}

export async function dealsMonthlyForMarketing(year = null) {
  const filter = year ? `WHERE EXTRACT(YEAR FROM added_at) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(
    `SELECT date_trunc('month', added_at)::date::text AS month,
            count(*)::int AS new_deals,
            count(*) FILTER (WHERE pipeline_phase IN (
              'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
            ))::int AS exitosos
     FROM deals ${filter}
     GROUP BY 1 ORDER BY 1 DESC`
  );
  return rows;
}

export async function getBusinessParams() {
  const { rows } = await getPool().query(
    `SELECT key, value::float, label FROM business_params ORDER BY key`
  );
  return rows;
}

export async function updateBusinessParam(key, value) {
  const { rows } = await getPool().query(
    `UPDATE business_params SET value = $2, updated_at = now()
     WHERE key = $1 RETURNING *`, [key, value]
  );
  return rows[0];
}

export async function marketingKPIs(year = null) {
  const filter = year ? `WHERE EXTRACT(YEAR FROM m.month) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(
    `SELECT m.month::text,
            m.total_cost,
            d.new_customers,
            d.new_deals,
            CASE WHEN d.new_customers > 0
              THEN round(m.total_cost::numeric / d.new_customers, 0)
              ELSE null END AS cac
     FROM (
       SELECT month, sum(amount_clp)::int AS total_cost
       FROM marketing_costs GROUP BY month
     ) m
     LEFT JOIN (
       SELECT date_trunc('month', added_at)::date AS month,
              count(*)::int AS new_deals,
              count(*) FILTER (WHERE pipeline_phase IN (
                'CERRADO OPERADO','CERRADO AGENDADO','CERRADO INSTALADO'
              ))::int AS new_customers
       FROM deals GROUP BY 1
     ) d ON m.month = d.month
     ${filter}
     ORDER BY m.month DESC`
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
//  SII COMPRAS / VENTAS (CSV upload)
// ═══════════════════════════════════════════════════════════════════

const COMPRAS_COLS = [
  'nro','tipo_doc','tipo_compra','rut_proveedor','razon_social','folio',
  'fecha_docto','fecha_recepcion','fecha_acuse','monto_exento','monto_neto',
  'monto_iva_recuperable','monto_iva_no_recuperable','codigo_iva_no_rec',
  'monto_total','monto_neto_activo_fijo','iva_activo_fijo','iva_uso_comun',
  'impto_sin_derecho_credito','iva_no_retenido','tabacos_puros',
  'tabacos_cigarrillos','tabacos_elaborados','nce_nde_sobre_fact_compra',
  'codigo_otro_impuesto','valor_otro_impuesto','tasa_otro_impuesto'
];

const VENTAS_COLS = [
  'nro','tipo_doc','tipo_venta','rut_cliente','razon_social','folio',
  'fecha_docto','fecha_recepcion','fecha_acuse_recibo','fecha_reclamo',
  'monto_exento','monto_neto','monto_iva','monto_total',
  'iva_retenido_total','iva_retenido_parcial','iva_no_retenido',
  'iva_propio','iva_terceros','rut_emisor_liquid_factura',
  'neto_comision_liquid_factura','exento_comision_liquid_factura',
  'iva_comision_liquid_factura','iva_fuera_de_plazo',
  'tipo_docto_referencia','folio_docto_referencia',
  'num_ident_receptor_extranjero','nacionalidad_receptor_extranjero',
  'credito_empresa_constructora','impto_zona_franca',
  'garantia_dep_envases','indicador_venta_sin_costo',
  'indicador_servicio_periodico','monto_no_facturable',
  'total_monto_periodo','venta_pasajes_nacional',
  'venta_pasajes_internacional','numero_interno','codigo_sucursal',
  'nce_nde_sobre_fact_compra','codigo_otro_imp','valor_otro_imp','tasa_otro_imp'
];

function parseDate(s) {
  if (!s) return null;
  const cleaned = String(s).trim();
  if (!cleaned || cleaned === '0' || cleaned === '-') return null;
  // Try DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  const dmy = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  const iso = cleaned.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  return null;
}

function parseInt0(s) {
  if (!s) return 0;
  const n = parseInt(String(s).replace(/[.$\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseFloat0(s) {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[$\s]/g, '').replace(',','.'));
  return isNaN(n) ? 0 : n;
}

export async function insertCompras(rows, periodo, batchId) {
  const pool = getPool();
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    try {
      await pool.query(
        `INSERT INTO sii_compras (${COMPRAS_COLS.join(',')}, periodo, upload_batch_id)
         VALUES (${COMPRAS_COLS.map((_,i)=>'$'+(i+1)).join(',')}, $${COMPRAS_COLS.length+1}, $${COMPRAS_COLS.length+2})
         ON CONFLICT (folio, tipo_doc, rut_proveedor, fecha_docto) DO NOTHING`,
        [
          parseInt0(r[0]), r[1]||'', r[2]||'', r[3]||'', r[4]||'', r[5]||'',
          parseDate(r[6]), parseDate(r[7]), parseDate(r[8]),
          parseInt0(r[9]), parseInt0(r[10]), parseInt0(r[11]), parseInt0(r[12]),
          r[13]||'', parseInt0(r[14]), parseInt0(r[15]), parseInt0(r[16]),
          parseInt0(r[17]), parseInt0(r[18]), parseInt0(r[19]),
          parseInt0(r[20]), parseInt0(r[21]), parseInt0(r[22]),
          parseInt0(r[23]), r[24]||'', parseInt0(r[25]), parseFloat0(r[26]),
          periodo, batchId
        ]
      );
      inserted++;
    } catch (e) { skipped++; }
  }
  return { inserted, skipped, total: rows.length };
}

export async function insertVentas(rows, periodo, batchId) {
  const pool = getPool();
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    try {
      await pool.query(
        `INSERT INTO sii_ventas (${VENTAS_COLS.join(',')}, periodo, upload_batch_id)
         VALUES (${VENTAS_COLS.map((_,i)=>'$'+(i+1)).join(',')}, $${VENTAS_COLS.length+1}, $${VENTAS_COLS.length+2})
         ON CONFLICT (folio, tipo_doc, rut_cliente, fecha_docto) DO NOTHING`,
        [
          parseInt0(r[0]), r[1]||'', r[2]||'', r[3]||'', r[4]||'', r[5]||'',
          parseDate(r[6]), parseDate(r[7]), parseDate(r[8]), parseDate(r[9]),
          parseInt0(r[10]), parseInt0(r[11]), parseInt0(r[12]), parseInt0(r[13]),
          parseInt0(r[14]), parseInt0(r[15]), parseInt0(r[16]),
          parseInt0(r[17]), parseInt0(r[18]), r[19]||'',
          parseInt0(r[20]), parseInt0(r[21]), parseInt0(r[22]),
          parseInt0(r[23]), r[24]||'', r[25]||'',
          r[26]||'', r[27]||'', parseInt0(r[28]), parseInt0(r[29]),
          parseInt0(r[30]), r[31]||'', r[32]||'',
          parseInt0(r[33]), parseInt0(r[34]), parseInt0(r[35]),
          parseInt0(r[36]), r[37]||'', r[38]||'',
          parseInt0(r[39]), r[40]||'', parseInt0(r[41]), parseFloat0(r[42]),
          periodo, batchId
        ]
      );
      inserted++;
    } catch (e) { skipped++; }
  }
  return { inserted, skipped, total: rows.length };
}

export async function getCompras(periodo = null, limit = 500) {
  const filter = periodo ? `WHERE periodo = '${periodo}'` : '';
  const { rows } = await getPool().query(
    `SELECT * FROM sii_compras ${filter} ORDER BY fecha_docto DESC NULLS LAST LIMIT $1`, [limit]
  );
  return rows;
}

export async function getVentas(periodo = null, limit = 500) {
  const filter = periodo ? `WHERE periodo = '${periodo}'` : '';
  const { rows } = await getPool().query(
    `SELECT * FROM sii_ventas ${filter} ORDER BY fecha_docto DESC NULLS LAST LIMIT $1`, [limit]
  );
  return rows;
}

export async function comprasResumen(year = null) {
  const filter = year ? `WHERE EXTRACT(YEAR FROM fecha_docto) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(
    `SELECT date_trunc('month', fecha_docto)::date::text AS month,
            count(*)::int AS total_docs,
            sum(COALESCE(monto_exento,0))::bigint AS total_exento,
            sum(COALESCE(monto_neto,0))::bigint AS total_neto,
            sum(COALESCE(monto_iva_recuperable,0))::bigint AS total_iva_rec,
            sum(COALESCE(monto_iva_no_recuperable,0))::bigint AS total_iva_no_rec,
            sum(COALESCE(monto_total,0))::bigint AS total_total
     FROM sii_compras ${filter}
     GROUP BY 1 ORDER BY 1 DESC`
  );
  return rows;
}

export async function comprasResumenPorTipo(periodo = null) {
  const filter = periodo ? `WHERE periodo = '${periodo}'` : '';
  const { rows } = await getPool().query(
    `SELECT date_trunc('month', fecha_docto)::date::text AS month,
            tipo_doc,
            count(*)::int AS total_docs,
            sum(COALESCE(monto_exento,0))::bigint AS total_exento,
            sum(COALESCE(monto_neto,0))::bigint AS total_neto,
            sum(COALESCE(monto_iva_recuperable,0))::bigint AS total_iva_rec,
            sum(COALESCE(monto_iva_no_recuperable,0))::bigint AS total_iva_no_rec,
            sum(COALESCE(iva_uso_comun,0))::bigint AS total_iva_uso_comun,
            sum(COALESCE(monto_total,0))::bigint AS total_total
     FROM sii_compras ${filter}
     GROUP BY 1, tipo_doc ORDER BY 1 ASC, total_total DESC`
  );
  return rows;
}

export async function ventasResumen(year = null) {
  const filter = year ? `WHERE EXTRACT(YEAR FROM fecha_docto) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(
    `SELECT date_trunc('month', fecha_docto)::date::text AS month,
            count(*)::int AS total_docs,
            sum(COALESCE(monto_exento,0))::bigint AS total_exento,
            sum(COALESCE(monto_neto,0))::bigint AS total_neto,
            sum(COALESCE(monto_iva,0))::bigint AS total_iva,
            sum(COALESCE(monto_total,0))::bigint AS total_total
     FROM sii_ventas ${filter}
     GROUP BY 1 ORDER BY 1 DESC`
  );
  return rows;
}

export async function ventasResumenPorTipo(periodo = null) {
  const filter = periodo ? `WHERE periodo = '${periodo}'` : '';
  const { rows } = await getPool().query(
    `SELECT date_trunc('month', fecha_docto)::date::text AS month,
            tipo_doc,
            count(*)::int AS total_docs,
            sum(COALESCE(monto_exento,0))::bigint AS total_exento,
            sum(COALESCE(monto_neto,0))::bigint AS total_neto,
            sum(COALESCE(monto_iva,0))::bigint AS total_iva,
            sum(COALESCE(monto_total,0))::bigint AS total_total
     FROM sii_ventas ${filter}
     GROUP BY 1, tipo_doc ORDER BY 1 ASC, total_total DESC`
  );
  return rows;
}

export async function getApiConnections() {
  const { rows } = await getPool().query(
    `SELECT provider, config, is_active, last_sync_at FROM api_connections ORDER BY provider`
  );
  return rows;
}

// ── Boletas (RCV_VENTA_BOLETAS) ──

const BOLETAS_COLS = [
  'tipo_doc','rut_receptor','fecha_docto','fecha_venc',
  'indicador_servicio','folio','monto_neto','monto_iva','monto_exento','monto_total'
];

export async function insertBoletas(rows, periodo, batchId) {
  const pool = getPool();
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    try {
      await pool.query(
        `INSERT INTO sii_ventas_boletas (${BOLETAS_COLS.join(',')}, periodo, upload_batch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (folio, tipo_doc, rut_receptor, fecha_docto) DO NOTHING`,
        [
          r[0]||'', r[1]||'', parseDate(r[2]), parseDate(r[3]),
          r[4]||'', r[5]||'', parseInt0(r[6]), parseInt0(r[7]),
          parseInt0(r[8]), parseInt0(r[9]),
          periodo, batchId
        ]
      );
      inserted++;
    } catch (e) { skipped++; }
  }
  return { inserted, skipped, total: rows.length };
}

export async function getBoletas(periodo = null, limit = 500) {
  const filter = periodo ? `WHERE periodo = '${periodo}'` : '';
  const { rows } = await getPool().query(
    `SELECT * FROM sii_ventas_boletas ${filter} ORDER BY fecha_docto DESC NULLS LAST LIMIT $1`, [limit]
  );
  return rows;
}

// ── Resumen CSVs (RCV_RESUMEN_COMPRA / RCV_RESUMEN_VENTA) ──

export async function insertResumenCompras(rows, periodo, batchId) {
  const pool = getPool();
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    try {
      const tipoDoc = r[0]||'';
      if (!tipoDoc || tipoDoc.toLowerCase().includes('tipo documento')) continue;
      await pool.query(
        `INSERT INTO sii_resumen_compras (periodo, tipo_doc, total_documentos, monto_exento, monto_neto, iva_recuperable, iva_uso_comun, iva_no_recuperable, monto_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (periodo, tipo_doc) DO UPDATE SET
           total_documentos=$3, monto_exento=$4, monto_neto=$5, iva_recuperable=$6,
           iva_uso_comun=$7, iva_no_recuperable=$8, monto_total=$9`,
        [periodo, tipoDoc, parseInt0(r[1]), parseInt0(r[2]), parseInt0(r[3]),
         parseInt0(r[4]), parseInt0(r[5]), parseInt0(r[6]), parseInt0(r[7])]
      );
      inserted++;
    } catch (e) { skipped++; }
  }
  return { inserted, skipped, total: rows.length };
}

export async function insertResumenVentas(rows, periodo, batchId) {
  const pool = getPool();
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    try {
      const tipoDoc = r[0]||'';
      if (!tipoDoc || tipoDoc.toLowerCase().includes('tipo documento')) continue;
      await pool.query(
        `INSERT INTO sii_resumen_ventas (periodo, tipo_doc, total_documentos, monto_exento, monto_neto, monto_iva, monto_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (periodo, tipo_doc) DO UPDATE SET
           total_documentos=$3, monto_exento=$4, monto_neto=$5, monto_iva=$6, monto_total=$7`,
        [periodo, tipoDoc, parseInt0(r[1]), parseInt0(r[2]), parseInt0(r[3]),
         parseInt0(r[4]), parseInt0(r[5])]
      );
      inserted++;
    } catch (e) { skipped++; }
  }
  return { inserted, skipped, total: rows.length };
}

export async function getResumenCompras(periodo = null) {
  const filter = periodo ? `WHERE periodo = '${periodo}'` : '';
  const { rows } = await getPool().query(
    `SELECT * FROM sii_resumen_compras ${filter} ORDER BY periodo DESC, monto_total DESC`
  );
  return rows;
}

export async function getResumenVentas(periodo = null) {
  const filter = periodo ? `WHERE periodo = '${periodo}'` : '';
  const { rows } = await getPool().query(
    `SELECT * FROM sii_resumen_ventas ${filter} ORDER BY periodo DESC, monto_total DESC`
  );
  return rows;
}

// ── Ventas resumen unificado (ventas + boletas) ──

export async function ventasResumenUnificado(year = null) {
  const filter = year ? `AND EXTRACT(YEAR FROM fecha_docto) = ${parseInt(year)}` : '';
  const { rows } = await getPool().query(
    `SELECT month, sum(total_docs)::int AS total_docs,
            sum(total_exento)::bigint AS total_exento,
            sum(total_neto)::bigint AS total_neto,
            sum(total_iva)::bigint AS total_iva,
            sum(total_total)::bigint AS total_total
     FROM (
       SELECT date_trunc('month', fecha_docto)::date::text AS month,
              count(*)::int AS total_docs,
              sum(COALESCE(monto_exento,0))::bigint AS total_exento,
              sum(COALESCE(monto_neto,0))::bigint AS total_neto,
              sum(COALESCE(monto_iva,0))::bigint AS total_iva,
              sum(COALESCE(monto_total,0))::bigint AS total_total
       FROM sii_ventas WHERE true ${filter}
       GROUP BY 1
       UNION ALL
       SELECT date_trunc('month', fecha_docto)::date::text AS month,
              count(*)::int AS total_docs,
              sum(COALESCE(monto_exento,0))::bigint AS total_exento,
              sum(COALESCE(monto_neto,0))::bigint AS total_neto,
              sum(COALESCE(monto_iva,0))::bigint AS total_iva,
              sum(COALESCE(monto_total,0))::bigint AS total_total
       FROM sii_ventas_boletas WHERE true ${filter}
       GROUP BY 1
     ) combined
     GROUP BY month ORDER BY month DESC`
  );
  return rows;
}

export async function ventasResumenPorTipoUnificado(periodo = null) {
  const filter = periodo ? `AND periodo = '${periodo}'` : '';
  const { rows } = await getPool().query(
    `SELECT month, tipo_doc,
            sum(total_docs)::int AS total_docs,
            sum(total_exento)::bigint AS total_exento,
            sum(total_neto)::bigint AS total_neto,
            sum(total_iva)::bigint AS total_iva,
            sum(total_total)::bigint AS total_total
     FROM (
       SELECT date_trunc('month', fecha_docto)::date::text AS month, tipo_doc,
              count(*)::int AS total_docs,
              sum(COALESCE(monto_exento,0))::bigint AS total_exento,
              sum(COALESCE(monto_neto,0))::bigint AS total_neto,
              sum(COALESCE(monto_iva,0))::bigint AS total_iva,
              sum(COALESCE(monto_total,0))::bigint AS total_total
       FROM sii_ventas WHERE true ${filter}
       GROUP BY 1, tipo_doc
       UNION ALL
       SELECT date_trunc('month', fecha_docto)::date::text AS month, tipo_doc,
              count(*)::int AS total_docs,
              sum(COALESCE(monto_exento,0))::bigint AS total_exento,
              sum(COALESCE(monto_neto,0))::bigint AS total_neto,
              sum(COALESCE(monto_iva,0))::bigint AS total_iva,
              sum(COALESCE(monto_total,0))::bigint AS total_total
       FROM sii_ventas_boletas WHERE true ${filter}
       GROUP BY 1, tipo_doc
     ) combined
     GROUP BY month, tipo_doc ORDER BY month ASC, total_total DESC`
  );
  return rows;
}

/** Verificación: compara raw calculado vs resumen oficial del SII */
export async function verificacionSII(periodo = null) {
  const pool = getPool();
  const filter = periodo ? `WHERE periodo = '${periodo}'` : '';

  // Get official resumen
  const { rows: resCompras } = await pool.query(
    `SELECT periodo, tipo_doc, total_documentos, monto_total FROM sii_resumen_compras ${filter} ORDER BY periodo, tipo_doc`
  );
  const { rows: resVentas } = await pool.query(
    `SELECT periodo, tipo_doc, total_documentos, monto_total FROM sii_resumen_ventas ${filter} ORDER BY periodo, tipo_doc`
  );

  // Get calculated from raw data
  const filterRaw = periodo ? `WHERE periodo = '${periodo}'` : '';
  const { rows: rawCompras } = await pool.query(
    `SELECT periodo, tipo_doc, count(*)::int AS total_documentos, sum(COALESCE(monto_total,0))::bigint AS monto_total
     FROM sii_compras ${filterRaw} GROUP BY periodo, tipo_doc ORDER BY periodo, tipo_doc`
  );
  const { rows: rawVentas } = await pool.query(
    `SELECT periodo, tipo_doc, total_documentos, monto_total FROM (
       SELECT periodo, tipo_doc, count(*)::int AS total_documentos, sum(COALESCE(monto_total,0))::bigint AS monto_total
       FROM sii_ventas ${filterRaw} GROUP BY periodo, tipo_doc
       UNION ALL
       SELECT periodo, tipo_doc, count(*)::int, sum(COALESCE(monto_total,0))::bigint
       FROM sii_ventas_boletas ${filterRaw} GROUP BY periodo, tipo_doc
     ) x ORDER BY periodo, tipo_doc`
  );

  // Build comparison
  const compare = (oficial, raw, label) => {
    const result = [];
    const rawMap = {};
    raw.forEach(r => { rawMap[`${r.periodo}|${r.tipo_doc}`] = r; });
    const oficialMap = {};
    oficial.forEach(o => { oficialMap[`${o.periodo}|${o.tipo_doc}`] = o; });
    const allKeys = [...new Set([...Object.keys(rawMap), ...Object.keys(oficialMap)])];
    for (const key of allKeys) {
      const o = oficialMap[key] || { total_documentos: 0, monto_total: 0 };
      const r = rawMap[key] || { total_documentos: 0, monto_total: 0 };
      const [per, tipo] = key.split('|');
      const docsDiff = Number(r.total_documentos) - Number(o.total_documentos);
      const montoDiff = Number(r.monto_total) - Number(o.monto_total);
      result.push({
        libro: label, periodo: per, tipo_doc: tipo,
        oficial_docs: Number(o.total_documentos), raw_docs: Number(r.total_documentos), diff_docs: docsDiff,
        oficial_total: Number(o.monto_total), raw_total: Number(r.monto_total), diff_total: montoDiff,
        ok: docsDiff === 0 && montoDiff === 0
      });
    }
    return result;
  };

  return [
    ...compare(resCompras, rawCompras, 'COMPRAS'),
    ...compare(resVentas, rawVentas, 'VENTAS'),
  ];
}
