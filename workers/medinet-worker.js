import express from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { accessSync, constants as fsConstants } from "fs";

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.MEDINET_WORKER_TOKEN;
const MEDINET_RUT = process.env.MEDINET_RUT || "13580388k";

if (!TOKEN) {
  console.error("MEDINET_WORKER_TOKEN is required");
  process.exit(1);
}

function resolveScript() {
  if (process.env.MEDINET_ANTONIA_SCRIPT) return process.env.MEDINET_ANTONIA_SCRIPT;
  const base = fileURLToPath(new URL("../Antonia/", import.meta.url));
  for (const name of ["medinet-antonia.cjs", "medinet-antonia.js"]) {
    try { accessSync(base + name, fsConstants.R_OK); return base + name; } catch { /* skip */ }
  }
  return base + "medinet-antonia.cjs";
}

const SCRIPT = resolveScript();

const TIMEOUTS = { cache: 60000, search: 45000, book: 60000 };

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function buildEnv(action, payload) {
  const base = { ...process.env, MEDINET_RUT, MEDINET_HEADED: "false" };

  if (action === "cache") {
    return { ...base, MEDINET_MODE: "cache" };
  }

  if (action === "search") {
    return {
      ...base,
      MEDINET_QUERY: String(payload.query || ""),
      MEDINET_PATIENT_PHONE: String(payload.patientPhone || ""),
      MEDINET_PATIENT_MESSAGE: String(payload.patientMessage || ""),
    };
  }

  if (action === "book") {
    const { slot = {}, patientData = {} } = payload;
    return {
      ...base,
      MEDINET_MODE: "book",
      MEDINET_PROFESSIONAL_ID: String(slot.professionalId || ""),
      MEDINET_SLOT_DATE: String(slot.dataDia || ""),
      MEDINET_SLOT_TIME: String(slot.time || ""),
      MEDINET_PATIENT_NOMBRES: String(patientData.nombres || ""),
      MEDINET_PATIENT_AP_PATERNO: String(patientData.apPaterno || ""),
      MEDINET_PATIENT_AP_MATERNO: String(patientData.apMaterno || ""),
      MEDINET_PATIENT_PREVISION: String(patientData.prevision || ""),
      MEDINET_PATIENT_NACIMIENTO: String(patientData.nacimiento || ""),
      MEDINET_PATIENT_EMAIL: String(patientData.email || ""),
      MEDINET_PATIENT_FONO: String(patientData.fono || ""),
      MEDINET_PATIENT_DIRECCION: String(patientData.direccion || ""),
    };
  }

  return null;
}

app.post("/medinet/run", authMiddleware, async (req, res) => {
  const { action, payload = {} } = req.body || {};

  if (!["search", "book", "cache"].includes(action)) {
    return res.status(400).json({ error: `Invalid action: ${action}` });
  }

  const env = buildEnv(action, payload);
  const timeoutMs = TIMEOUTS[action] || 60000;

  try {
    const { stdout } = await execFileAsync("node", [SCRIPT], {
      env,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (action === "cache") {
      return res.json({ success: true });
    }

    const match = stdout.match(/ANTONIA_RESPONSE\s+(\{[\s\S]*\})/);
    if (!match) {
      return res.status(500).json({ error: "No ANTONIA_RESPONSE found in output" });
    }

    const result = JSON.parse(match[1]);
    return res.json(result);
  } catch (error) {
    console.error(`[medinet-worker] ${action} error:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Medinet worker listening on port ${PORT}`);
  console.log(`Script: ${SCRIPT}`);
});
