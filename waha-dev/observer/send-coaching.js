import { pool } from "./db.js";

// ══════════════════════════════════════════════════════════════════════
// send-coaching.js
//
// Envía mensajes de coaching a los agentes desde la sesión de prueba
// WAHA (test-noweb por default). Cada mensaje incluye métricas reales.
//
// Uso:
//   node send-coaching.js           → dry-run (imprime qué enviaría)
//   node send-coaching.js --send    → envía de verdad
//   node send-coaching.js --send --only=Carolin  → envía a uno solo
//
// Logea cada envío en coaching_messages_log para auditoría.
// ══════════════════════════════════════════════════════════════════════

const WAHA_API_URL = process.env.WAHA_API_URL || "http://waha:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const COACHING_SESSION = process.env.COACHING_SESSION || "test-noweb";

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").split("=")[1] || null;

// ── Mensajes de coaching (basados en el reporte de 2026-04-14) ──
const COACHING = [
  {
    agent: "Carolin Cornejo",
    phone: "+56973763009",
    text: `Hola Caro 👋 te comparto tu resumen del mes:
• 198 deals en seguimiento, 92.8% de cierre. Eres N°1 del equipo.
• Tus mensajes son los más cortos (32 caracteres prom) — y por eso convierten.

Meta de esta semana: pásanos 3 ejemplos reales de cómo cierras, para armar un playbook del equipo. Tu receta está funcionando 💪`,
  },
  {
    agent: "Camila Alcayaga",
    phone: "+56957091330",
    text: `Cami 👋 resumen del mes:
• 144 deals en seguimiento, 91% de cierre. Top 2 del equipo.
• Estilo corto y directo que funciona (40 caracteres prom).

Foco esta semana: tienes 77 deals abiertos. Revisa cuáles llevan +14 días sin respuesta del cliente — cerrar o soltar. No dejes leads tibios 🎯`,
  },
  {
    agent: "Giselle Santander",
    phone: "+56981549477",
    text: `Gise 👋 tu resumen:
• 80% de cierre cuando te toca seguimiento. Excelente.
• Lo mejor: eres la que más "pregunta de cierre" del equipo — sigues pidiendo decisiones.

Desafío: tu volumen de deals en seguimiento es bajo (22). Podrías absorber más. Conversemos qué te está limitando — hay espacio para crecer 🚀`,
  },
  {
    agent: "Allison Contreras",
    phone: "+56934266846",
    text: `Alli 👋 resumen del mes:
• 80% de cierre en los 21 deals que te tocaron.
• Mensajes cortos y precisos (43 caracteres) — estilo ganador.

Lo que veo: tu volumen puede crecer. Tienes la técnica, falta más carga. Hablemos de cómo te asignamos más leads esta quincena 📈`,
  },
  {
    agent: "Gabriela Heck",
    phone: "+56944547790",
    text: `Gabi 👋 tu aporte al equipo este mes:
• 698 leads captados — eres el motor del pipeline, la N°1 por lejos.
• Cuando cerraste este mes, ganaste 3/3 (100%). No eres mala cerradora.

Lo que cuidaría: tus mensajes son 3x más largos que los de Caro y Cami. En seguimiento mensajes más cortos cierran más. Prueba: 1 idea = 1 mensaje. Si dices 3 cosas, son 3 mensajes. Probemos una semana así 💬`,
  },
];

async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coaching_messages_log (
      id bigserial PRIMARY KEY,
      agent_name text NOT NULL,
      phone text NOT NULL,
      session_name text NOT NULL,
      message_text text NOT NULL,
      waha_status integer,
      waha_response jsonb,
      error text,
      sent_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function sendOne(m) {
  const chatId = m.phone.replace(/^\+/, "") + "@c.us";
  const body = { session: COACHING_SESSION, chatId, text: m.text };
  let status = null, json = null, error = null;
  try {
    const res = await fetch(`${WAHA_API_URL}/api/sendText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": WAHA_API_KEY || "",
      },
      body: JSON.stringify(body),
    });
    status = res.status;
    const txt = await res.text();
    try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
    if (!res.ok) error = `HTTP ${status}: ${txt.slice(0, 200)}`;
  } catch (err) {
    error = err.message;
  }
  await pool.query(
    `INSERT INTO coaching_messages_log (agent_name, phone, session_name, message_text, waha_status, waha_response, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [m.agent, m.phone, COACHING_SESSION, m.text, status, json, error]
  );
  return { status, error };
}

async function main() {
  await ensureLogTable();

  const targets = ONLY ? COACHING.filter((m) => m.agent.toLowerCase().includes(ONLY.toLowerCase())) : COACHING;
  if (!targets.length) {
    console.error(`No match para --only=${ONLY}. Disponibles: ${COACHING.map((m) => m.agent).join(", ")}`);
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  COACHING SENDER  ·  mode=${SEND ? "SEND" : "DRY-RUN"}  ·  session=${COACHING_SESSION}`);
  console.log(`  targets=${targets.map((m) => m.agent).join(", ")}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const m of targets) {
    console.log(`── ${m.agent} (${m.phone}) ──`);
    console.log(m.text);
    console.log();
    if (SEND) {
      const { status, error } = await sendOne(m);
      console.log(error ? `  ❌ ${error}` : `  ✅ HTTP ${status} — logeado`);
      console.log();
      // respiro entre envíos para no disparar antispam
      await new Promise((r) => setTimeout(r, 3000));
    } else {
      console.log(`  (dry-run — agregá --send para enviar de verdad)\n`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[send-coaching] Fatal:", err);
  process.exit(1);
});
