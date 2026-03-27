import express from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { accessSync, constants as fsConstants } from "fs";
import {
  checkCupos,
  searchSlotsNoAuth,
  searchSlotsViaApi,
  bookAppointmentForPatient,
  formatRutWithDots,
  DEFAULT_BRANCH_ID,
  loginJwt,
  fetchPaymentMethods,
  registerPayment,
} from "../Antonia/medinet-api.js";

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

const DEFAULT_TIMEOUTS = { cache: 60000, search: 45000, book: 120000, search_and_book: 180000, book_api: 15000, search_api: 15000 };

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
  const rutFromPayload = String(payload?.patientRut || "").trim();
  const base = { ...process.env, MEDINET_RUT: rutFromPayload || MEDINET_RUT, MEDINET_HEADED: "false" };

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

  if (action === "book" || action === "search_and_book") {
    const { slot = {}, patientData = {} } = payload;
    return {
      ...base,
      MEDINET_MODE: action,
      MEDINET_PROFESSIONAL_ID: String(slot.professionalId || ""),
      MEDINET_SLOT_DATE: String(slot.dataDia || ""),
      MEDINET_SLOT_TIME: String(slot.time || ""),
      MEDINET_BRANCH_NAME: String(slot.branch || ""),
      MEDINET_PATIENT_RUT: String(patientData.rut || ""),
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

// ─── API-only endpoints (no Puppeteer, instant response) ──────

/**
 * Search for slots via pure API (no browser).
 * POST /medinet/api/search { query, patientRut, branchId? }
 */
app.post("/medinet/api/search", authMiddleware, async (req, res) => {
  const { query, patientRut, branchId } = req.body || {};
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    const rut = formatRutWithDots(patientRut || MEDINET_RUT);
    const branch = Number(branchId || DEFAULT_BRANCH_ID);

    // Check cupos first
    const cuposResult = await checkCupos(branch, rut).catch((e) => ({ status: false, mensaje: e.message }));

    // Try auth-based search first (returns up to 6 slots with 14-day date range)
    let searchResult = null;
    try {
      console.log("[medinet-worker] auth search | query:", query);
      searchResult = await searchSlotsViaApi({ query, branchId: branch });
      if (searchResult?.available_slots?.length > 0) {
        console.log("[medinet-worker] auth search | SUCCESS:", searchResult.available_slots.length, "slots");
      }
    } catch (e) {
      console.log("[medinet-worker] auth search failed, trying noauth:", e.message);
    }

    // Fall back to no-auth search if auth returned no slots
    if (!searchResult?.available_slots?.length) {
      try {
        console.log("[medinet-worker] noauth search | query:", query);
        searchResult = await searchSlotsNoAuth({ query, branchId: branch });
        if (searchResult?.available_slots?.length > 0) {
          console.log("[medinet-worker] noauth search | SUCCESS:", searchResult.available_slots.length, "slots");
        }
      } catch (e) {
        console.log("[medinet-worker] noauth search also failed:", e.message);
        searchResult = { source: "api_noauth", available_slots: [], patient_reply: null };
      }
    }

    return res.json({
      ...searchResult,
      source: searchResult.source || "antonia_api_search",
      cupos: cuposResult,
    });
  } catch (error) {
    console.error("[medinet-worker] api/search error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Book a slot via pure API (no browser).
 * POST /medinet/api/book { slot, patientData, branchId? }
 *
 * slot: { professionalId, dataDia, time, duration, specialtyId, tipoCitaId }
 * patientData: { run, email, fono, nombres?, apPaterno?, apMaterno?, direccion?, sexo?, fechaNacimiento?, prevision? }
 */
app.post("/medinet/api/book", authMiddleware, async (req, res) => {
  const { slot, patientData = {}, branchId } = req.body || {};

  if (!slot?.professionalId || !slot?.dataDia || !slot?.time) {
    return res.status(400).json({ error: "slot.professionalId, slot.dataDia, and slot.time are required" });
  }

  const rut = formatRutWithDots(patientData.run || patientData.rut || MEDINET_RUT);
  const branch = Number(branchId || DEFAULT_BRANCH_ID);

  try {
    // Step 1: Check cupos and whether patient exists
    const cupos = await checkCupos(branch, rut).catch(() => null);

    if (cupos && !cupos.puede_agendar) {
      return res.json({
        source: "antonia_api_book",
        success: false,
        message: cupos.mensaje || "El paciente no puede agendar.",
        patient_reply: cupos.mensaje || "No puedes agendar más citas en este momento.",
      });
    }

    const pacienteExiste = cupos?.paciente_existe !== false;

    // Step 2: Book via API (3-tier: agendaweb → chatbot → overschedule)
    const result = await bookAppointmentForPatient({
      slot,
      patientData: { ...patientData, run: rut },
      branchId: branch,
      pacienteExiste,
    });

    return res.json(result);
  } catch (error) {
    console.error("[medinet-worker] api/book error:", error.message);
    return res.status(500).json({
      source: "antonia_api_book",
      success: false,
      error: error.message,
    });
  }
});

// ─── JWT / Payment endpoints (proxied through VPS to bypass Cloudflare) ───

app.get("/medinet/api/jwt-login", authMiddleware, async (_req, res) => {
  try {
    const token = await loginJwt();
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/medinet/api/payment-methods", authMiddleware, async (_req, res) => {
  try { res.json(await fetchPaymentMethods()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/medinet/api/register-payment/:appointmentId", authMiddleware, async (req, res) => {
  try { res.json(await registerPayment(req.params.appointmentId, req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Legacy Puppeteer-based endpoints ─────────────────────────

app.post("/medinet/run", authMiddleware, async (req, res) => {
  const { action, payload = {} } = req.body || {};

  if (!["search", "book", "cache", "search_and_book"].includes(action)) {
    return res.status(400).json({ error: `Invalid action: ${action}` });
  }

  const env = buildEnv(action, payload);
  const configuredTimeout = Number(process.env.MEDINET_ANTONIA_TIMEOUT_MS || 0);
  const timeoutMs = payload.timeoutMs || configuredTimeout || DEFAULT_TIMEOUTS[action] || 60000;

  try {
    const { stdout, stderr } = await execFileAsync("node", [SCRIPT], {
      env,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr) {
      console.error(`[medinet-worker] ${action} stderr:`, stderr.slice(-500));
    }

    const match = stdout.match(/ANTONIA_RESPONSE\s+(\{[\s\S]*\})/);
    if (!match) {
      if (action === "cache") return res.json({ success: true });
      // Include stderr excerpt for diagnosis
      const stderrExcerpt = (stderr || "").slice(-300).trim();
      return res.status(500).json({
        error: "No ANTONIA_RESPONSE found in output",
        stderr: stderrExcerpt || undefined,
      });
    }

    const result = JSON.parse(match[1]);
    return res.json(result);
  } catch (error) {
    const stderr = (error.stderr || "").slice(-300).trim();
    console.error(`[medinet-worker] ${action} error:`, error.message, stderr ? `\nstderr: ${stderr}` : "");
    return res.status(500).json({
      error: error.message,
      stderr: stderr || undefined,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Medinet worker listening on port ${PORT}`);
  console.log(`Script: ${SCRIPT}`);
});
