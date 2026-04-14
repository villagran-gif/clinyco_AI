import { pool } from "./db.js";
import { writeFileSync } from "fs";

// ══════════════════════════════════════════════════════════════════════
// generate-coaching.js
//
// Consulta métricas en vivo de cada agente WAHA activo y genera un
// mensaje de coaching personalizado según una clasificación automática:
//
//   TOP_CLOSER       → win_rate ≥ 85% en c2 (o vista A)  →  "pásanos tu playbook"
//   ACTIVE_MID       → win_rate 60-85% y msg_len < 80   →  "foco en cerrar pipeline"
//   LOW_VOLUME       → c2_deals < 30 con buena win%     →  "absorber más carga"
//   LONG_MESSAGES    → msg_len > 90                     →  "acortar mensajes"
//   HIGH_VOL_CAPTADOR→ c1_deals > 300                   →  "reforzar rol de captación"
//
// Escribe coaching-messages.json con el array de {agent, phone, text, data}.
// send-coaching.js luego lee ese archivo.
// ══════════════════════════════════════════════════════════════════════

const OUTPUT_PATH = process.env.COACHING_OUTPUT || "/app/coaching-messages.json";

// Alias → nombres que aparecen en sell_deals_cache.colaborador_{1,2,3}
// Usado para sumar "Carolin" + "Carolin Cornejo" bajo el mismo agente.
function aliasSqlClause(agentName) {
  const first = agentName.split(" ")[0].toLowerCase();
  return `(lower(colaborador_X) = lower($1) OR split_part(lower(colaborador_X), ' ', 1) = '${first.replace(/'/g, "''")}')`;
}

async function statsForAgent(agent) {
  // Volúmenes Sell por rol
  const sellRes = await pool.query(`
    SELECT
      count(*) FILTER (WHERE ${aliasSqlClause(agent.agent_name).replace(/colaborador_X/g, "colaborador_1")}) AS c1_deals,
      count(*) FILTER (WHERE ${aliasSqlClause(agent.agent_name).replace(/colaborador_X/g, "colaborador_1")} AND is_closed_won) AS c1_won,
      count(*) FILTER (WHERE ${aliasSqlClause(agent.agent_name).replace(/colaborador_X/g, "colaborador_2")}) AS c2_deals,
      count(*) FILTER (WHERE ${aliasSqlClause(agent.agent_name).replace(/colaborador_X/g, "colaborador_2")} AND is_closed_won) AS c2_won,
      count(*) FILTER (WHERE ${aliasSqlClause(agent.agent_name).replace(/colaborador_X/g, "colaborador_2")} AND stage_category = 'lost') AS c2_lost,
      count(*) FILTER (WHERE ${aliasSqlClause(agent.agent_name).replace(/colaborador_X/g, "colaborador_2")} AND stage_category = 'open') AS c2_open
    FROM sell_deals_cache
  `, [agent.agent_name]);
  const s = sellRes.rows[0];
  const c2Decided = Number(s.c2_won) + Number(s.c2_lost);
  const c2WinRate = c2Decided > 0 ? Number(s.c2_won) / c2Decided : null;

  // Comportamiento WAHA último mes
  const wahaRes = await pool.query(`
    SELECT
      count(DISTINCT adc.id) AS convs,
      count(adm.id) FILTER (WHERE adm.direction = 'agent_to_client') AS agent_msgs,
      avg(char_length(adm.body)) FILTER (WHERE adm.direction = 'agent_to_client') AS msg_len,
      avg(adm.mqs_composite) FILTER (WHERE adm.direction = 'agent_to_client') AS mqs
    FROM agent_direct_conversations adc
    LEFT JOIN agent_direct_messages adm ON adm.conversation_id = adc.id
    WHERE adc.session_name = $1
  `, [agent.session_name]);
  const w = wahaRes.rows[0];

  // Señales de venta
  const sigRes = await pool.query(`
    SELECT
      count(*) FILTER (WHERE abm.metric_type = 'buying_signal') AS buying,
      count(*) FILTER (WHERE abm.metric_type = 'commitment_signal') AS commit_signals
    FROM agent_direct_conversations adc
    JOIN agent_behavior_metrics abm ON abm.conversation_id = adc.id
    WHERE adc.session_name = $1
  `, [agent.session_name]);

  return {
    c1_deals: Number(s.c1_deals),
    c1_won: Number(s.c1_won),
    c2_deals: Number(s.c2_deals),
    c2_won: Number(s.c2_won),
    c2_lost: Number(s.c2_lost),
    c2_open: Number(s.c2_open),
    c2_win_rate: c2WinRate,
    waha_convs: Number(w.convs),
    agent_msgs: Number(w.agent_msgs),
    msg_len: w.msg_len != null ? Number(w.msg_len) : null,
    mqs: w.mqs != null ? Number(w.mqs) : null,
    buying_signals: Number(sigRes.rows[0].buying),
    commit_signals: Number(sigRes.rows[0].commit_signals),
  };
}

function classify(d) {
  const len = d.msg_len || 0;
  const winPct = d.c2_win_rate != null ? d.c2_win_rate * 100 : null;

  // Captador puro: alto c1, bajo c2 relativo, O mensajes muy largos
  if (d.c1_deals > 300 && (d.c2_deals < 100 || len > 90)) return "HIGH_VOL_CAPTADOR";
  // Mensajes largos sin buen cierre
  if (len > 90 && (winPct == null || winPct < 60)) return "LONG_MESSAGES";
  // Top closer
  if (winPct != null && winPct >= 85) return "TOP_CLOSER";
  // Bajo volumen con buena técnica
  if (d.c2_deals < 30 && winPct != null && winPct >= 70) return "LOW_VOLUME";
  // Medio activo
  if (winPct != null && winPct >= 60) return "ACTIVE_MID";
  // Default
  return "GENERIC";
}

function renderMessage(agent, d, klass) {
  const firstName = agent.agent_name.split(" ")[0];
  const winStr = d.c2_win_rate != null ? `${(d.c2_win_rate * 100).toFixed(1)}%` : "—";
  const lenStr = d.msg_len != null ? `${Math.round(d.msg_len)} caracteres` : "—";

  switch (klass) {
    case "TOP_CLOSER":
      return `Hola ${firstName} 👋 resumen del mes:
• ${d.c2_deals} deals en seguimiento, ${winStr} de cierre. Eres referente del equipo.
• Tus mensajes son cortos (${lenStr} prom) — esa es la receta.

Pedido de la semana: compártenos 3 ejemplos reales de cómo cierras, para armar playbook del equipo. Tu técnica está funcionando 💪`;

    case "ACTIVE_MID":
      return `${firstName} 👋 resumen del mes:
• ${d.c2_deals} deals en seguimiento, ${winStr} de cierre.
• Estilo corto y directo (${lenStr} prom) — sigue así.

Foco esta semana: tienes ${d.c2_open} deals abiertos. Revisa cuáles llevan +14 días sin respuesta del cliente — cerrar o soltar. No dejes leads tibios 🎯`;

    case "LOW_VOLUME":
      return `${firstName} 👋 tu resumen:
• ${winStr} de cierre cuando te toca seguimiento. Excelente.
• Lo mejor: ${d.commit_signals} señales de compromiso pedidas a clientes en ${d.waha_convs} conversaciones.

Desafío: tu volumen de deals en seguimiento es bajo (${d.c2_deals}). Podrías absorber más carga. Conversemos qué te está limitando — hay espacio para crecer 🚀`;

    case "LONG_MESSAGES":
      return `${firstName} 👋 dos observaciones:
• Este mes tuviste ${d.c2_deals} deals en seguimiento con ${winStr} de cierre.
• Tus mensajes promedian ${lenStr}. Los top del equipo están en 30–45 caracteres.

En venta médica por WhatsApp, mensajes más cortos cierran más. Regla simple: 1 idea = 1 mensaje. Si dices 3 cosas, son 3 mensajes separados. Probemos una semana así 💬`;

    case "HIGH_VOL_CAPTADOR":
      return `${firstName} 👋 tu aporte al equipo este mes:
• ${d.c1_deals} leads captados — eres el motor del pipeline.
• Tu rol real está en la captación: ahí nadie te alcanza.

Dato: tus mensajes son ${lenStr} prom, más largos que los closers del equipo (30–45 car). En seguimiento ayuda acortar. Si no, sigamos maximizando tu fuerte que es traer leads 💬`;

    default:
      return `${firstName} 👋 tu resumen del mes:
• Deals en seguimiento: ${d.c2_deals} (${winStr} de cierre)
• Conversaciones observadas: ${d.waha_convs}
• Largo de mensaje prom: ${lenStr}

Hablemos esta semana 15 minutos para revisar casos puntuales y siguiente foco 📊`;
  }
}

async function main() {
  const agentsRes = await pool.query(`
    SELECT session_name, agent_name, agent_phone
    FROM agent_waha_sessions
    WHERE is_active AND session_name <> 'test-noweb' AND agent_phone IS NOT NULL
    ORDER BY agent_name
  `);

  const out = [];
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  GENERATE-COACHING — ${agentsRes.rows.length} agentes activos`);
  console.log(`  Output: ${OUTPUT_PATH}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const agent of agentsRes.rows) {
    const data = await statsForAgent(agent);
    const klass = classify(data);
    const text = renderMessage(agent, data, klass);
    console.log(`── ${agent.agent_name}  [${klass}]  c2=${data.c2_deals} win=${data.c2_win_rate != null ? (data.c2_win_rate * 100).toFixed(1) + "%" : "—"}  msg_len=${data.msg_len ? Math.round(data.msg_len) : "—"}ch`);
    console.log(text + "\n");
    out.push({ agent: agent.agent_name, phone: agent.agent_phone, classification: klass, data, text });
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\n✅ Escrito: ${OUTPUT_PATH}  (${out.length} mensajes)`);
  console.log(`   Revisa antes de enviar:  cat ${OUTPUT_PATH}`);
  console.log(`   Enviar:                  node send-coaching.js --send\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("[generate-coaching] Fatal:", err);
  process.exit(1);
});
