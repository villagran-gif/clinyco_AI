import { pool } from "./db.js";

// Comparative analytics across agents. Prints a text report.

function fmt(n, digits = 2) {
  if (n == null) return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(num)) return "—";
  return num.toFixed(digits);
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CLINYCO AGENT OBSERVER — COMPARATIVE REPORT");
  console.log(`  Generated: ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── 1. Overall stats ──
  const overall = await pool.query(`
    SELECT
      (SELECT count(*) FROM agent_waha_sessions WHERE is_active) AS sessions,
      (SELECT count(*) FROM agent_direct_conversations) AS convs,
      (SELECT count(*) FROM agent_direct_messages) AS msgs,
      (SELECT count(*) FROM agent_behavior_metrics) AS metrics,
      (SELECT min(sent_at) FROM agent_direct_messages) AS first_msg,
      (SELECT max(sent_at) FROM agent_direct_messages) AS last_msg
  `);
  const o = overall.rows[0];
  console.log("## Overall");
  console.log(`  Sessions active:    ${o.sessions}`);
  console.log(`  Conversations:      ${o.convs}`);
  console.log(`  Messages:           ${o.msgs}`);
  console.log(`  Metrics:            ${o.metrics}`);
  console.log(`  Window:             ${o.first_msg?.toISOString?.() || o.first_msg} → ${o.last_msg?.toISOString?.() || o.last_msg}\n`);

  // ── 2. Per-agent volume ──
  const volume = await pool.query(`
    SELECT
      aws.agent_name,
      aws.session_name,
      count(DISTINCT adc.id) AS convs,
      count(adm.id) AS msgs,
      count(adm.id) FILTER (WHERE adm.direction = 'agent_to_client') AS agent_msgs,
      count(adm.id) FILTER (WHERE adm.direction = 'client_to_agent') AS client_msgs,
      count(DISTINCT adc.customer_id) FILTER (WHERE adc.customer_id IS NOT NULL) AS matched_customers,
      count(DISTINCT adc.id) FILTER (WHERE adc.match_status = 'matched') AS matched_convs
    FROM agent_waha_sessions aws
    LEFT JOIN agent_direct_conversations adc ON adc.session_name = aws.session_name
    LEFT JOIN agent_direct_messages adm ON adm.conversation_id = adc.id
    WHERE aws.is_active
    GROUP BY aws.agent_name, aws.session_name
    ORDER BY msgs DESC
  `);

  console.log("## Volume by agent");
  console.log(`  ${pad("Agent", 22)} ${pad("Convs", 7)} ${pad("Msgs", 7)} ${pad("Agent→", 8)} ${pad("Client→", 8)} ${pad("Matched", 8)}`);
  console.log(`  ${"─".repeat(70)}`);
  for (const r of volume.rows) {
    console.log(
      `  ${pad(r.agent_name, 22)} ${pad(r.convs, 7)} ${pad(r.msgs, 7)} ${pad(r.agent_msgs, 8)} ${pad(r.client_msgs, 8)} ${pad(`${r.matched_convs}/${r.convs}`, 8)}`
    );
  }
  console.log();

  // ── 3. Per-agent behavior metrics (averaged across conversations) ──
  const behavior = await pool.query(`
    WITH conv_metrics AS (
      SELECT
        adc.session_name,
        adc.id AS conv_id,
        avg(abm.metric_value) FILTER (WHERE abm.metric_type = 'response_time')      AS response_time,
        avg(abm.metric_value) FILTER (WHERE abm.metric_type = 'message_length')     AS msg_length,
        avg(abm.metric_value) FILTER (WHERE abm.metric_type = 'first_response_time') AS first_response
      FROM agent_direct_conversations adc
      LEFT JOIN agent_behavior_metrics abm ON abm.conversation_id = adc.id
      GROUP BY adc.session_name, adc.id
    ),
    conv_agg AS (
      SELECT DISTINCT ON (adc.id)
        adc.session_name, adc.id AS conv_id,
        (SELECT metric_value FROM agent_behavior_metrics WHERE conversation_id = adc.id AND metric_type = 'session_duration' ORDER BY calculated_at DESC LIMIT 1) AS session_duration,
        (SELECT metric_value FROM agent_behavior_metrics WHERE conversation_id = adc.id AND metric_type = 'turn_taking_ratio' ORDER BY calculated_at DESC LIMIT 1) AS turn_ratio,
        (SELECT metric_value FROM agent_behavior_metrics WHERE conversation_id = adc.id AND metric_type = 'question_density_agent' ORDER BY calculated_at DESC LIMIT 1) AS q_density_agent,
        (SELECT metric_value FROM agent_behavior_metrics WHERE conversation_id = adc.id AND metric_type = 'lexical_convergence' ORDER BY calculated_at DESC LIMIT 1) AS lex_conv,
        (SELECT metric_value FROM agent_behavior_metrics WHERE conversation_id = adc.id AND metric_type = 'personalization_score' ORDER BY calculated_at DESC LIMIT 1) AS personalization,
        (SELECT metric_value FROM agent_behavior_metrics WHERE conversation_id = adc.id AND metric_type = 'emoji_mirroring' ORDER BY calculated_at DESC LIMIT 1) AS emoji_mirror
      FROM agent_direct_conversations adc
    )
    SELECT
      aws.agent_name,
      avg(cm.response_time)            AS response_time,
      avg(cm.msg_length)               AS msg_length,
      avg(cm.first_response)           AS first_response,
      avg(ca.session_duration)         AS session_duration,
      avg(ca.turn_ratio)               AS turn_ratio,
      avg(ca.q_density_agent)          AS q_density_agent,
      avg(ca.lex_conv)                 AS lex_conv,
      avg(ca.personalization)          AS personalization,
      avg(ca.emoji_mirror)             AS emoji_mirror
    FROM agent_waha_sessions aws
    LEFT JOIN conv_metrics cm ON cm.session_name = aws.session_name
    LEFT JOIN conv_agg ca ON ca.session_name = aws.session_name
    WHERE aws.is_active
    GROUP BY aws.agent_name
    ORDER BY aws.agent_name
  `);

  console.log("## Behavior metrics (avg per agent)");
  console.log(`  ${pad("Agent", 22)} ${pad("RespT(s)", 10)} ${pad("MsgLen", 8)} ${pad("SessDur(h)", 11)} ${pad("TurnR", 7)} ${pad("Q?Ag", 6)} ${pad("LexConv", 8)} ${pad("Pers", 6)} ${pad("EmojiMir", 9)}`);
  console.log(`  ${"─".repeat(95)}`);
  for (const r of behavior.rows) {
    const sessDurHours = r.session_duration ? parseFloat(r.session_duration) / 3600 : null;
    console.log(
      `  ${pad(r.agent_name, 22)} ${pad(fmt(r.response_time, 0), 10)} ${pad(fmt(r.msg_length, 0), 8)} ${pad(fmt(sessDurHours, 2), 11)} ${pad(fmt(r.turn_ratio, 2), 7)} ${pad(fmt(r.q_density_agent, 2), 6)} ${pad(fmt(r.lex_conv, 2), 8)} ${pad(fmt(r.personalization, 2), 6)} ${pad(fmt(r.emoji_mirror, 2), 9)}`
    );
  }
  console.log();

  // ── 4. Sales signals per agent ──
  const signals = await pool.query(`
    SELECT
      aws.agent_name,
      count(*) FILTER (WHERE abm.metric_type = 'buying_signal')     AS buying,
      count(*) FILTER (WHERE abm.metric_type = 'objection_signal')  AS objection,
      count(*) FILTER (WHERE abm.metric_type = 'commitment_signal') AS commitment,
      count(*) FILTER (WHERE abm.metric_type = 'urgency_signal')    AS urgency,
      count(*) FILTER (WHERE abm.metric_type = 'referral_signal')   AS referral
    FROM agent_waha_sessions aws
    LEFT JOIN agent_direct_conversations adc ON adc.session_name = aws.session_name
    LEFT JOIN agent_behavior_metrics abm ON abm.conversation_id = adc.id
    WHERE aws.is_active
    GROUP BY aws.agent_name
    ORDER BY aws.agent_name
  `);

  console.log("## Sales signals (total counts)");
  console.log(`  ${pad("Agent", 22)} ${pad("Buying", 8)} ${pad("Object", 8)} ${pad("Commit", 8)} ${pad("Urgent", 8)} ${pad("Refer", 8)}`);
  console.log(`  ${"─".repeat(70)}`);
  for (const r of signals.rows) {
    console.log(
      `  ${pad(r.agent_name, 22)} ${pad(r.buying, 8)} ${pad(r.objection, 8)} ${pad(r.commitment, 8)} ${pad(r.urgency, 8)} ${pad(r.referral, 8)}`
    );
  }
  console.log();

  // ── 5. MQS per agent ──
  const mqs = await pool.query(`
    SELECT
      aws.agent_name,
      count(adm.id) FILTER (WHERE adm.mqs_composite IS NOT NULL) AS scored,
      avg(adm.mqs_information_quality) AS info,
      avg(adm.mqs_problem_solving)     AS problem,
      avg(adm.mqs_understanding)       AS understanding,
      avg(adm.mqs_clarity)             AS clarity,
      avg(adm.mqs_timing_score)        AS timing,
      avg(adm.mqs_composite)           AS composite
    FROM agent_waha_sessions aws
    LEFT JOIN agent_direct_conversations adc ON adc.session_name = aws.session_name
    LEFT JOIN agent_direct_messages adm ON adm.conversation_id = adc.id AND adm.direction = 'agent_to_client'
    WHERE aws.is_active
    GROUP BY aws.agent_name
    ORDER BY composite DESC NULLS LAST
  `);

  console.log("## Message Quality Score — Rita et al. (2026)");
  console.log(`  ${pad("Agent", 22)} ${pad("Scored", 8)} ${pad("Info", 7)} ${pad("Prob", 7)} ${pad("Under", 7)} ${pad("Clar", 7)} ${pad("Time", 7)} ${pad("COMP", 7)}`);
  console.log(`  ${"─".repeat(80)}`);
  for (const r of mqs.rows) {
    console.log(
      `  ${pad(r.agent_name, 22)} ${pad(r.scored, 8)} ${pad(fmt(r.info), 7)} ${pad(fmt(r.problem), 7)} ${pad(fmt(r.understanding), 7)} ${pad(fmt(r.clarity), 7)} ${pad(fmt(r.timing), 7)} ${pad(fmt(r.composite), 7)}`
    );
  }
  console.log();

  // ── 6. Emoji behavior ──
  const emoji = await pool.query(`
    SELECT
      aws.agent_name,
      avg(adm.emoji_count)         FILTER (WHERE adm.direction = 'agent_to_client') AS agent_emoji_avg,
      avg(adm.emoji_count)         FILTER (WHERE adm.direction = 'client_to_agent') AS client_emoji_avg,
      avg(adm.emoji_sentiment_avg) FILTER (WHERE adm.direction = 'agent_to_client' AND adm.emoji_sentiment_avg IS NOT NULL) AS agent_sent,
      avg(adm.emoji_sentiment_avg) FILTER (WHERE adm.direction = 'client_to_agent' AND adm.emoji_sentiment_avg IS NOT NULL) AS client_sent
    FROM agent_waha_sessions aws
    LEFT JOIN agent_direct_conversations adc ON adc.session_name = aws.session_name
    LEFT JOIN agent_direct_messages adm ON adm.conversation_id = adc.id
    WHERE aws.is_active
    GROUP BY aws.agent_name
    ORDER BY aws.agent_name
  `);

  console.log("## Emoji usage");
  console.log(`  ${pad("Agent", 22)} ${pad("Ag emoji/msg", 14)} ${pad("Cli emoji/msg", 14)} ${pad("Ag sent", 10)} ${pad("Cli sent", 10)}`);
  console.log(`  ${"─".repeat(80)}`);
  for (const r of emoji.rows) {
    console.log(
      `  ${pad(r.agent_name, 22)} ${pad(fmt(r.agent_emoji_avg), 14)} ${pad(fmt(r.client_emoji_avg), 14)} ${pad(fmt(r.agent_sent), 10)} ${pad(fmt(r.client_sent), 10)}`
    );
  }
  console.log();

  // ── 7. Top + bottom conversations by MQS composite ──
  const topConvs = await pool.query(`
    SELECT
      aws.agent_name, adc.client_phone, adc.message_count,
      avg(adm.mqs_composite) AS mqs,
      count(adm.id) FILTER (WHERE adm.direction = 'agent_to_client') AS agent_msgs
    FROM agent_direct_conversations adc
    JOIN agent_waha_sessions aws ON aws.session_name = adc.session_name
    JOIN agent_direct_messages adm ON adm.conversation_id = adc.id AND adm.mqs_composite IS NOT NULL
    GROUP BY aws.agent_name, adc.client_phone, adc.message_count
    HAVING count(adm.id) FILTER (WHERE adm.direction = 'agent_to_client') >= 3
    ORDER BY mqs DESC NULLS LAST
    LIMIT 10
  `);

  console.log("## Top 10 conversations by MQS composite (min 3 agent msgs)");
  console.log(`  ${pad("Agent", 22)} ${pad("Client", 16)} ${pad("Msgs", 6)} ${pad("MQS", 6)}`);
  console.log(`  ${"─".repeat(60)}`);
  for (const r of topConvs.rows) {
    console.log(
      `  ${pad(r.agent_name, 22)} ${pad(r.client_phone, 16)} ${pad(r.message_count, 6)} ${pad(fmt(r.mqs), 6)}`
    );
  }
  console.log();

  await pool.end();
}

main().catch((err) => {
  console.error("[report] Fatal:", err);
  process.exit(1);
});
