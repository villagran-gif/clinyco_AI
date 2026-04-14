import { pool } from "./db.js";
import { readFileSync, existsSync } from "fs";

// ══════════════════════════════════════════════════════════════════════
// send-coaching.js
//
// Envía mensajes de coaching desde la sesión WAHA de prueba (test-noweb).
// LEE desde coaching-messages.json (generado por generate-coaching.js).
//
// Uso:
//   node generate-coaching.js       → genera/actualiza el JSON
//   node send-coaching.js           → dry-run (imprime qué enviaría)
//   node send-coaching.js --send    → envía de verdad
//   node send-coaching.js --send --only=Carolin       → uno solo
//   node send-coaching.js --send --override-phone=+569...  → todos a un teléfono (test)
//
// Logea cada envío en coaching_messages_log para auditoría.
// ══════════════════════════════════════════════════════════════════════

const WAHA_API_URL = process.env.WAHA_API_URL || "http://waha:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const COACHING_SESSION = process.env.COACHING_SESSION || "test-noweb";
const INPUT_PATH = process.env.COACHING_INPUT || "/app/coaching-messages.json";

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").split("=")[1] || null;
const OVERRIDE_PHONE = (args.find((a) => a.startsWith("--override-phone=")) || "").split("=")[1] || null;

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

async function sendOne(m, chatPhone) {
  const chatId = chatPhone.replace(/^\+/, "") + "@c.us";
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
    [m.agent, chatPhone, COACHING_SESSION, m.text, status, json, error]
  );
  return { status, error };
}

async function main() {
  if (!existsSync(INPUT_PATH)) {
    console.error(`❌ No existe ${INPUT_PATH}`);
    console.error(`   Corré primero:  node generate-coaching.js`);
    process.exit(1);
  }
  const coaching = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
  await ensureLogTable();

  const targets = ONLY
    ? coaching.filter((m) => m.agent.toLowerCase().includes(ONLY.toLowerCase()))
    : coaching;
  if (!targets.length) {
    console.error(`No match para --only=${ONLY}. Disponibles: ${coaching.map((m) => m.agent).join(", ")}`);
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  COACHING SENDER  ·  mode=${SEND ? "SEND" : "DRY-RUN"}  ·  session=${COACHING_SESSION}`);
  if (OVERRIDE_PHONE) console.log(`  ⚠️  override-phone=${OVERRIDE_PHONE} — TODOS van a ese número`);
  console.log(`  targets=${targets.map((m) => m.agent).join(", ")}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const m of targets) {
    const dest = OVERRIDE_PHONE || m.phone;
    console.log(`── ${m.agent}  →  ${dest}${OVERRIDE_PHONE ? " (override)" : ""} ──`);
    console.log(m.text);
    console.log();
    if (SEND) {
      const { status, error } = await sendOne(m, dest);
      console.log(error ? `  ❌ ${error}` : `  ✅ HTTP ${status} — logeado`);
      console.log();
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
