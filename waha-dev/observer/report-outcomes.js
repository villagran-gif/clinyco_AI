import { pool } from "./db.js";

// ══════════════════════════════════════════════════════════════
// report-outcomes.js
// Correlaciona métricas del Observer con outcomes de Zendesk Sell.
// Requiere: sell_deals_cache poblado vía sync-sell-deals.js
// ══════════════════════════════════════════════════════════════

function fmt(n, d = 2) {
  if (n == null) return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(num)) return "—";
  return num.toFixed(d);
}
function pad(s, w) {
  s = String(s);
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// Normaliza teléfono del Observer al mismo formato que sell_deals_cache.contact_phone
// (solo dígitos, 56XXXXXXXXX para chilenos)
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return null;
  digits = digits.replace(/^0+/, "");
  if (digits.length === 9 && digits.startsWith("9")) digits = "56" + digits;
  if (digits.length === 8) digits = "562" + digits;
  return digits;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CLINYCO — OBSERVER × SELL DEALS CORRELATION REPORT");
  console.log(`  Generated: ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── 0. Cache health ──
  const cache = await pool.query(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE is_closed_won) AS won,
           count(*) FILTER (WHERE stage_category = 'lost') AS lost,
           count(*) FILTER (WHERE stage_category = 'open') AS open,
           count(DISTINCT contact_phone) FILTER (WHERE contact_phone IS NOT NULL) AS phones,
           max(last_synced_at) AS last_sync
    FROM sell_deals_cache
  `);
  const c = cache.rows[0];
  console.log("## Sell cache state");
  console.log(`  Total deals: ${c.total}  (won=${c.won}, lost=${c.lost}, open=${c.open})`);
  console.log(`  Unique phones: ${c.phones}`);
  console.log(`  Last sync: ${c.last_sync?.toISOString?.() || c.last_sync}\n`);

  if (Number(c.total) === 0) {
    console.log("  ⚠ sell_deals_cache vacío. Corré observer/sync-sell-deals.js primero.");
    await pool.end();
    return;
  }

  // ── 1. Match coverage: convs del Observer que cruzan con Sell ──
  // Normalizamos el phone en SQL para matchear el formato de sell_deals_cache
  const coverage = await pool.query(`
    WITH obs AS (
      SELECT
        adc.id AS conv_id,
        aws.agent_name,
        adc.client_phone AS raw_phone,
        regexp_replace(adc.client_phone, '[^0-9]', '', 'g') AS digits
      FROM agent_direct_conversations adc
      JOIN agent_waha_sessions aws ON aws.session_name = adc.session_name
      WHERE aws.is_active
    ),
    obs_norm AS (
      SELECT
        conv_id, agent_name, raw_phone,
        CASE
          WHEN length(digits) = 9 AND left(digits,1) = '9' THEN '56' || digits
          WHEN length(digits) = 8 THEN '562' || digits
          ELSE digits
        END AS phone_norm
      FROM obs
    )
    SELECT
      agent_name,
      count(*) AS convs,
      count(DISTINCT sdc.deal_id) AS matched_deals,
      count(DISTINCT obs_norm.conv_id) FILTER (WHERE sdc.deal_id IS NOT NULL) AS matched_convs
    FROM obs_norm
    LEFT JOIN sell_deals_cache sdc ON sdc.contact_phone = obs_norm.phone_norm
    GROUP BY agent_name
    ORDER BY agent_name
  `);

  console.log("## Observer ↔ Sell match coverage");
  console.log(`  ${pad("Agent", 22)} ${pad("Convs", 7)} ${pad("MatchConvs", 11)} ${pad("Deals", 7)}`);
  console.log(`  ${"─".repeat(55)}`);
  for (const r of coverage.rows) {
    console.log(`  ${pad(r.agent_name, 22)} ${pad(r.convs, 7)} ${pad(r.matched_convs, 11)} ${pad(r.matched_deals, 7)}`);
  }
  console.log();

  // ── 2. Win rate por agente ──
  const winRate = await pool.query(`
    WITH obs_norm AS (
      SELECT
        adc.id AS conv_id,
        aws.agent_name,
        CASE
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 9
               AND left(regexp_replace(adc.client_phone, '[^0-9]', '', 'g'),1) = '9'
          THEN '56' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 8
          THEN '562' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          ELSE regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
        END AS phone_norm
      FROM agent_direct_conversations adc
      JOIN agent_waha_sessions aws ON aws.session_name = adc.session_name
      WHERE aws.is_active
    ),
    deals_per_agent AS (
      SELECT DISTINCT obs_norm.agent_name, sdc.deal_id, sdc.stage_category, sdc.outcome_score, sdc.value
      FROM obs_norm
      JOIN sell_deals_cache sdc ON sdc.contact_phone = obs_norm.phone_norm
    )
    SELECT
      agent_name,
      count(*) AS deals,
      count(*) FILTER (WHERE stage_category = 'won') AS won,
      count(*) FILTER (WHERE stage_category = 'lost') AS lost,
      count(*) FILTER (WHERE stage_category = 'open') AS open,
      ROUND(100.0 * count(*) FILTER (WHERE stage_category = 'won') / NULLIF(count(*),0), 1) AS win_rate_pct,
      avg(outcome_score)                                  AS avg_outcome,
      sum(value) FILTER (WHERE stage_category = 'won')    AS won_value
    FROM deals_per_agent
    GROUP BY agent_name
    ORDER BY win_rate_pct DESC NULLS LAST
  `);

  console.log("## Win rate por agente (solo deals que matchean convs del Observer)");
  console.log(`  ${pad("Agent", 22)} ${pad("Deals", 7)} ${pad("Won", 5)} ${pad("Lost", 6)} ${pad("Open", 6)} ${pad("Win%", 7)} ${pad("AvgScore", 10)} ${pad("WonValue", 12)}`);
  console.log(`  ${"─".repeat(80)}`);
  for (const r of winRate.rows) {
    console.log(`  ${pad(r.agent_name, 22)} ${pad(r.deals, 7)} ${pad(r.won, 5)} ${pad(r.lost, 6)} ${pad(r.open, 6)} ${pad(fmt(r.win_rate_pct, 1), 7)} ${pad(fmt(r.avg_outcome, 1), 10)} ${pad(fmt(r.won_value, 0), 12)}`);
  }
  console.log();

  // ── 3. MQS & behavior: won vs lost ──
  const wonVsLost = await pool.query(`
    WITH obs_norm AS (
      SELECT
        adc.id AS conv_id,
        aws.agent_name,
        CASE
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 9
               AND left(regexp_replace(adc.client_phone, '[^0-9]', '', 'g'),1) = '9'
          THEN '56' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 8
          THEN '562' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          ELSE regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
        END AS phone_norm
      FROM agent_direct_conversations adc
      JOIN agent_waha_sessions aws ON aws.session_name = adc.session_name
      WHERE aws.is_active
    ),
    conv_outcome AS (
      SELECT DISTINCT ON (obs_norm.conv_id)
        obs_norm.conv_id, obs_norm.agent_name, sdc.stage_category, sdc.outcome_score, sdc.is_closed_won
      FROM obs_norm
      JOIN sell_deals_cache sdc ON sdc.contact_phone = obs_norm.phone_norm
      ORDER BY obs_norm.conv_id, sdc.outcome_score DESC NULLS LAST
    ),
    conv_metrics AS (
      SELECT
        co.conv_id, co.agent_name, co.is_closed_won, co.outcome_score,
        avg(adm.mqs_composite)                      AS mqs_composite,
        avg(adm.mqs_information_quality)            AS mqs_info,
        avg(adm.mqs_problem_solving)                AS mqs_problem,
        avg(adm.mqs_timing_score)                   AS mqs_timing,
        avg(abm_rt.metric_value)                    AS response_time,
        count(abm_buy.metric_type) FILTER (WHERE abm_buy.metric_type = 'buying_signal')     AS buying_signals,
        count(abm_com.metric_type) FILTER (WHERE abm_com.metric_type = 'commitment_signal') AS commit_signals
      FROM conv_outcome co
      LEFT JOIN agent_direct_messages adm ON adm.conversation_id = co.conv_id AND adm.direction = 'agent_to_client'
      LEFT JOIN agent_behavior_metrics abm_rt  ON abm_rt.conversation_id  = co.conv_id AND abm_rt.metric_type  = 'response_time'
      LEFT JOIN agent_behavior_metrics abm_buy ON abm_buy.conversation_id = co.conv_id AND abm_buy.metric_type = 'buying_signal'
      LEFT JOIN agent_behavior_metrics abm_com ON abm_com.conversation_id = co.conv_id AND abm_com.metric_type = 'commitment_signal'
      GROUP BY co.conv_id, co.agent_name, co.is_closed_won, co.outcome_score
    )
    SELECT
      agent_name,
      CASE WHEN is_closed_won THEN 'WON' ELSE 'not-won' END AS bucket,
      count(*) AS n,
      avg(mqs_composite)   AS mqs,
      avg(mqs_info)        AS info,
      avg(mqs_problem)     AS problem,
      avg(mqs_timing)      AS timing,
      avg(response_time)   AS response_time,
      avg(buying_signals)  AS buying,
      avg(commit_signals)  AS commit
    FROM conv_metrics
    GROUP BY agent_name, is_closed_won
    ORDER BY agent_name, bucket DESC
  `);

  console.log("## MQS & comportamiento — WON vs not-WON, por agente");
  console.log(`  ${pad("Agent", 22)} ${pad("Bucket", 8)} ${pad("N", 4)} ${pad("MQS", 6)} ${pad("Info", 6)} ${pad("Prob", 6)} ${pad("Time", 6)} ${pad("RespT", 8)} ${pad("Buy", 5)} ${pad("Com", 5)}`);
  console.log(`  ${"─".repeat(85)}`);
  for (const r of wonVsLost.rows) {
    console.log(`  ${pad(r.agent_name, 22)} ${pad(r.bucket, 8)} ${pad(r.n, 4)} ${pad(fmt(r.mqs), 6)} ${pad(fmt(r.info), 6)} ${pad(fmt(r.problem), 6)} ${pad(fmt(r.timing), 6)} ${pad(fmt(r.response_time, 0), 8)} ${pad(fmt(r.buying, 1), 5)} ${pad(fmt(r.commit, 1), 5)}`);
  }
  console.log();

  // ── 4. Outcome distribution by stage ──
  const byStage = await pool.query(`
    WITH obs_norm AS (
      SELECT
        aws.agent_name,
        CASE
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 9
               AND left(regexp_replace(adc.client_phone, '[^0-9]', '', 'g'),1) = '9'
          THEN '56' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 8
          THEN '562' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          ELSE regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
        END AS phone_norm
      FROM agent_direct_conversations adc
      JOIN agent_waha_sessions aws ON aws.session_name = adc.session_name
      WHERE aws.is_active
    )
    SELECT sdc.stage_name, count(DISTINCT sdc.deal_id) AS deals
    FROM obs_norm
    JOIN sell_deals_cache sdc ON sdc.contact_phone = obs_norm.phone_norm
    GROUP BY sdc.stage_name
    ORDER BY deals DESC
  `);

  console.log("## Distribución de stages (deals que matchean convs del Observer)");
  console.log(`  ${pad("Stage", 40)} ${pad("Deals", 6)}`);
  console.log(`  ${"─".repeat(50)}`);
  for (const r of byStage.rows) {
    console.log(`  ${pad(r.stage_name || "(null)", 40)} ${pad(r.deals, 6)}`);
  }
  console.log();

  // ── 5. Top 15 won deals con métricas ──
  const topWon = await pool.query(`
    WITH obs_norm AS (
      SELECT
        adc.id AS conv_id, adc.client_phone, adc.message_count,
        aws.agent_name,
        CASE
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 9
               AND left(regexp_replace(adc.client_phone, '[^0-9]', '', 'g'),1) = '9'
          THEN '56' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 8
          THEN '562' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          ELSE regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
        END AS phone_norm
      FROM agent_direct_conversations adc
      JOIN agent_waha_sessions aws ON aws.session_name = adc.session_name
      WHERE aws.is_active
    )
    SELECT DISTINCT ON (obs_norm.conv_id)
      obs_norm.agent_name,
      obs_norm.client_phone,
      obs_norm.message_count,
      sdc.stage_name,
      sdc.outcome_score,
      sdc.value,
      sdc.pipeline_key,
      (SELECT avg(mqs_composite) FROM agent_direct_messages WHERE conversation_id = obs_norm.conv_id AND direction = 'agent_to_client') AS mqs
    FROM obs_norm
    JOIN sell_deals_cache sdc ON sdc.contact_phone = obs_norm.phone_norm
    WHERE sdc.is_closed_won
    ORDER BY obs_norm.conv_id, sdc.outcome_score DESC NULLS LAST
    LIMIT 15
  `);

  console.log("## Top deals WON con métricas del Observer");
  console.log(`  ${pad("Agent", 22)} ${pad("Phone", 15)} ${pad("Msgs", 5)} ${pad("Stage", 22)} ${pad("Score", 6)} ${pad("Pipeline", 12)} ${pad("MQS", 5)}`);
  console.log(`  ${"─".repeat(95)}`);
  for (const r of topWon.rows) {
    console.log(`  ${pad(r.agent_name, 22)} ${pad(r.client_phone, 15)} ${pad(r.message_count, 5)} ${pad(r.stage_name, 22)} ${pad(r.outcome_score, 6)} ${pad(r.pipeline_key, 12)} ${pad(fmt(r.mqs), 5)}`);
  }
  console.log();

  // ── 6. Correlaciones Pearson rápidas ──
  const corr = await pool.query(`
    WITH obs_norm AS (
      SELECT
        adc.id AS conv_id,
        CASE
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 9
               AND left(regexp_replace(adc.client_phone, '[^0-9]', '', 'g'),1) = '9'
          THEN '56' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          WHEN length(regexp_replace(adc.client_phone, '[^0-9]', '', 'g')) = 8
          THEN '562' || regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
          ELSE regexp_replace(adc.client_phone, '[^0-9]', '', 'g')
        END AS phone_norm
      FROM agent_direct_conversations adc
    ),
    conv_data AS (
      SELECT DISTINCT ON (obs_norm.conv_id)
        obs_norm.conv_id,
        sdc.outcome_score,
        (SELECT avg(mqs_composite)   FROM agent_direct_messages WHERE conversation_id = obs_norm.conv_id AND direction = 'agent_to_client') AS mqs,
        (SELECT avg(metric_value)     FROM agent_behavior_metrics WHERE conversation_id = obs_norm.conv_id AND metric_type = 'response_time') AS rt,
        (SELECT avg(metric_value)     FROM agent_behavior_metrics WHERE conversation_id = obs_norm.conv_id AND metric_type = 'message_length') AS ml,
        (SELECT count(*)              FROM agent_behavior_metrics WHERE conversation_id = obs_norm.conv_id AND metric_type = 'buying_signal') AS bs,
        (SELECT count(*)              FROM agent_behavior_metrics WHERE conversation_id = obs_norm.conv_id AND metric_type = 'commitment_signal') AS cs
      FROM obs_norm
      JOIN sell_deals_cache sdc ON sdc.contact_phone = obs_norm.phone_norm
      ORDER BY obs_norm.conv_id, sdc.outcome_score DESC NULLS LAST
    )
    SELECT
      count(*) AS n,
      corr(mqs, outcome_score) AS corr_mqs,
      corr(rt,  outcome_score) AS corr_rt,
      corr(ml,  outcome_score) AS corr_ml,
      corr(bs::numeric, outcome_score::numeric) AS corr_buying,
      corr(cs::numeric, outcome_score::numeric) AS corr_commit
    FROM conv_data
    WHERE outcome_score IS NOT NULL
  `);

  const cr = corr.rows[0];
  console.log("## Pearson correlations vs outcome_score (todas las convs matched)");
  console.log(`  N = ${cr.n}`);
  console.log(`  MQS composite       r = ${fmt(cr.corr_mqs, 3)}`);
  console.log(`  Response time       r = ${fmt(cr.corr_rt, 3)}   (negativo esperado)`);
  console.log(`  Message length      r = ${fmt(cr.corr_ml, 3)}`);
  console.log(`  Buying signals (n)  r = ${fmt(cr.corr_buying, 3)}`);
  console.log(`  Commit signals (n)  r = ${fmt(cr.corr_commit, 3)}`);
  console.log();

  await pool.end();
}

main().catch((err) => {
  console.error("[report-outcomes] Fatal:", err);
  process.exit(1);
});
