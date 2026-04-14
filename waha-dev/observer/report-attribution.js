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

  for (const b of seguimiento) {
    if (!b.matched) continue;
    const sessionName = b.display; // b.key actually holds session_name when matched
    const agent = wahaAgents.find((a) => a.agent_name === b.display);
    if (!agent) continue;

    // Todas las convs de este agente cuyo contact_phone matchea un deal donde
    // el agente es colaborador_2. Así filtramos ruido (leads de otros c2).
    const attribQ = await pool.query(`
      WITH my_c2_deals AS (
        SELECT contact_phone
        FROM sell_deals_cache
        WHERE colaborador_2 IS NOT NULL
          AND (
            lower(unaccent(colaborador_2)) = lower(unaccent($2))
            OR lower(unaccent(colaborador_2)) = split_part(lower(unaccent($2)), ' ', 1)
            OR split_part(lower(unaccent(colaborador_2)), ' ', 1) = split_part(lower(unaccent($2)), ' ', 1)
          )
          AND contact_phone IS NOT NULL
      )
      SELECT
        count(DISTINCT adc.id) AS convs,
        count(DISTINCT adc.id) FILTER (WHERE sdc.is_closed_won) AS convs_won,
        count(DISTINCT adc.id) FILTER (WHERE sdc.stage_category = 'lost') AS convs_lost,
        count(adm.id) FILTER (WHERE adm.direction = 'agent_to_client') AS agent_msgs,
        avg(adm.mqs_composite) FILTER (WHERE adm.direction = 'agent_to_client') AS mqs,
        avg(char_length(adm.body)) FILTER (WHERE adm.direction = 'agent_to_client') AS msg_len,
        count(abm.id) FILTER (WHERE abm.metric_type = 'buying_signal') AS buying,
        count(abm.id) FILTER (WHERE abm.metric_type = 'commitment_signal') AS commit,
        count(abm.id) FILTER (WHERE abm.metric_type = 'objection_signal') AS objection
      FROM agent_direct_conversations adc
      JOIN my_c2_deals mcd ON mcd.contact_phone = adc.client_phone
      JOIN sell_deals_cache sdc ON sdc.contact_phone = adc.client_phone
      LEFT JOIN agent_direct_messages adm ON adm.conversation_id = adc.id
      LEFT JOIN agent_behavior_metrics abm ON abm.conversation_id = adc.id
      WHERE adc.session_name = $1
    `, [agent.session_name, agent.agent_name]).catch(async (err) => {
      // Si unaccent no está instalado en Render, fallback sin unaccent
      if (!/unaccent/i.test(err.message)) throw err;
      return pool.query(`
        WITH my_c2_deals AS (
          SELECT contact_phone FROM sell_deals_cache
          WHERE colaborador_2 IS NOT NULL
            AND (lower(colaborador_2) = lower($2)
              OR split_part(lower(colaborador_2), ' ', 1) = split_part(lower($2), ' ', 1))
            AND contact_phone IS NOT NULL
        )
        SELECT
          count(DISTINCT adc.id) AS convs,
          count(DISTINCT adc.id) FILTER (WHERE sdc.is_closed_won) AS convs_won,
          count(DISTINCT adc.id) FILTER (WHERE sdc.stage_category = 'lost') AS convs_lost,
          count(adm.id) FILTER (WHERE adm.direction = 'agent_to_client') AS agent_msgs,
          avg(adm.mqs_composite) FILTER (WHERE adm.direction = 'agent_to_client') AS mqs,
          avg(char_length(adm.body)) FILTER (WHERE adm.direction = 'agent_to_client') AS msg_len,
          count(abm.id) FILTER (WHERE abm.metric_type = 'buying_signal') AS buying,
          count(abm.id) FILTER (WHERE abm.metric_type = 'commitment_signal') AS commit,
          count(abm.id) FILTER (WHERE abm.metric_type = 'objection_signal') AS objection
        FROM agent_direct_conversations adc
        JOIN my_c2_deals mcd ON mcd.contact_phone = adc.client_phone
        JOIN sell_deals_cache sdc ON sdc.contact_phone = adc.client_phone
        LEFT JOIN agent_direct_messages adm ON adm.conversation_id = adc.id
        LEFT JOIN agent_behavior_metrics abm ON abm.conversation_id = adc.id
        WHERE adc.session_name = $1
      `, [agent.session_name, agent.agent_name]);
    });
    const a = attribQ.rows[0];

    const decided = Number(a.convs_won) + Number(a.convs_lost);
    const convWin = decided > 0 ? Number(a.convs_won) / decided : null;

    console.log(`### ${b.display}   (session ${agent.session_name})`);
    console.log(`  Sell c2:            ${b.deals} deals → ${b.won} won / ${b.lost} lost / ${b.open} open  (win ${b.win_rate != null ? (b.win_rate * 100).toFixed(1) + "%" : "—"} de decididos)`);
    console.log(`  WAHA convs:         ${a.convs} total, matched-as-c2: ${a.convs}  (won=${a.convs_won} lost=${a.convs_lost} → win ${convWin != null ? (convWin * 100).toFixed(1) + "%" : "—"})`);
    console.log(`  Mensajes agente:    ${a.agent_msgs}  |  MQS: ${fmt(a.mqs)}  |  msg_len avg: ${fmt(a.msg_len, 0)}ch`);
    console.log(`  Señales:            buying=${a.buying}  commit=${a.commit}  objection=${a.objection}`);
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. MQS correlation con win/loss — SOLO en convs con c2 atribuido
  // ─────────────────────────────────────────────────────────────────
  console.log("## MQS avg — WON vs LOST (convs con c2 atribuido a WAHA agent)\n");
  const mqsQ = await pool.query(`
    SELECT
      sdc.is_closed_won,
      sdc.stage_category,
      count(DISTINCT adc.id) AS convs,
      avg(adm.mqs_composite) FILTER (WHERE adm.direction = 'agent_to_client') AS mqs,
      avg(adm.mqs_information_quality) FILTER (WHERE adm.direction = 'agent_to_client') AS info,
      avg(adm.mqs_problem_solving) FILTER (WHERE adm.direction = 'agent_to_client') AS problem,
      avg(adm.mqs_understanding) FILTER (WHERE adm.direction = 'agent_to_client') AS under,
      avg(adm.mqs_clarity) FILTER (WHERE adm.direction = 'agent_to_client') AS clarity
    FROM sell_deals_cache sdc
    JOIN agent_direct_conversations adc ON adc.client_phone = sdc.contact_phone
    JOIN agent_direct_messages adm ON adm.conversation_id = adc.id
    WHERE sdc.stage_category IN ('won', 'lost')
      AND sdc.colaborador_2 IS NOT NULL
    GROUP BY sdc.is_closed_won, sdc.stage_category
    ORDER BY sdc.is_closed_won DESC
  `);
  console.log(`  ${pad("Outcome", 10)} ${rpad("Convs", 6)} ${rpad("MQS", 6)} ${rpad("Info", 6)} ${rpad("Prob", 6)} ${rpad("Under", 7)} ${rpad("Clar", 6)}`);
  console.log(`  ${"─".repeat(60)}`);
  for (const r of mqsQ.rows) {
    const label = r.is_closed_won ? "WON" : "LOST";
    console.log(
      `  ${pad(label, 10)} ${rpad(r.convs, 6)} ${rpad(fmt(r.mqs), 6)} ${rpad(fmt(r.info), 6)} ${rpad(fmt(r.problem), 6)} ${rpad(fmt(r.under), 7)} ${rpad(fmt(r.clarity), 6)}`
    );
  }
  console.log();

  await pool.end();
}

main().catch((err) => {
  console.error("[report-attribution] Fatal:", err);
  process.exit(1);
});
