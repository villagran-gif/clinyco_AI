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
  fetchProximosCuposAll,
  fetchSpecialtiesByBranchNoAuth,
  formatRutWithDots,
  DEFAULT_BRANCH_ID,
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

    // Check cupos in parallel with picker-fecha slot search (up to 6 slots)
    const [cuposResult, searchResult] = await Promise.all([
      checkCupos(branch, rut).catch((e) => ({ status: false, mensaje: e.message })),
      searchSlotsViaApi({ query, branchId: branch }).catch((e) => {
        console.log("[medinet-worker] picker-fecha search failed:", e.message);
        return null;
      }),
    ]);

    // Fall back to no-auth search if picker-fecha returned no slots
    const finalResult = (searchResult?.available_slots?.length > 0)
      ? searchResult
      : await searchSlotsNoAuth({ query, branchId: branch }).catch((e) => {
          console.log("[medinet-worker] noauth search also failed:", e.message);
          return searchResult || { source: "api", available_slots: [], patient_reply: null };
        });

    return res.json({
      ...finalResult,
      source: finalResult.source || "antonia_api_search",
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

    if (cupos && cupos.puede_agendar === false) {
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

// ═══════════════════════════════════════════════════════════════════
//  MELANIA — Booking con datos completos via session cookie
// ═══════════════════════════════════════════════════════════════════

const MEDINET_BASE = "https://clinyco.medinetapp.com";
const MELANIA_USERNAME = process.env.MELANIA_USERNAME || process.env.MEDINET_JWT_USERNAME || "";
const MELANIA_PASSWORD = process.env.MELANIA_PASSWORD || process.env.MEDINET_JWT_PASSWORD || "";

// ── Mapeo prevision texto → IDs Medinet ──
const PREVISION_MAP = {
  "fonasa tramo a": { aseguradoraId: 8, previsionId: 15 },
  "fonasa tramo b": { aseguradoraId: 8, previsionId: 16 },
  "fonasa tramo c": { aseguradoraId: 8, previsionId: 17 },
  "fonasa tramo d": { aseguradoraId: 8, previsionId: 18 },
  "fonasa": { aseguradoraId: 8, previsionId: 12 },
  "banmedica": { aseguradoraId: 3, previsionId: 5 },
  "consalud": { aseguradoraId: 5, previsionId: 10 },
  "colmena": { aseguradoraId: 4, previsionId: 6 },
  "cruz blanca": { aseguradoraId: 6, previsionId: 9 },
  "cruz del norte": { aseguradoraId: 7, previsionId: 11 },
  "particular": { aseguradoraId: 11, previsionId: 2 },
};

function resolvePrevisionIds(previsionText) {
  if (!previsionText) return { aseguradoraId: "", previsionId: "" };
  const key = String(previsionText).toLowerCase().trim();
  return PREVISION_MAP[key] || { aseguradoraId: "", previsionId: "" };
}

// Session cookie cache
let _melaniaSession = null;
let _melaniaCsrf = null;
let _melaniaSessionAt = 0;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

async function melaniaLogin() {
  // GET csrf token
  const pageRes = await fetch(`${MEDINET_BASE}/api-auth/login/`);
  const cookies1 = pageRes.headers.getSetCookie?.() || [];
  const csrf1 = cookies1.find(c => c.startsWith("csrftoken="))?.split(";")[0]?.split("=")[1];
  if (!csrf1) throw new Error("MelanIA login: no csrftoken from GET /api-auth/login/");

  // POST login
  const loginRes = await fetch(`${MEDINET_BASE}/api-auth/login/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRFToken": csrf1,
      "Cookie": `csrftoken=${csrf1}`,
      "Referer": `${MEDINET_BASE}/api-auth/login/`,
    },
    body: new URLSearchParams({
      username: MELANIA_USERNAME,
      password: MELANIA_PASSWORD,
      csrfmiddlewaretoken: csrf1,
    }).toString(),
    redirect: "manual",
  });

  const cookies2 = loginRes.headers.getSetCookie?.() || [];
  const sessionid = cookies2.find(c => c.startsWith("sessionid="))?.split(";")[0]?.split("=")[1];
  const csrftoken = cookies2.find(c => c.startsWith("csrftoken="))?.split(";")[0]?.split("=")[1];

  if (!sessionid) throw new Error("MelanIA login failed: no sessionid");

  _melaniaSession = sessionid;
  _melaniaCsrf = csrftoken;
  _melaniaSessionAt = Date.now();
  console.log("[melania] Login OK, session:", sessionid.slice(0, 10) + "...");
  return { sessionid, csrftoken };
}

async function getMelaniaSession() {
  if (_melaniaSession && (Date.now() - _melaniaSessionAt) < SESSION_TTL_MS) {
    return { sessionid: _melaniaSession, csrftoken: _melaniaCsrf };
  }
  return melaniaLogin();
}

async function melaniaBookWithSession(payload) {
  const { sessionid, csrftoken } = await getMelaniaSession();

  const res = await fetch(`${MEDINET_BASE}/api/agenda/citas/add/?format=json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-CSRFToken": csrftoken,
      "Cookie": `csrftoken=${csrftoken}; sessionid=${sessionid}`,
      "Referer": `${MEDINET_BASE}/agenda/`,
      "Accept": "application/json, text/plain, */*",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  // Session expired — retry once
  if (res.status === 403 || res.status === 302) {
    console.log("[melania] Session expired, re-logging in...");
    _melaniaSession = null;
    const fresh = await getMelaniaSession();
    const retryRes = await fetch(`${MEDINET_BASE}/api/agenda/citas/add/?format=json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "X-CSRFToken": fresh.csrftoken,
        "Cookie": `csrftoken=${fresh.csrftoken}; sessionid=${fresh.sessionid}`,
        "Referer": `${MEDINET_BASE}/agenda/`,
        "Accept": "application/json, text/plain, */*",
      },
      body: JSON.stringify(payload),
    });
    const retryText = await retryRes.text();
    try { data = JSON.parse(retryText); } catch { data = { raw: retryText }; }
    return { status: retryRes.status, data };
  }

  return { status: res.status, data };
}

/**
 * MelanIA MVP: Search + Book con datos completos.
 * POST /melania/book
 * {
 *   query: "villagran" | "nutriologia",
 *   patientData: { rut, nombres, apPaterno, apMaterno, email, fono, nacimiento, prevision, direccion, comuna, sexo },
 *   slotIndex: 0,          // cual slot elegir (0-5), default 0
 *   branchId: 39,          // optional
 * }
 */
app.post("/melania/book", authMiddleware, async (req, res) => {
  const { query, patientData = {}, slotIndex = 0, branchId } = req.body || {};

  if (!query) return res.status(400).json({ success: false, error: "query is required" });
  if (!patientData.rut) return res.status(400).json({ success: false, error: "patientData.rut is required" });

  const branch = Number(branchId || DEFAULT_BRANCH_ID);
  const rut = formatRutWithDots(patientData.rut);

  console.log(`[melania] book: query="${query}" rut=${rut} slotIndex=${slotIndex}`);

  try {
    // 1. Check cupos
    const cupos = await checkCupos(branch, rut).catch(() => null);
    if (cupos && cupos.puede_agendar === false) {
      return res.json({
        success: false,
        source: "melania",
        step: "check_cupos",
        message: cupos.mensaje || "Paciente no puede agendar.",
      });
    }

    // 2. Search slots
    const search = await searchSlotsViaApi({ query, branchId: branch });
    const slots = search.available_slots || [];
    if (!slots.length) {
      return res.json({
        success: false,
        source: "melania",
        step: "search_slots",
        message: "No hay horas disponibles.",
        professional: search.professional,
        specialty: search.specialty,
      });
    }

    const slot = slots[slotIndex] || slots[0];

    // 3. Build payload for /api/agenda/citas/add/
    // Resolve prevision text → numeric IDs
    const prevIds = resolvePrevisionIds(patientData.prevision);
    const aseguradoraId = Number(patientData.aseguradoraId) || prevIds.aseguradoraId || "";
    const previsionId = Number(patientData.previsionId) || prevIds.previsionId || "";

    const bookPayload = {
      run: rut,
      nombre: patientData.nombres || "",
      apellidos: `${patientData.apPaterno || ""} ${patientData.apMaterno || ""}`.trim(),
      fecha_nacimiento: patientData.nacimiento || "",
      email: patientData.email || "",
      telefono_fijo: patientData.fono || "",
      telefono_movil: patientData.fono || "",
      direccion: patientData.direccion || "",
      comuna: Number(patientData.comuna) || "",
      sexo: Number(patientData.sexo) || 3,
      aseguradora: aseguradoraId,
      prevision: previsionId,
      profesional: String(slot.professionalId),
      resource: String(slot.professionalId),
      especialidad: Number(slot.specialtyId),
      tipo: Number(slot.tipoCitaId),
      ubicacion: branch,
      fecha: slot.dataDia,
      hora: slot.time,
      duracion: Number(slot.duration || 20),
      estado: 1,
      tipoagenda: "1",
      es_recurso: "0",
      tienerut: true,
      cargar: true,
      enviar_correo: false,
      enable_sms_notifications: true,
      enable_wsp_notifications: true,
    };

    console.log("[melania] bookPayload:", JSON.stringify({ run: rut, nombre: bookPayload.nombre, apellidos: bookPayload.apellidos, aseguradora: aseguradoraId, prevision: previsionId, comuna: bookPayload.comuna, profesional: bookPayload.profesional, fecha: bookPayload.fecha, hora: bookPayload.hora }));

    // 4. Book via session cookie
    const result = await melaniaBookWithSession(bookPayload);

    const isSuccess = result.status === 200 && (result.data?.status === true || result.data?.status === "agendado_correctamente" || result.data?.message === "agendado correctamente");

    console.log(`[melania] book result: ${isSuccess ? "SUCCESS" : "FAILED"} id=${result.data?.id || "n/a"} status=${result.status} data=${JSON.stringify(result.data).slice(0, 200)}`);

    return res.json({
      success: isSuccess,
      source: "melania",
      step: "book",
      appointmentId: result.data?.id || null,
      slot: { date: slot.dataDia, time: slot.time, professional: slot.professional, specialty: slot.specialty },
      patient: { rut, nombres: patientData.nombres, apellidos: bookPayload.apellidos },
      medinet: result.data,
      patient_reply: isSuccess
        ? `Tu hora quedo agendada para el ${slot.date || slot.dataDia} a las ${slot.time} con ${slot.professional}.`
        : `No fue posible agendar. Puedes intentar en https://clinyco.medinetapp.com/agendaweb/planned/`,
    });
  } catch (error) {
    console.error("[melania] book error:", error.message);
    return res.status(500).json({
      success: false,
      source: "melania",
      error: error.message,
    });
  }
});

/**
 * MelanIA: Search slots only (no booking).
 * POST /melania/search
 * { query, branchId? }
 */
app.post("/melania/search", authMiddleware, async (req, res) => {
  const { query, branchId } = req.body || {};
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    const branch = Number(branchId || DEFAULT_BRANCH_ID);
    const search = await searchSlotsViaApi({ query, branchId: branch });
    return res.json({ success: true, source: "melania", ...search });
  } catch (error) {
    console.error("[melania] search error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * MelanIA: Get all available professionals with next slots.
 * POST /melania/availability { branchId? }
 */
app.post("/melania/availability", authMiddleware, async (req, res) => {
  try {
    const branch = Number(req.body?.branchId || req.query.branchId || DEFAULT_BRANCH_ID);
    const [professionals, specialties] = await Promise.all([
      fetchProximosCuposAll(branch),
      fetchSpecialtiesByBranchNoAuth(branch),
    ]);

    // Simplify specialties to id+nombre
    const specMap = (specialties || []).map(s => ({ id: s.id, nombre: s.nombre, es_activa: s.es_activa }));

    return res.json({
      success: true,
      source: "melania",
      branchId: branch,
      professionals: professionals || [],
      specialties: specMap,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[melania] availability error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Medinet worker listening on port ${PORT}`);
  console.log(`Script: ${SCRIPT}`);
  if (MELANIA_USERNAME) {
    console.log(`MelanIA: enabled (user: ${MELANIA_USERNAME})`);
  } else {
    console.log(`MelanIA: disabled (no MELANIA_USERNAME configured)`);
  }
});
