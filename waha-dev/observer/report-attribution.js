import { pool } from "./db.js";

// ══════════════════════════════════════════════════════════════════════
// report-attribution.js
//
// Reporte de outcomes de Zendesk Sell atribuidos correctamente por los
// 3 roles del negocio:
//   1. CAPTACIÓN (colaborador_1): primer contacto con el lead
//   2. SEGUIMIENTO (colaborador_2): KPI REAL de venta
//   3. CIERRE (colaborador_3): operacional (puede ser el mismo del 2)
//
// Match WAHA ↔ Sell por nombre normalizado (lowercase + sin acentos),
// con fallback a primer nombre. Resuelve el caso "Carolin" ↔ "Carolin Cornejo".
// ══════════════════════════════════════════════════════════════════════

function stripDiacritics(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(s) {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function firstName(s) {
  return normalize(s).split(" ")[0] || "";
}

function fmt(n, digits = 2) {
  if (n == null) return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(num)) return "—";
  return num.toFixed(digits);
}

function pct(num, den) {
  if (!den || den === 0) return "—";
  return ((num / den) * 100).toFixed(1) + "%";
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function rpad(s, w) {
  s = String(s);
  return s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("  CLINYCO — ATTRIBUTION REPORT (Captación · Seguimiento · Cierre)");
  console.log(`  Generated: ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  // ─────────────────────────────────────────────────────────────────
  // 1. Agentes WAHA activos (para cruzar con Sell)
  // ─────────────────────────────────────────────────────────────────
  const wahaRes = await pool.query(`
    SELECT session_name, agent_name, agent_phone
    FROM agent_waha_sessions
    WHERE is_active AND session_name <> 'test-noweb'
    ORDER BY agent_name
  `);
  const wahaAgents = wahaRes.rows.map((r) => ({
    ...r,
    norm: normalize(r.agent_name),
    first: firstName(r.agent_name),
  }));

  // Dado un nombre de Sell (ej "Carolin" o "Carolin Cornejo"), retornar el agente WAHA match
  function findWahaMatch(sellName) {
    const n = normalize(sellName);
    const f = firstName(sellName);
    if (!n) return null;
    // 1. match exacto (e.g. "carolin cornejo" vs "carolin cornejo")
    let hit = wahaAgents.find((a) => a.norm === n);
    if (hit) return hit;
    // 2. sell es solo primer nombre y match contra primer nombre WAHA
    if (!n.includes(" ")) {
      hit = wahaAgents.find((a) => a.first === n);
      if (hit) return hit;
    }
    // 3. sell tiene varias palabras, prefix match
    hit = wahaAgents.find((a) => n.startsWith(a.first + " ") || a.norm.startsWith(n + " "));
    return hit || null;
  }

  // Agrupar deals por nombre "canonizado al primer nombre" cuando haya WAHA match,
  // para sumar "Carolin" + "Carolin Cornejo" como una sola fila.
  function canonize(sellName) {
    const match = findWahaMatch(sellName);
    if (match) return { key: match.session_name, display: match.agent_name, matched: true };
    return { key: `__nowaha::${normalize(sellName)}`, display: sellName, matched: false };
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. Agregación por rol (CAPTACIÓN, SEGUIMIENTO, CIERRE)
  // ─────────────────────────────────────────────────────────────────
  async function aggregateByRole(column, label) {
    const { rows } = await pool.query(`
      SELECT
        ${column} AS name,
        count(*) AS deals,
        count(*) FILTER (WHERE is_closed_won) AS won,
        count(*) FILTER (WHERE stage_category = 'lost') AS lost,
        count(*) FILTER (WHERE stage_category = 'open') AS open,
        avg(outcome_score) FILTER (WHERE stage_category = 'open') AS avg_open_likelihood,
        sum(value) FILTER (WHERE is_closed_won) AS won_value
      FROM sell_deals_cache
      WHERE ${column} IS NOT NULL
      GROUP BY ${column}
    `);

    // Agrupar por canonical key
    const bucket = new Map();
    for (const r of rows) {
      const { key, display, matched } = canonize(r.name);
      if (!bucket.has(key)) {
        bucket.set(key, {
          display, matched, aliases: [],
          deals: 0, won: 0, lost: 0, open: 0, won_value: 0,
          likelihood_sum: 0, likelihood_n: 0,
        });
      }
      const b = bucket.get(key);
      b.aliases.push(r.name);
      b.deals += Number(r.deals);
      b.won += Number(r.won);
      b.lost += Number(r.lost);
      b.open += Number(r.open);
      b.won_value += Number(r.won_value || 0);
      if (r.avg_open_likelihood != null) {
        b.likelihood_sum += Number(r.avg_open_likelihood) * Number(r.open);
        b.likelihood_n += Number(r.open);
      }
    }

    const out = [...bucket.values()]
      .map((b) => ({
        ...b,
        aliases: b.aliases.sort((a, b2) => a.length - b2.length).join(" · "),
        decided: b.won + b.lost,
        win_rate: (b.won + b.lost) > 0 ? b.won / (b.won + b.lost) : null,
        avg_open_likelihood: b.likelihood_n > 0 ? b.likelihood_sum / b.likelihood_n : null,
      }))
      .sort((a, b) => b.deals - a.deals);

    console.log(`## ${label}`);
    console.log(`  ${pad("Persona", 22)} ${pad("WAHA", 6)} ${rpad("Deals", 6)} ${rpad("Won", 5)} ${rpad("Lost", 5)} ${rpad("Open", 5)} ${rpad("Win%", 7)} ${rpad("LH_open", 8)}`);
    console.log(`  ${"─".repeat(80)}`);
    for (const b of out) {
      console.log(
        `  ${pad(b.display, 22)} ${pad(b.matched ? "✓" : "✗", 6)} ${rpad(b.deals, 6)} ${rpad(b.won, 5)} ${rpad(b.lost, 5)} ${rpad(b.open, 5)} ${rpad(b.win_rate != null ? (b.win_rate * 100).toFixed(1) + "%" : "—", 7)} ${rpad(fmt(b.avg_open_likelihood, 1), 8)}`
      );
      if (b.aliases !== b.display) {
        console.log(`  ${" ".repeat(22)}   ↳ ${b.aliases}`);
      }
    }
    console.log();
    return out;
  }

  await aggregateByRole("colaborador_1", "CAPTACIÓN (c1) — primer contacto con el lead");
  const seguimiento = await aggregateByRole("colaborador_2", "SEGUIMIENTO (c2) — KPI REAL DE VENTA");
  await aggregateByRole("colaborador_3", "CIERRE (c3) — operacional");

  // ─────────────────────────────────────────────────────────────────
  // 3. Para los agentes CON WAHA match: cruzar con métricas de comportamiento
  //    y MQS de agent_direct_messages (solo sobre convs donde son el c2 del deal)
  // ─────────────────────────────────────────────────────────────────
  console.log("## SEGUIMIENTO × WAHA — outcomes + behavior (solo agentes con sesión activa)\n");
  console.log("  Dos vistas por agente:");
  console.log("    (A) TODAS sus convs WAHA con algún deal en Sell (regardless de rol)");
  console.log("    (B) SOLO convs donde el agente es c2 del deal (más precisa pero N chico)\n");

  for (const b of seguimiento) {
    if (!b.matched) continue;
    const agent = wahaAgents.find((a) => a.agent_name === b.display);
    if (!agent) continue;

    // Helper: stats de un SET de conversation_ids, sin join multiplicador
    async function statsForConvs(convIds) {
      if (!convIds.length) return { agent_msgs: 0, mqs: null, msg_len: null, buying: 0, commit: 0, objection: 0 };
      const msg = await pool.query(`
        SELECT
          count(*) AS agent_msgs,
          avg(mqs_composite) AS mqs,
          avg(char_length(body)) AS msg_len
        FROM agent_direct_messages
        WHERE conversation_id = ANY($1) AND direction = 'agent_to_client'
      `, [convIds]);
      const sig = await pool.query(`
        SELECT
          count(*) FILTER (WHERE metric_type = 'buying_signal')     AS buying,
          count(*) FILTER (WHERE metric_type = 'commitment_signal') AS "commit",
          count(*) FILTER (WHERE metric_type = 'objection_signal')  AS objection
        FROM agent_behavior_metrics
        WHERE conversation_id = ANY($1)
      `, [convIds]);
      return { ...msg.rows[0], ...sig.rows[0] };
    }

    // (A) TODAS las convs del agente que cruzan con algún deal Sell
    const allConvsRes = await pool.query(`
      SELECT DISTINCT adc.id, adc.client_phone, sdc.is_closed_won, sdc.stage_category, sdc.colaborador_2
      FROM agent_direct_conversations adc
      JOIN sell_deals_cache sdc ON sdc.contact_phone = adc.client_phone
      WHERE adc.session_name = $1
    `, [agent.session_name]);
    const allConvIds = [...new Set(allConvsRes.rows.map((r) => r.id))];
    const allWon = new Set(allConvsRes.rows.filter((r) => r.is_closed_won).map((r) => r.id)).size;
    const allLost = new Set(allConvsRes.rows.filter((r) => r.stage_category === "lost").map((r) => r.id)).size;

    // (B) Solo las convs donde el agente es c2 del deal
    const c2ConvsRes = await pool.query(`
      SELECT DISTINCT adc.id, sdc.is_closed_won, sdc.stage_category
      FROM agent_direct_conversations adc
      JOIN sell_deals_cache sdc ON sdc.contact_phone = adc.client_phone
      WHERE adc.session_name = $1
        AND sdc.colaborador_2 IS NOT NULL
        AND (lower(sdc.colaborador_2) = lower($2)
          OR split_part(lower(sdc.colaborador_2), ' ', 1) = split_part(lower($2), ' ', 1))
    `, [agent.session_name, agent.agent_name]);
    const c2ConvIds = [...new Set(c2ConvsRes.rows.map((r) => r.id))];
    const c2Won = new Set(c2ConvsRes.rows.filter((r) => r.is_closed_won).map((r) => r.id)).size;
    const c2Lost = new Set(c2ConvsRes.rows.filter((r) => r.stage_category === "lost").map((r) => r.id)).size;

    const allStats = await statsForConvs(allConvIds);
    const c2Stats = await statsForConvs(c2ConvIds);

    const allDecided = allWon + allLost;
    const c2Decided = c2Won + c2Lost;

    console.log(`### ${b.display}   (session ${agent.session_name})`);
    console.log(`  Sell c2 total:   ${b.deals} deals → ${b.won} won / ${b.lost} lost / ${b.open} open  (win ${b.win_rate != null ? (b.win_rate * 100).toFixed(1) + "%" : "—"} de decididos)`);
    console.log(`  (A) TODAS sus convs WAHA × Sell:`);
    console.log(`        convs=${allConvIds.length}  won=${allWon}  lost=${allLost}  open=${allConvIds.length - allDecided}  (win ${pct(allWon, allDecided)})`);
    console.log(`        msgs=${allStats.agent_msgs}  MQS=${fmt(allStats.mqs)}  msg_len=${fmt(allStats.msg_len, 0)}ch  buying=${allStats.buying}  commit=${allStats.commit}  objection=${allStats.objection}`);
    console.log(`  (B) Solo convs donde él/ella es c2:`);
    console.log(`        convs=${c2ConvIds.length}  won=${c2Won}  lost=${c2Lost}  open=${c2ConvIds.length - c2Decided}  (win ${pct(c2Won, c2Decided)})`);
    console.log(`        msgs=${c2Stats.agent_msgs}  MQS=${fmt(c2Stats.mqs)}  msg_len=${fmt(c2Stats.msg_len, 0)}ch  buying=${c2Stats.buying}  commit=${c2Stats.commit}  objection=${c2Stats.objection}`);
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. MQS correlation con win/loss — dos vistas (amplia + estricta)
  //    Agregamos a nivel conv primero para evitar join multiplicador.
  // ─────────────────────────────────────────────────────────────────
  async function mqsByOutcome(filterC2) {
    return pool.query(`
      WITH conv_deal AS (
        SELECT DISTINCT ON (adc.id)
          adc.id AS conv_id,
          sdc.is_closed_won
        FROM agent_direct_conversations adc
        JOIN sell_deals_cache sdc ON sdc.contact_phone = adc.client_phone
        WHERE sdc.stage_category IN ('won','lost')
          ${filterC2 ? "AND sdc.colaborador_2 IS NOT NULL" : ""}
        ORDER BY adc.id, sdc.updated_at_sell DESC NULLS LAST
      ),
      conv_mqs AS (
        SELECT conversation_id AS conv_id,
               avg(mqs_composite)           AS mqs,
               avg(mqs_information_quality) AS info,
               avg(mqs_problem_solving)     AS problem,
               avg(mqs_understanding)       AS under_,
               avg(mqs_clarity)             AS clarity,
               avg(char_length(body))       AS msg_len
        FROM agent_direct_messages
        WHERE direction = 'agent_to_client' AND mqs_composite IS NOT NULL
        GROUP BY conversation_id
      )
      SELECT cd.is_closed_won,
             count(*)         AS convs,
             avg(cm.mqs)      AS mqs,
             avg(cm.info)     AS info,
             avg(cm.problem)  AS problem,
             avg(cm.under_)   AS under_,
             avg(cm.clarity)  AS clarity,
             avg(cm.msg_len)  AS msg_len
      FROM conv_deal cd
      LEFT JOIN conv_mqs cm ON cm.conv_id = cd.conv_id
      GROUP BY cd.is_closed_won
      ORDER BY cd.is_closed_won DESC
    `);
  }

  console.log("## MQS avg — WON vs LOST\n");
  for (const scope of [
    { label: "(A) Todas las convs WAHA con deal decidido",        filter: false },
    { label: "(B) Solo convs con c2 atribuido (N chico)",         filter: true },
  ]) {
    console.log(`  ${scope.label}`);
    const q = await mqsByOutcome(scope.filter);
    console.log(`  ${pad("Outcome", 8)} ${rpad("Convs", 6)} ${rpad("MQS", 6)} ${rpad("Info", 6)} ${rpad("Prob", 6)} ${rpad("Under", 7)} ${rpad("Clar", 6)} ${rpad("MsgLen", 7)}`);
    console.log(`  ${"─".repeat(70)}`);
    for (const r of q.rows) {
      const label = r.is_closed_won ? "WON" : "LOST";
      console.log(
        `  ${pad(label, 8)} ${rpad(r.convs, 6)} ${rpad(fmt(r.mqs), 6)} ${rpad(fmt(r.info), 6)} ${rpad(fmt(r.problem), 6)} ${rpad(fmt(r.under_), 7)} ${rpad(fmt(r.clarity), 6)} ${rpad(fmt(r.msg_len, 0), 7)}`
      );
    }
    console.log();
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[report-attribution] Fatal:", err);
  process.exit(1);
});
