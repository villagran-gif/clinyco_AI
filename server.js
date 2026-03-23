import express from "express";
import OpenAI from "openai";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, readFileSync, writeFileSync, constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { initLogger, wrapOpenAI } from "braintrust";
import { resolveIdentityAndContext, getNextBestQuestion, applyResolverToState } from "./conversation-resolver.js";
import {
  dbEnabled,
  initDb,
  getConversationRecord,
  getRecentConversationMessages,
  upsertConversationState,
  insertConversationMessage,
  upsertStructuredLead,
  buildCustomerProfile,
  upsertCustomer,
  linkConversationToCustomer,
  addCustomerChannel,
  getCustomerSummaries
} from "./db.js";
import { buildKnowledgePromptContext } from "./knowledge/prompt-context.js";
import { resolveCustomerFromIdentifiers } from "./memory/customer-lookup.js";
import {
  enrichStateFromCustomer,
  buildCustomerContextBlock,
  saveConversationToCustomer
} from "./memory/customer-memory.js";
import {
  extractRut as extractValidatedRut,
  formatRutHuman as formatValidatedRutHuman
} from "./extraction/identity-normalizers.js";
import {
  fetchActiveProfessionals, fetchProfessionalsFull, getProfessionalDetails,
  fetchProfessionalsBySpecialtyAndBranch,
  fetchAvailableSlots, fetchNextSlotsChatbot, checkProfessionalAvailable,
  bookChatbot, bookOverschedule, bookAppointmentForPatient,
  fetchAllAppointments, fetchAppointmentDetail, updateAppointmentState,
  fetchSpecialties, fetchAppointmentTypes, fetchAppointmentTypesByContext,
  fetchBranches, fetchPrevisiones,
  checkPatientByRut, fetchPatientById, searchPatients,
  buildProfessionalsCache, findProfessional, searchAvailableSlots,
  findSpecialtyId,
} from "./Antonia/medinet-api.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  if (req.path.startsWith("/debug")) {
    res.header("Access-Control-Allow-Origin", DEBUG_DASHBOARD_ORIGIN);
    res.header("Access-Control-Allow-Headers", "Content-Type, x-debug-key");
    res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
  }
  next();
});


// =========================
// Conversation cache (memory + Postgres persistence)
// =========================
const conversationHistory = new Map();
const conversationStates = new Map();
const hydratedConversations = new Set();
const recentInboundMessageClaims = new Map();

// =========================
// Config
// =========================
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY || null;
const BRAINTRUST_PROJECT_NAME = process.env.BRAINTRUST_PROJECT_NAME || "Clinyco AI - Dev";
const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const SUNCO_APP_ID = process.env.SUNCO_APP_ID;
const SUNCO_KEY_ID = process.env.SUNCO_KEY_ID;
const SUNCO_KEY_SECRET = process.env.SUNCO_KEY_SECRET;

const BOX_AI_BASE_URL = (process.env.BOX_AI_BASE_URL || "https://box-ai-clinyco.onrender.com").replace(/\/$/, "");
const ENABLE_SELL_SEARCH = String(process.env.ENABLE_SELL_SEARCH || "true").toLowerCase() === "true";
const ENABLE_SUPPORT_SEARCH = String(process.env.ENABLE_SUPPORT_SEARCH || "false").toLowerCase() === "true";
const ZENDESK_SUPPORT_EMAIL = process.env.ZENDESK_SUPPORT_EMAIL || process.env.ZENDESK_API_EMAIL || null;
const ZENDESK_SUPPORT_TOKEN = process.env.ZENDESK_SUPPORT_TOKEN || process.env.ZENDESK_API_TOKEN || null;

const MAX_HISTORY_MESSAGES = 14;
const MAX_BOT_MESSAGES = 10;
const INBOUND_DEDUPE_TTL_MS = 2 * 60 * 1000;
const OUTBOUND_DEDUPE_WINDOW_MS = 45 * 1000;
const MEDINET_AGENDA_WEB_URL = "https://clinyco.medinetapp.com/agendaweb/planned/";
const MEDINET_RUT = process.env.MEDINET_RUT || "13580388k";
const MEDINET_API_TOKEN = process.env.MEDINET_API_TOKEN || "";
const MEDINET_BRANCH_ID = Number(process.env.MEDINET_BRANCH_ID || 39);
const MEDINET_USE_API = MEDINET_API_TOKEN.length > 0;
function firstExistingPath(paths) {
  for (const p of paths) {
    try { accessSync(p, fsConstants.R_OK); return p; } catch { /* skip */ }
  }
  return null;
}

function resolveMedinetAntoniaScript() {
  if (process.env.MEDINET_ANTONIA_SCRIPT) return process.env.MEDINET_ANTONIA_SCRIPT;
  const base = fileURLToPath(new URL("./Antonia/", import.meta.url));
  return firstExistingPath([base + "medinet-antonia.cjs", base + "medinet-antonia.js"]) || base + "medinet-antonia.cjs";
}

const MEDINET_ANTONIA_SCRIPT = resolveMedinetAntoniaScript();
const execFileAsync = promisify(execFile);

async function callRemoteMedinetWorker(action, payload, timeoutMs) {
  const url = `${process.env.MEDINET_REMOTE_URL}/medinet/run`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MEDINET_REMOTE_TOKEN}`,
      },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Worker responded ${res.status}: ${body.slice(0, 500)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const MEDINET_CACHE_FILE = fileURLToPath(new URL("./data/medinet_professionals_cache.json", import.meta.url));
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function readMedinetCache() {
  try {
    const raw = readFileSync(MEDINET_CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isCacheStale() {
  const cache = readMedinetCache();
  if (!cache || !cache.cachedAt) return true;
  return Date.now() - new Date(cache.cachedAt).getTime() > CACHE_TTL_MS;
}

function matchProfessionalFromCache(text) {
  const cache = readMedinetCache();
  if (!cache || !Array.isArray(cache.professionals) || !cache.professionals.length) return null;

  const requested = normalizeKey(text);
  if (!requested) return null;

  let bestMatch = null;
  let bestPriority = 99;

  for (const prof of cache.professionals) {
    const normalizedName = normalizeKey(prof.name || "");
    const normalizedSpecialty = normalizeKey(prof.specialty || "");
    const nameTokens = normalizedName.split(/\s+/).filter(Boolean);

    let priority = 99;
    if (normalizedName === requested) priority = 1;
    else if (normalizedName.startsWith(requested)) priority = 3;
    else if (normalizedName.includes(requested)) priority = 4;
    else if (normalizedSpecialty === requested) priority = 5;
    else if (normalizedSpecialty.includes(requested)) priority = 7;
    else if (nameTokens.some((t) => t === requested)) priority = 8;
    else if (nameTokens.some((t) => t.startsWith(requested) || requested.startsWith(t))) priority = 9;
    else {
      // multi-token match: check if all tokens in request appear in name
      const requestedTokens = requested.split(/\s+/).filter(Boolean);
      if (requestedTokens.length >= 2 && requestedTokens.every((rt) => nameTokens.some((nt) => nt.includes(rt) || rt.includes(nt)))) {
        priority = 2;
      }
    }

    if (priority < bestPriority) {
      bestPriority = priority;
      bestMatch = prof;
    }
  }

  return bestPriority < 99 ? bestMatch : null;
}

async function runMedinetAntoniaCache() {
  // --- API path (fast, ~1s) ---
  if (MEDINET_USE_API) {
    try {
      const professionals = await buildProfessionalsCache();
      if (professionals.length) {
        const { mkdirSync, existsSync } = await import("node:fs");
        const cacheDir = fileURLToPath(new URL("./data/", import.meta.url));
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
        const payload = { cachedAt: new Date().toISOString(), branch: process.env.MEDINET_BRANCH_NAME || "API", professionals };
        writeFileSync(MEDINET_CACHE_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
        console.log(`MEDINET CACHE REFRESH (API) completed: ${professionals.length} professionals`);
        return true;
      }
    } catch (error) {
      console.error("MEDINET CACHE REFRESH (API) ERROR:", error.message, "— falling back");
    }
  }

  const timeoutMs = Number(process.env.MEDINET_ANTONIA_TIMEOUT_MS || 60000);
  if (process.env.MEDINET_REMOTE_URL) {
    try {
      const result = await callRemoteMedinetWorker("cache", {}, timeoutMs);
      if (result && Array.isArray(result.professionals)) {
        const cachePayload = { cachedAt: result.cachedAt || new Date().toISOString(), branch: result.branch || "", professionals: result.professionals };
        writeFileSync(MEDINET_CACHE_FILE, JSON.stringify(cachePayload, null, 2) + "\n", "utf8");
        console.log(`MEDINET CACHE REFRESH completed (remote): ${result.professionals.length} professionals`);
      } else {
        console.log("MEDINET CACHE REFRESH completed (remote, no professionals returned)");
      }
      return true;
    } catch (error) {
      console.error("MEDINET CACHE REFRESH ERROR (remote):", error.message);
      return false;
    }
  }
  try {
    const { stdout } = await execFileAsync("node", [MEDINET_ANTONIA_SCRIPT], {
      env: {
        ...process.env,
        MEDINET_MODE: "cache",
        MEDINET_RUT,
        MEDINET_HEADED: "false"
      },
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    });
    console.log("MEDINET CACHE REFRESH completed");
    return true;
  } catch (error) {
    console.error("MEDINET CACHE REFRESH ERROR:", error.message);
    return false;
  }
}

const MEDINET_DISCARD_TOKENS = new Set([
  "HOLA", "BUENAS", "TARDES", "DIAS", "NOCHES", "QUIERO", "NECESITO", "ME", "GUSTARIA",
  "AGENDAR", "AGENDA", "HORA", "HORAS", "CITA", "CONTROL", "CON", "PARA", "UNA", "UN",
  "POR", "FAVOR", "DOCTOR", "DOCTORA", "DR", "DRA", "EL", "LA", "LOS", "LAS", "DE",
  "QUE", "EN", "AL", "DEL", "BUENOS", "QUISIERA", "PODRIA", "PUEDE", "PUEDES", "PUEDO",
  "TENGO", "TENER", "TIENES", "TIENE", "HAY",
  "DISPONIBLE", "DISPONIBLES", "DISPONIBILIDAD",
  "RESERVAR", "SOLICITAR", "PEDIR", "TU", "SI", "NO", "HOY", "MANANA",
  // títulos profesionales que contaminan la búsqueda
  "PSICOLOGA", "PSICOLOGO", "NUTRICIONISTA", "NUTRIOLOGA", "NUTRIOLOGO",
  "KINESIOLOGOA", "KINESIOLOGA", "KINESIOLOGO", "PEDIATRA", "CIRUJANO", "CIRUJANA",
  "ENDOCRINOLOGO", "ENDOCRINOLOGA", "DERMATOLOGO", "DERMATOLOGA",
  "GINECOLOGO", "GINECOLOGA", "TRAUMATOLOGO", "TRAUMATOLOGA",
  "OFTALMOLOGO", "OFTALMOLOGA", "PSIQUIATRA", "INTERNISTA",
  "ENFERMERA", "ENFERMERO", "MATRONA", "MATRON"
]);

function sanitizeMedinetProfessionalCandidate(rawValue) {
  const tokens = normalizeKey(rawValue).split(/\s+/).filter((t) => !MEDINET_DISCARD_TOKENS.has(t));
  return tokens.slice(0, 3).join(" ").toLowerCase().trim() || null;
}

const SPECIALTY_KEYWORDS = {
  NUTRICION: "nutricion", NUTRICIONISTA: "nutricion", NUTRIOLOGIA: "nutriologia", NUTRIOLOGA: "nutriologia", NUTRIOLOGO: "nutriologia",
  PSICOLOGIA: "psicologia", PSICOLOGO: "psicologia", PSICOLOGA: "psicologia",
  PSIQUIATRIA: "psiquiatria", PSIQUIATRA: "psiquiatria",
  CIRUGIA: "cirugia", CIRUJANO: "cirugia", CIRUJANA: "cirugia",
  BARIATRICA: "cirugia bariatrica", BARIATRICO: "cirugia bariatrica",
  ENDOCRINOLOGIA: "endocrinologia", ENDOCRINOLOGO: "endocrinologia", ENDOCRINOLOGA: "endocrinologia",
  GASTROENTEROLOGO: "gastroenterologia", GASTROENTEROLOGA: "gastroenterologia", GASTROENTEROLOGIA: "gastroenterologia",
  PLASTICA: "cirugia plastica", PLASTICO: "cirugia plastica"
};

function extractCanonicalSpecialtyQuery(text) {
  const tokens = normalizeKey(text).split(/\s+/);
  for (const t of tokens) {
    if (SPECIALTY_KEYWORDS[t]) return SPECIALTY_KEYWORDS[t];
  }
  return null;
}

const FIRST_NAME_ALIASES = {
  // Cirugía Digestiva
  VILLAGRAN: "rodrigo villagran", VILLAGRA: "rodrigo villagran",
  AROS: "nelson aros",
  SIRABO: "alberto sirabo",
  // Cirugía Plástica
  ZIEDE: "edmundo ziede",
  ROSIRYS: "rosirys ruiz",
  // Nutrición
  MAGALY: "magaly cerquera", CERQUERA: "magaly cerquera",
  KATHERINE: "katherine saavedra", SAAVEDRA: "katherine saavedra",
  // Psicología
  PEGGY: "peggy huerta", HUERTA: "peggy huerta",
  FRANCISCA: "francisca naritelli", NARITELLI: "francisca naritelli",
  // Nutriología
  INGRID: "ingrid yevenes", YEVENES: "ingrid yevenes",
  FERNANDO: "fernando moya", MOYA: "fernando moya",
  // Medicina Deportiva
  PABLO: "pablo ramos", RAMOS: "pablo ramos",
  // Medicina General
  CARLOS: "carlos nunez", NUNEZ: "carlos nunez",
  // Pediatría
  DANIZA: "daniza jaldin", JALDIN: "daniza jaldin",
  // Endocrinología Infantil
  BANCALARI: "rodrigo bancalari",
  // Otros
  BENCINA: "francisco bencina",
};

function extractKnownProfessionalAlias(text) {
  const nk = normalizeKey(text);
  for (const prof of KNOWN_AGENDA_PROFESSIONALS) {
    if (nk.includes(prof)) return prof.toLowerCase();
  }
  const tokens = nk.split(/\s+/);
  for (const t of tokens) {
    if (FIRST_NAME_ALIASES[t]) return FIRST_NAME_ALIASES[t];
  }
  return null;
}

function extractMedinetQuery(text = "") {
  const alias = extractKnownProfessionalAlias(text);
  if (alias) return alias;

  const specialty = extractCanonicalSpecialtyQuery(text);
  if (specialty) return specialty;

  const { professionalName } = extractProfessionalReference(text);
  if (professionalName) return sanitizeMedinetProfessionalCandidate(professionalName) || professionalName.toLowerCase();

  const cleaned = sanitizeMedinetProfessionalCandidate(text);
  return cleaned || String(text || "").replace(/[¿?.,!;:()]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ").trim();
}

async function runMedinetAntonia({ query, patientPhone, patientMessage, patientRut }) {
  const timeoutMs = Number(process.env.MEDINET_ANTONIA_TIMEOUT_MS || 45000);
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return null;
  const rut = String(patientRut || process.env.MEDINET_RUT || "").trim();

  // --- API path (preferred, fast ~2-5s) ---
  if (MEDINET_USE_API) {
    try {
      const prof = await findProfessional(safeQuery);
      if (!prof) {
        console.log("MEDINET API: no professional match for", safeQuery);
      } else {
        const profId = prof.id;
        const profName = prof.display || `${prof.nombres || ""} ${prof.paterno || ""}`.trim();
        const detail = await getProfessionalDetails(profId);
        const suc_esps = detail?.sucursal_especialidades || [];
        const tipos_cita = detail?.tipos_cita || [];
        const branchMatch = suc_esps.find((se) => se.ubicacion?.id === MEDINET_BRANCH_ID) || suc_esps[0];
        const ubicacionId = branchMatch?.ubicacion?.id || MEDINET_BRANCH_ID;
        const especialidadId = branchMatch?.especialidad?.id || "";
        const specialty = branchMatch?.especialidad?.nombre || "";
        const tipoCitaMatch = tipos_cita.find((tc) => (tc.sucursales || []).includes(MEDINET_BRANCH_ID)) || tipos_cita[0];
        const tipocitaId = tipoCitaMatch?.id || "";
        const duration = tipoCitaMatch?.duracion || 30;
        let slots = [];
        if (ubicacionId && especialidadId && tipocitaId) {
          slots = await searchAvailableSlots({ professionalId: profId, ubicacionId, especialidadId, tipocitaId, daysAhead: 14 });
        }
        for (const slot of slots) {
          slot.professional = slot.professional || profName;
          slot.professionalId = slot.professionalId || String(profId);
          slot.specialty = slot.specialty || specialty;
          slot.duration = slot.duration || duration;
        }
        const patientReply = buildPatientReplyFromSlots(profName, specialty, slots);
        console.log("MEDINET API MATCH:", JSON.stringify({ id: profId, professional: profName, specialty, slotsFound: slots.length }));
        return { source: "antonia_api_medinet", specialty, professional: profName, first_available: null, available_slots: slots, patient_reply: patientReply, patient_phone: patientPhone };
      }
    } catch (error) {
      console.error("MEDINET API SEARCH ERROR:", error.message, "— falling back");
    }
  }

  if (process.env.MEDINET_REMOTE_URL) {
    try {
      const result = await callRemoteMedinetWorker("search", { query: safeQuery, patientPhone, patientMessage, patientRut: rut }, timeoutMs);
      return result.error ? null : result;
    } catch (error) {
      console.error("MEDINET SEARCH ERROR (remote):", error.message);
      return null;
    }
  }

  const { stdout } = await execFileAsync("node", [MEDINET_ANTONIA_SCRIPT], {
    env: {
      ...process.env,
      MEDINET_RUT: rut,
      MEDINET_QUERY: safeQuery,
      MEDINET_PATIENT_PHONE: String(patientPhone || ""),
      MEDINET_PATIENT_MESSAGE: String(patientMessage || ""),
      MEDINET_HEADED: "false"
    },
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024
  });

  const match = stdout.match(/ANTONIA_RESPONSE\s+(\{[\s\S]*\})/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch (parseError) {
    console.error("ANTONIA JSON PARSE ERROR:", parseError.message, "raw:", match[1].slice(0, 200));
    return null;
  }
}

async function runMedinetAntoniaBooking({ slot, patientData }) {
  const timeoutMs = Number(process.env.MEDINET_ANTONIA_TIMEOUT_MS || 120000);
  if (!slot || !slot.professionalId || !slot.dataDia || !slot.time) return null;

  // --- API path (fast, ~1-2s) ---
  if (MEDINET_USE_API) {
    try {
      console.log("MEDINET BOOKING (API): attempting...", JSON.stringify({ profId: slot.professionalId, date: slot.dataDia, time: slot.time }));
      const result = await bookAppointmentForPatient({ slot, patientData, branchId: MEDINET_BRANCH_ID, scheduleTypeId: 1 });
      console.log("MEDINET BOOKING (API) result:", JSON.stringify({ success: result.success, message: result.message }));
      if (result.success) return result;
      console.warn("MEDINET BOOKING (API) failed — falling back");
    } catch (error) {
      console.error("MEDINET BOOKING (API) ERROR:", error.message, "— falling back");
    }
  }

  if (process.env.MEDINET_REMOTE_URL) {
    try {
      const result = await callRemoteMedinetWorker("book", { slot, patientData }, timeoutMs);
      return result.error ? null : result;
    } catch (error) {
      console.error("MEDINET BOOKING ERROR (remote):", error.message);
      return null;
    }
  }

  const { stdout } = await execFileAsync("node", [MEDINET_ANTONIA_SCRIPT], {
    env: {
      ...process.env,
      MEDINET_MODE: "book",
      MEDINET_RUT,
      MEDINET_PROFESSIONAL_ID: String(slot.professionalId || ""),
      MEDINET_SLOT_DATE: String(slot.dataDia || ""),
      MEDINET_SLOT_TIME: String(slot.time || ""),
      MEDINET_PATIENT_RUT: String(patientData.rut || ""),
      MEDINET_PATIENT_NOMBRES: String(patientData.nombres || ""),
      MEDINET_PATIENT_AP_PATERNO: String(patientData.apPaterno || ""),
      MEDINET_PATIENT_AP_MATERNO: String(patientData.apMaterno || ""),
      MEDINET_PATIENT_PREVISION: String(patientData.prevision || ""),
      MEDINET_PATIENT_NACIMIENTO: String(patientData.nacimiento || ""),
      MEDINET_PATIENT_EMAIL: String(patientData.email || ""),
      MEDINET_PATIENT_FONO: String(patientData.fono || ""),
      MEDINET_PATIENT_DIRECCION: String(patientData.direccion || ""),
      MEDINET_HEADED: "false"
    },
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024
  });

  const match = stdout.match(/ANTONIA_RESPONSE\s+(\{[\s\S]*\})/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch (parseError) {
    console.error("ANTONIA BOOKING JSON PARSE ERROR:", parseError.message);
    return null;
  }
}

function detectBookingSlotChoice(text, availableSlots) {
  if (!availableSlots || !availableSlots.length) return null;
  const cleaned = String(text || "").trim();

  // Match patterns: "1", "la 1", "opcion 1", "hora 1", "numero 1", "quiero la 1", etc.
  const numberMatch = cleaned.match(/(?:^|\s)(\d)(?:\s|$|[.,;!?])/);
  const directMatch = cleaned.match(/^(\d)$/);
  const phraseMatch = cleaned.match(/(?:la|opcion|hora|numero|n[uú]mero|quiero|elijo|prefiero)\s*(\d)/i);

  const choiceStr = directMatch?.[1] || phraseMatch?.[1] || numberMatch?.[1];
  if (!choiceStr) return null;

  const index = parseInt(choiceStr, 10) - 1;
  if (index < 0 || index >= availableSlots.length) return null;

  return { index, slot: availableSlots[index] };
}

function buildPatientReplyFromSlots(professional, specialty, slots) {
  if (!slots.length) {
    return [
      `No encontré disponibilidad visible con ${professional || "la búsqueda solicitada"}${specialty ? ` en ${specialty}` : ""}.`,
      "Te comparto la dirección para que puedas revisar directamente:",
      `URL: ${MEDINET_AGENDA_WEB_URL}`,
      "Gracias",
    ].join(" ");
  }
  return [
    `Tengo estas horas disponibles con ${professional}${specialty ? ` en ${specialty}` : ""}:`,
    ...slots.map((slot, i) => `${i + 1}- ${slot.date} a las ${slot.time}`),
    "",
    "Si deseas agendar, indícame el número de la hora que prefieres y te ayudo a reservar.",
  ].join("\n");
}

function splitApellidos(apellidos) {
  if (!apellidos) return { paterno: "", materno: "" };
  const parts = String(apellidos).trim().split(/\s+/);
  if (parts.length >= 2) {
    return { paterno: parts[0], materno: parts.slice(1).join(" ") };
  }
  return { paterno: parts[0] || "", materno: "" };
}

function buildPatientDataFromState(state) {
  const cd = state?.contactDraft || {};
  const { paterno, materno } = splitApellidos(cd.c_apellidos);
  return {
    rut: cd.c_rut || "",
    nombres: cd.c_nombres || "",
    apPaterno: paterno,
    apMaterno: materno,
    prevision: cd.c_aseguradora || "",
    nacimiento: cd.c_fecha || "",
    email: cd.c_email || "",
    fono: cd.c_tel1 || "",
    direccion: cd.c_direccion || ""
  };
}

function getMissingBookingFields(patientData) {
  const required = [
    { key: "rut", label: "RUT" },
    { key: "nombres", label: "nombre completo" },
    { key: "apPaterno", label: "apellido paterno" },
    { key: "prevision", label: "previsión/aseguradora" },
    { key: "nacimiento", label: "fecha de nacimiento" },
    { key: "email", label: "correo electrónico" },
    { key: "fono", label: "teléfono" },
    { key: "direccion", label: "dirección" }
  ];
  return required.filter((f) => !patientData[f.key]);
}

const DEBUG_DASHBOARD_KEY = process.env.DEBUG_DASHBOARD_KEY || null;
const DEBUG_DASHBOARD_ORIGIN = process.env.DEBUG_DASHBOARD_ORIGIN || "*";
const DEBUG_EVENTS_MEMORY_LIMIT = Number(process.env.DEBUG_EVENTS_MEMORY_LIMIT || 500);
const KNOWLEDGE_SYNC_KEY = String(process.env.KNOWLEDGE_SYNC_KEY || process.env.DEBUG_DASHBOARD_KEY || "").trim() || null;
const KNOWLEDGE_SYNC_TIMEOUT_MS = Number(process.env.KNOWLEDGE_SYNC_TIMEOUT_MS || 180000);
const KNOWLEDGE_SYNC_SCRIPT = fileURLToPath(new URL("./scripts/sync-knowledge-from-sheets.js", import.meta.url));
const DEBUG_DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.RENDER_DATABASE_URL ||
  process.env.RENDER_EXTERNAL_DATABASE_URL ||
  null;

const debugEventsMemory = [];
let debugPool = null;
let knowledgeSyncInProgress = false;

const btLogger = BRAINTRUST_API_KEY
  ? initLogger({
      projectName: BRAINTRUST_PROJECT_NAME,
      apiKey: BRAINTRUST_API_KEY
    })
  : null;

const baseOpenAI = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY
    })
  : null;

const openai = baseOpenAI && BRAINTRUST_API_KEY
  ? wrapOpenAI(baseOpenAI)
  : baseOpenAI;


const ASEGURADORA_OPTIONS = [
  "SIN ASEGURADORA ASOCIADA",
  "BANMEDICA",
  "COLMENA",
  "CONSALUD",
  "CRUZ BLANCA",
  "CRUZ DEL NORTE",
  "DIPRECA",
  "ESENCIAL",
  "FONASA",
  "FUNDACION",
  "I SALUD - EX CHUQUICAMATA",
  "JEAFOSALE",
  "MEDIMEL-BANMEDICA",
  "NUEVA MAS VIDA",
  "OTRA DE FUERZAS ARMADAS",
  "PAD Fonasa PAD",
  "PARTICULAR",
  "VIDA TRES"
];

const MODALIDAD_OPTIONS = [
  "Banmédica",
  "Colmena",
  "Consalud",
  "Cruz Blanca",
  "Cruz Norte",
  "DIPRECA",
  "Fonasa",
  "Fuerza Armadas",
  "Fundación",
  "I. Chuquicamata",
  "MEDIMEL-CB",
  "Más Vida",
  "Particular",
  "Tramo A",
  "Tramo B",
  "Tramo C",
  "Tramo D",
  "Vida Tres"
];

const ASEGURADORA_ALIASES = {
  "BANMEDICA": "BANMEDICA",
  "BANMEDICA ISAPRE": "BANMEDICA",
  "BANMEDICA ": "BANMEDICA",
  "COLMENA": "COLMENA",
  "CONSALUD": "CONSALUD",
  "CRUZ BLANCA": "CRUZ BLANCA",
  "CRUZBLANCA": "CRUZ BLANCA",
  "CRUZ DEL NORTE": "CRUZ DEL NORTE",
  "CRUZ NORTE": "CRUZ DEL NORTE",
  "DIPRECA": "DIPRECA",
  "ESENCIAL": "ESENCIAL",
  "FONASA": "FONASA",
  "FUNDACION": "FUNDACION",
  "FUNDACIÓN": "FUNDACION",
  "I SALUD": "I SALUD - EX CHUQUICAMATA",
  "I. CHUQUICAMATA": "I SALUD - EX CHUQUICAMATA",
  "ISALUD": "I SALUD - EX CHUQUICAMATA",
  "CHUQUICAMATA": "I SALUD - EX CHUQUICAMATA",
  "JEAFOSALE": "JEAFOSALE",
  "MEDIMEL": "MEDIMEL-BANMEDICA",
  "MEDIMEL BANMEDICA": "MEDIMEL-BANMEDICA",
  "NUEVA MAS VIDA": "NUEVA MAS VIDA",
  "MAS VIDA": "NUEVA MAS VIDA",
  "MASVIDA": "NUEVA MAS VIDA",
  "VIDA TRES": "VIDA TRES",
  "VIDATRES": "VIDA TRES",
  "PARTICULAR": "PARTICULAR",
  "SIN ASEGURADORA": "SIN ASEGURADORA ASOCIADA",
  "FUERZAS ARMADAS": "OTRA DE FUERZAS ARMADAS",
  "FUERZA ARMADAS": "OTRA DE FUERZAS ARMADAS",
  "PAD": "PAD Fonasa PAD",
  "PAD FONASA": "PAD Fonasa PAD",
  "PAD FONASA PAD": "PAD Fonasa PAD"
};

const MODALIDAD_FROM_ASEGURADORA = {
  "BANMEDICA": "Banmédica",
  "COLMENA": "Colmena",
  "CONSALUD": "Consalud",
  "CRUZ BLANCA": "Cruz Blanca",
  "CRUZ DEL NORTE": "Cruz Norte",
  "DIPRECA": "DIPRECA",
  "FONASA": "Fonasa",
  "FUNDACION": "Fundación",
  "I SALUD - EX CHUQUICAMATA": "I. Chuquicamata",
  "MEDIMEL-BANMEDICA": "MEDIMEL-CB",
  "NUEVA MAS VIDA": "Más Vida",
  "OTRA DE FUERZAS ARMADAS": "Fuerza Armadas",
  "PARTICULAR": "Particular",
  "VIDA TRES": "Vida Tres"
};

const KNOWN_AGENDA_PROFESSIONALS_FALLBACK = [
  "RODRIGO VILLAGRAN", "NELSON AROS", "ALBERTO SIRABO",
  "EDMUNDO ZIEDE", "ROSIRYS RUIZ",
  "MAGALY CERQUERA", "KATHERINE SAAVEDRA",
  "PEGGY HUERTA", "FRANCISCA NARITELLI",
  "KATHERINNE ARAYA", "INGRID YEVENES", "FERNANDO MOYA", "SOFIA ARAYA",
  "PABLO RAMOS", "CARLOS NUNEZ", "DANIZA JALDIN", "RODRIGO BANCALARI",
  "FRANCISCO BENCINA",
];

function buildKnownAgendaProfessionals() {
  const cache = readMedinetCache();
  const names = new Set(KNOWN_AGENDA_PROFESSIONALS_FALLBACK);
  if (cache && Array.isArray(cache.professionals)) {
    for (const prof of cache.professionals) {
      if (prof.name) names.add(normalizeKey(prof.name));
    }
  }
  return names;
}

let KNOWN_AGENDA_PROFESSIONALS = buildKnownAgendaProfessionals();

const SORTED_ASEGURADORA_ALIASES = Object.entries(ASEGURADORA_ALIASES).sort((a, b) => b[0].length - a[0].length);

const KNOWN_COMUNAS = [
  "ANTOFAGASTA", "CALAMA", "SANTIAGO", "ARICA", "IQUIQUE", "VIÑA DEL MAR", "VALPARAISO", "VALPARAÍSO",
  "CONCEPCION", "CONCEPCIÓN", "LA SERENA", "COPIAPO", "COPIAPÓ", "PUNTA ARENAS", "TEMUCO", "OSORNO",
  "PUERTO MONTT", "RANCAGUA", "TALCA", "CHILLAN", "CHILLÁN", "TOCOPILLA", "MEJILLONES", "ALTO HOSPICIO",
  "QUILPUE", "QUILPUÉ", "MAIPU", "MAIPÚ", "LAS CONDES", "LA FLORIDA", "PROVIDENCIA", "RECOLETA", "PUENTE ALTO"
];

// =========================
// Helpers
// =========================
function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}


function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}

function toDbJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

function getDebugPool() {
  if (!DEBUG_DATABASE_URL) return null;
  if (!debugPool) {
    const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
    const useSsl =
      sslMode === "require" ||
      /sslmode=require/i.test(DEBUG_DATABASE_URL) ||
      /render\.com/i.test(DEBUG_DATABASE_URL);

    debugPool = new Pool({
      connectionString: DEBUG_DATABASE_URL,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {})
    });
  }
  return debugPool;
}

async function debugQuery(text, params = []) {
  const pool = getDebugPool();
  if (!pool) return null;
  return pool.query(text, params);
}

function requireDebugKey(req, res, next) {
  const provided = String(req.headers["x-debug-key"] || req.query.key || "").trim();

  if (!DEBUG_DASHBOARD_KEY) {
    return res.status(503).json({ ok: false, error: "debug_key_not_configured" });
  }

  if (!provided || provided !== DEBUG_DASHBOARD_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  next();
}

function requireKnowledgeSyncKey(req, res, next) {
  const provided = String(req.headers["x-sync-key"] || req.query.key || "").trim();

  if (!KNOWLEDGE_SYNC_KEY) {
    return res.status(503).json({ ok: false, error: "knowledge_sync_key_not_configured" });
  }

  if (!provided || provided !== KNOWLEDGE_SYNC_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  next();
}

function tailLines(text, limit = 20) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-Math.max(1, Number(limit) || 1));
}

async function runKnowledgeSyncNow() {
  const startedAt = Date.now();
  const result = await execFileAsync("node", [KNOWLEDGE_SYNC_SCRIPT], {
    env: { ...process.env },
    timeout: KNOWLEDGE_SYNC_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024
  });

  return {
    durationMs: Date.now() - startedAt,
    stdout: String(result?.stdout || ""),
    stderr: String(result?.stderr || "")
  };
}

function buildDebugUserName(state, info) {
  const fullName = [state?.contactDraft?.c_nombres, state?.contactDraft?.c_apellidos]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    fullName ||
    info?.authorDisplayName ||
    info?.channelDisplayName ||
    info?.sourceProfileName ||
    null
  );
}

function inferDebugStage(state, resolverDecision = null) {
  if (!state) return "unknown";

  if (state?.system?.handoffReason) {
    return `handoff:${state.system.handoffReason}`;
  }

  if (state?.measurements?.pendingConfirmation) {
    return "measurement_confirmation";
  }

  if (state?.contactDraft?.c_aseguradora === "FONASA" && !state?.contactDraft?.c_modalidad) {
    return "awaiting_fonasa_tramo";
  }

  if (state?.identity?.caseType === "E" || state?.identity?.likelyClinicalRecordOnly) {
    return "clinical_record_only";
  }

  const interes = normalizeKey(state?.dealDraft?.dealInteres || "");
  const needsMeasurements =
    (interes.includes("BARIATRICA") || interes.includes("BALON")) &&
    (!state?.measurements?.weightKg || !state?.measurements?.heightM);

  if (needsMeasurements) {
    return "awaiting_measurements";
  }

  if (resolverDecision?.nextAction) {
    return `resolver:${resolverDecision.nextAction}`;
  }

  if (state?.dealDraft?.dealInteres && state?.contactDraft?.c_tel1) {
    return "ready_for_handoff";
  }

  if (state?.dealDraft?.dealInteres) {
    return "procedure_detected";
  }

  if (state?.contactDraft?.c_aseguradora) {
    return "insurance_detected";
  }

  return "discovery";
}

function buildKnownDataForDebug(state) {
  return cloneJson({
    contactDraft: state?.contactDraft || null,
    dealDraft: state?.dealDraft || null,
    measurements: state?.measurements || null
  });
}

function rememberDebugEvent(event) {
  debugEventsMemory.unshift(event);
  if (debugEventsMemory.length > DEBUG_EVENTS_MEMORY_LIMIT) {
    debugEventsMemory.length = DEBUG_EVENTS_MEMORY_LIMIT;
  }
}

async function saveConversationEvent({
  conversationId,
  info,
  channelLabel,
  userText,
  botReply,
  state,
  resolverDecision = null
}) {
  const event = {
    created_at: new Date().toISOString(),
    conversation_id: conversationId,
    channel: channelLabel || info?.sourceType || info?.entryPoint || null,
    user_name: buildDebugUserName(state, info),
    stage: inferDebugStage(state, resolverDecision),
    next_action: resolverDecision?.nextAction || state?.identity?.nextAction || null,
    case_type: resolverDecision?.caseType || state?.identity?.caseType || null,
    reason: resolverDecision?.reason || state?.identity?.lastQuestionReason || null,
    missing_fields: cloneJson(resolverDecision?.missingFields || state?.identity?.lastMissingFields || []),
    known_data: buildKnownDataForDebug(state),
    support_summary: cloneJson(state?.identity?.supportRaw || state?.identity?.lastResolvedContext?.supportSummary || null),
    sell_summary: cloneJson(state?.identity?.sellRaw || state?.identity?.lastResolvedContext?.sellSummary || null),
    bmi: state?.measurements?.bmi || null,
    bot_messages_sent: state?.system?.botMessagesSent || 0,
    user_text: userText || null,
    bot_reply: botReply || null
  };
  const dbMissingFields = toDbJson(event.missing_fields);
  const dbKnownData = toDbJson(event.known_data);
  const dbSupportSummary = toDbJson(event.support_summary);
  const dbSellSummary = toDbJson(event.sell_summary);

  rememberDebugEvent(event);

  try {
    const result = await debugQuery(
      `
      INSERT INTO conversation_events (
        conversation_id,
        channel,
        user_name,
        user_text,
        bot_reply,
        stage,
        case_type,
        next_action,
        reason,
        missing_fields,
        known_data,
        support_summary,
        sell_summary,
        bmi,
        bot_messages_sent
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::json,$11::json,$12::json,$13::json,$14,$15
      )
      RETURNING id, created_at
      `,
      [
        event.conversation_id,
        event.channel,
        event.user_name,
        event.user_text,
        event.bot_reply,
        event.stage,
        event.case_type,
        event.next_action,
        event.reason,
        dbMissingFields,
        dbKnownData,
        dbSupportSummary,
        dbSellSummary,
        event.bmi,
        event.bot_messages_sent
      ]
    );

    if (result?.rows?.[0]) {
      event.id = result.rows[0].id;
      event.created_at = result.rows[0].created_at;
    }
  } catch (error) {
    console.error("DEBUG EVENT INSERT ERROR:", error.message);
  }

  return event;
}

async function getDebugEvents(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);

  try {
    const result = await debugQuery(
      `
      SELECT
        id,
        created_at,
        conversation_id,
        channel,
        user_name,
        user_text,
        bot_reply,
        stage,
        case_type,
        next_action,
        reason,
        missing_fields,
        known_data,
        support_summary,
        sell_summary,
        bmi,
        bot_messages_sent
      FROM conversation_events
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [safeLimit]
    );

    if (result?.rows) {
      return result.rows;
    }
  } catch (error) {
    console.error("DEBUG EVENTS QUERY ERROR:", error.message);
  }

  return debugEventsMemory.slice(0, safeLimit);
}

async function getDebugConversationEvents(conversationId) {
  try {
    const result = await debugQuery(
      `
      SELECT
        id,
        created_at,
        conversation_id,
        channel,
        user_name,
        user_text,
        bot_reply,
        stage,
        case_type,
        next_action,
        reason,
        missing_fields,
        known_data,
        support_summary,
        sell_summary,
        bmi,
        bot_messages_sent
      FROM conversation_events
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      `,
      [conversationId]
    );

    if (result?.rows) {
      return result.rows;
    }
  } catch (error) {
    console.error("DEBUG CONVERSATION QUERY ERROR:", error.message);
  }

  return debugEventsMemory
    .filter((event) => event.conversation_id === conversationId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value) {
  return removeDiacritics(String(value || ""))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleCaseWords(value) {
  return normalizeSpaces(value)
    .toLowerCase()
    .replace(/(^|\s)([a-záéíóúñ])/g, (m, p1, p2) => `${p1}${p2.toUpperCase()}`);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanupRecentMap(map, ttlMs) {
  const now = Date.now();
  for (const [key, timestamp] of map.entries()) {
    if (now - timestamp > ttlMs) {
      map.delete(key);
    }
  }
}

function fingerprintReplyText(value) {
  return normalizeKey(value).replace(/\s+/g, " ").trim();
}

function clearFonasaDerivedState(state) {
  if (/^TRAMO [ABCD]$/i.test(String(state.contactDraft.c_modalidad || ""))) {
    state.contactDraft.c_modalidad = null;
  }
  if (/PAD FONASA|TRAMO A/i.test(String(state.dealDraft.dealValidacionPad || ""))) {
    state.dealDraft.dealValidacionPad = null;
  }
}

function rememberOutboundReply(state, reply, reason) {
  state.system.lastOutboundFingerprint = fingerprintReplyText(reply);
  state.system.lastOutboundText = reply;
  state.system.lastOutboundReason = reason || null;
  state.system.lastOutboundAt = new Date().toISOString();
}

function shouldSuppressOutboundReply(state, reply, reason) {
  const fingerprint = fingerprintReplyText(reply);
  const lastFingerprint = state.system.lastOutboundFingerprint || null;
  const lastReason = state.system.lastOutboundReason || null;
  const lastAt = state.system.lastOutboundAt ? Date.parse(state.system.lastOutboundAt) : NaN;

  if (!fingerprint || !lastFingerprint || fingerprint !== lastFingerprint) {
    return false;
  }

  if (Number.isFinite(lastAt) && Date.now() - lastAt > OUTBOUND_DEDUPE_WINDOW_MS) {
    return false;
  }

  return !reason || !lastReason || reason === lastReason;
}

function isRecentOutboundEcho(state, userText) {
  const fingerprint = fingerprintReplyText(userText);
  const lastFingerprint = state?.system?.lastOutboundFingerprint || null;
  const lastAt = state?.system?.lastOutboundAt ? Date.parse(state.system.lastOutboundAt) : NaN;

  if (!fingerprint || !lastFingerprint || fingerprint !== lastFingerprint) {
    return false;
  }

  if (!Number.isFinite(lastAt)) {
    return false;
  }

  return Date.now() - lastAt <= OUTBOUND_DEDUPE_WINDOW_MS;
}

function markMaxMessagesReached(state) {
  state.system.aiEnabled = false;
  state.system.handoffReason = "max_bot_messages_reached";
}

function buildBlockedDecision(state, reason, nextAction = "blocked") {
  return {
    nextAction,
    caseType: state?.identity?.caseType || null,
    reason,
    missingFields: state?.identity?.lastMissingFields || []
  };
}

function buildResolverQuestionDecision(state, reason) {
  return {
    nextAction: state?.identity?.nextAction || "respond",
    caseType: state?.identity?.caseType || null,
    reason,
    missingFields: state?.identity?.lastMissingFields || []
  };
}

function isTruthyText(value) {
  const t = normalizeKey(value);
  return ["1", "SI", "S", "CORRECTO", "OK", "YES"].includes(t);
}

function isFalsyText(value) {
  const t = normalizeKey(value);
  return ["2", "NO", "N", "INCORRECTO"].includes(t);
}

function normalizePhone(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("56") && digits.length >= 11) {
    return `+${digits}`;
  }
  if (digits.startsWith("9") && digits.length === 9) {
    return `+56${digits}`;
  }
  if (digits.length >= 8 && digits.length <= 15) {
    return value.startsWith("+") ? value : `+${digits}`;
  }
  return null;
}

function extractEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim().toLowerCase() : null;
}

function extractPhone(text) {
  const source = String(text || "");
  const matches = source.match(/(?:\+?56\s*)?9\s*\d(?:[\s.-]*\d){7,8}/g);
  if (!matches || !matches.length) return null;
  return normalizePhone(matches[0]);
}

function extractRut(text) {
  return extractValidatedRut(text);
}

function formatRutHuman(raw) {
  return formatValidatedRutHuman(raw);
}

function extractName(text) {
  const source = normalizeSpaces(String(text || ""));
  const match = source.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,3})/i);
  if (!match) return null;
  return titleCaseWords(match[1]);
}

function isUsablePersonName(value) {
  const text = normalizeSpaces(String(value || ""));
  if (!text) return false;
  const stripped = removeDiacritics(text).replace(/[^A-Za-z\s]/g, "").trim();
  if (!stripped) return false;
  const letters = stripped.replace(/\s+/g, "");
  return letters.length >= 3;
}

function parseStructuredLeadText(text) {
  const source = String(text || "");
  const result = {};
  const lineRegex = /^\s*([A-Za-zÁÉÍÓÚÑáéíóúñ0-9_?¿,.\/() -]+?)\s*:\s*(.+?)\s*$/gm;
  let match;
  while ((match = lineRegex.exec(source)) !== null) {
    const rawKey = normalizeKey(match[1]);
    const value = normalizeSpaces(match[2]);
    if (!value) continue;

    if (["FULL NAME", "FULLNAME", "NOMBRE COMPLETO", "NAME"].includes(rawKey)) {
      result.full_name = titleCaseWords(value);
    } else if (["CITY", "CIUDAD", "COMUNA"].includes(rawKey)) {
      result.city = titleCaseWords(value);
    } else if (["PHONE NUMBER", "PHONENUMBER", "TELEFONO", "TELEFONO 1", "CELULAR", "WHATSAPP"].includes(rawKey)) {
      result.phone_number = value;
    } else if (["EMAIL", "CORREO", "CORREO ELECTRONICO"].includes(rawKey)) {
      result.email = value;
    } else if (["ESTATURA", "ALTURA", "HEIGHT"].includes(rawKey)) {
      result.height = value;
    } else if (["PESO", "PESO ", "PESO KG", "PESO_", "WEIGHT"].includes(rawKey)) {
      result.weight = value;
    } else if (["FONASA ISAPRE O PARTICULAR", "FONASA ISAPRE O PARTICULAR ", "PREVISION", "ASEGURADORA", "ASEGURADORA PREVISION", "ASEGURADORA PREVISION "].includes(rawKey)) {
      result.insurance = value;
    } else if (["EDAD", "AGE"].includes(rawKey)) {
      result.age = value;
    }
  }
  return result;
}

function splitNames(fullName) {
  const clean = normalizeSpaces(fullName);
  if (!clean) {
    return { nombres: null, apellidos: null };
  }
  const parts = clean.split(" ");
  if (parts.length === 1) {
    return { nombres: titleCaseWords(parts[0]), apellidos: null };
  }
  if (parts.length === 2) {
    return { nombres: titleCaseWords(parts[0]), apellidos: titleCaseWords(parts[1]) };
  }
  return {
    nombres: titleCaseWords(parts.slice(0, 2).join(" ")),
    apellidos: titleCaseWords(parts.slice(2).join(" "))
  };
}

function isBlockedSupportUserName(name) {
  const key = normalizeKey(name);
  if (!key) return true;
  return (
    key === "SINGLE WHATSAPP NOTIFICATION" ||
    key.startsWith("SINGLE WHATSAPP") ||
    key.startsWith("PAGINA ") ||
    key.startsWith("PAGINA:") ||
    key.startsWith("PAGE ") ||
    key.startsWith("PAGE:") ||
    key.startsWith("DR ") ||
    key.startsWith("DR.") ||
    key.startsWith("DOCTOR ")
  );
}

function looksLikeMeaningfulSupportText(text) {
  const key = normalizeKey(text);
  if (!key) return false;
  const markers = [
    "FONASA", "BANMEDICA", "CONSALUD", "CRUZ BLANCA", "COLMENA", "VIDA TRES", "MAS VIDA", "PARTICULAR",
    "TRAMO A", "TRAMO B", "TRAMO C", "TRAMO D",
    "BALON", "BARIATR", "MANGA", "BYPASS", "PLASTICA", "LIPO", "ABDOMINOPLASTIA", "MAMOPLASTIA",
    "HERNIA", "VESICULA", "ENDOSCOP", "CIRUGIA", "CIRUGIA BARIATRICA", "CIRUGIA PLASTICA"
  ];
  return markers.some((marker) => key.includes(marker));
}

function sanitizeSupportTicketForResolver(ticket) {
  if (!ticket) return ticket;
  const cloned = { ...ticket };
  if (ticket.via) {
    cloned.via = { ...ticket.via };
    if (ticket.via.source) {
      cloned.via.source = { ...ticket.via.source };
      if (ticket.via.source.from) {
        cloned.via.source.from = { ...ticket.via.source.from };
      }
    }
  }

  const combined = [ticket.subject, ticket.raw_subject, ticket.description].filter(Boolean).join(" ");
  if (!looksLikeMeaningfulSupportText(combined)) {
    cloned.subject = null;
    cloned.raw_subject = null;
    cloned.description = null;
  }

  if (cloned.via?.source?.from?.name && !looksLikeMeaningfulSupportText(cloned.via.source.from.name)) {
    cloned.via.source.from.name = null;
  }

  return cloned;
}

function filterSupportUsers(users, candidates = {}) {
  const expectedEmail = String(candidates.email || "").trim().toLowerCase();
  const expectedPhone = normalizePhone(candidates.phone || null);
  const expectedNames = [candidates.name, candidates.channelDisplayName, candidates.sourceProfileName]
    .map((value) => normalizeKey(value))
    .filter(Boolean);

  let list = (users || []).filter(Boolean).filter((user) => !isBlockedSupportUserName(user.name));

  if (expectedEmail) {
    const exactEmail = list.filter((user) => String(user?.email || "").trim().toLowerCase() === expectedEmail);
    if (exactEmail.length) list = exactEmail;
  }

  if (expectedPhone) {
    const exactPhone = list.filter((user) => normalizePhone(user?.phone) === expectedPhone);
    if (exactPhone.length) list = exactPhone;
  }

  if (expectedNames.length && list.length > 1) {
    const exactName = list.filter((user) => expectedNames.includes(normalizeKey(user?.name)));
    if (exactName.length) {
      list = exactName;
    } else {
      const partialName = list.filter((user) => {
        const userName = normalizeKey(user?.name);
        return expectedNames.some((expected) => userName.includes(expected) || expected.includes(userName));
      });
      if (partialName.length) list = partialName;
    }
  }

  return list.slice(0, 5);
}

function extractSupportIdentityHints(supportData = {}) {
  const users = Array.isArray(supportData?.users) ? supportData.users : [];
  const tickets = Array.isArray(supportData?.tickets) ? supportData.tickets : [];

  const ticketTexts = tickets.flatMap((ticket) => [
    ticket?.subject,
    ticket?.raw_subject,
    ticket?.description,
    ticket?.via?.source?.from?.name
  ].filter(Boolean));

  const email =
    users
      .map((user) => String(user?.email || "").trim().toLowerCase())
      .find(Boolean) ||
    ticketTexts.map((text) => extractEmail(text)).find(Boolean) ||
    null;

  const phone =
    users
      .map((user) => normalizePhone(user?.phone))
      .find(Boolean) ||
    ticketTexts.map((text) => extractPhone(text)).find(Boolean) ||
    null;

  const rutRaw = ticketTexts.map((text) => extractRut(text)).find(Boolean) || null;

  return {
    email,
    phone,
    rut: rutRaw ? formatRutHuman(rutRaw) || rutRaw : null
  };
}

function filterSupportTickets(tickets) {
  return (tickets || [])
    .filter((ticket) => {
      const key = normalizeKey([ticket?.subject, ticket?.raw_subject, ticket?.description].filter(Boolean).join(" "));
      if (!key) return false;
      if (key.includes("SENDING SINGLE WHATSAPP MESSAGE")) return false;
      return true;
    })
    .map((ticket) => sanitizeSupportTicketForResolver(ticket))
    .slice(0, 10);
}

function isStillLatestUserMessage(conversationId, expectedMessageId) {
  if (!expectedMessageId) return true;
  const latestState = getConversationState(conversationId);
  return latestState?.system?.lastInboundMessageId === expectedMessageId;
}

function isRealHumanBusinessTakeover(info) {
  const sourceType = info?.sourceType || "";
  const name = normalizeKey(info?.authorDisplayName || info?.channelDisplayName || "");
  const contentType = info?.rawMessage?.content?.type || "";
  const businessText = normalizeSpaces(info?.rawMessage?.content?.text || "");

  if (sourceType !== "zd:agentWorkspace") return false;
  if (contentType !== "text" || !businessText) return false;

  if (!name) return false;

  const nonHumanNames = new Set([
    "ANSWER BOT",
    "CHAT BOT",
    "BOT",
    "ANTONIA",
    "CHAT APP",
    "SUPPORT APP",
    "CLINYCO"
  ]);

  return !nonHumanNames.has(name);
}

function clearSoftHandoffState(state) {
  state.system.aiEnabled = true;
  if (state.system.handoffReason === "max_bot_messages_reached") {
    state.system.botMessagesSent = MAX_BOT_MESSAGES - 1;
  }
  state.system.handoffReason = null;
  state.system.lastQuestionKey = null;
}

function resumeSoftHandoffIfAllowed(state, latestUserText) {
  if (state.system.aiEnabled || state.system.humanTakenOver) return false;

  if (state.system.handoffReason === "max_bot_messages_reached") {
    clearSoftHandoffState(state);
    return true;
  }

  if (
    state.system.handoffReason === "unknown_professional_schedule" &&
    !detectUnknownProfessionalScheduleRequest(latestUserText).shouldDerive
  ) {
    clearSoftHandoffState(state);
    return true;
  }

  return false;
}

function extractDate(text) {
  const match = String(text || "").match(/\b(\d{2})[\/-](\d{2})[\/-](\d{4})\b/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : null;
}

function extractAddress(text) {
  const source = normalizeSpaces(String(text || ""));
  // Match explicit "dirección: ..." prefix
  const match = source.match(/(?:direccion|dirección)\s*:?\s*(.+)$/i);
  if (match) return titleCaseWords(match[1]);
  // Match common street patterns: "Av.", "Calle", "Pasaje", etc. followed by name and number
  const streetMatch = source.match(/^((?:av(?:enida)?|calle|pasaje|psje|pje|los|las|el|la)\b[\s.]*.+\d+.*)$/i);
  if (streetMatch) return titleCaseWords(streetMatch[1]);
  return null;
}

function detectComuna(text) {
  const normalized = normalizeKey(text);
  for (const comuna of KNOWN_COMUNAS) {
    if (normalized.includes(normalizeKey(comuna))) {
      return comuna === "VALPARAISO" ? "VALPARAÍSO" : comuna === "CONCEPCION" ? "CONCEPCIÓN" : comuna === "COPIAPO" ? "COPIAPÓ" : comuna === "CHILLAN" ? "CHILLÁN" : comuna === "QUILPUE" ? "QUILPUÉ" : comuna === "MAIPU" ? "MAIPÚ" : comuna;
    }
  }
  return null;
}

function detectSucursal(comuna) {
  const key = normalizeKey(comuna);
  if (key === "ANTOFAGASTA") return "Antofagasta";
  if (key === "CALAMA") return "Calama";
  if (key === "SANTIAGO") return "Santiago";
  return null;
}

function detectProcedure(text) {
  const normalized = normalizeKey(text);
  if (/\b(BALON|BALON GASTRICO|INTRAGASTRICO|INTRAGASTRICO ECLIPSE|ALLURION|ORBERA)\b/.test(normalized)) {
    return { key: "BALON", label: "Balón gástrico", pipelineId: 4823817 };
  }
  if (/\b(MANGA GASTRICA|MANGA|BYPASS|BARIATRICA|BARIATRICO|BARIATRICA)\b/.test(normalized)) {
    return { key: "BARIATRICA", label: "Cirugía bariátrica", pipelineId: 1290779 };
  }
  if (/\b(PLASTICA|ABDOMINOPLASTIA|LIPO|MAMOPLASTIA|RINOPLASTIA|CIRUGIA PLASTICA)\b/.test(normalized)) {
    return { key: "PLASTICA", label: "Cirugía plástica", pipelineId: 4959507 };
  }
  if (/\b(COLECISTECTOMIA|COLECISTECTOMIA|VESICULA|Vesícula|HERNIA|CIRUGIA GENERAL|ENDOSCOPIA|ENDOSCOPÍA)\b/i.test(text)) {
    return { key: "GENERAL", label: "Cirugía general", pipelineId: 5049979 };
  }
  if (/\b(NUTRICION|NUTRICIONISTA|NUTRI)\b/.test(normalized)) {
    return { key: "CONSULTA_NUTRICION", label: "Consulta nutrición", pipelineId: null };
  }
  if (/\b(PSICOLOGIA|PSICOLOGA|PSICOLOGO|PSICOLOGICA)\b/.test(normalized)) {
    return { key: "CONSULTA_PSICOLOGIA", label: "Consulta psicología", pipelineId: null };
  }
  if (/\b(KINESIOLOGIA|KINESIOLOGO|KINESIOLOGA|KINE)\b/.test(normalized)) {
    return { key: "CONSULTA_KINESIOLOGIA", label: "Consulta kinesiología", pipelineId: null };
  }
  if (/\b(MEDICINA GENERAL|MEDICO GENERAL|MEDICA GENERAL|MEDICINA INTERNA)\b/.test(normalized)) {
    return { key: "CONSULTA_MEDICINA", label: "Consulta medicina", pipelineId: null };
  }
  return null;
}

const SPECIALTY_TO_DEAL_INTERES = {
  NUTRICION: "Consulta nutrición", NUTRICIONISTA: "Consulta nutrición",
  PSICOLOGIA: "Consulta psicología", PSICOLOGO: "Consulta psicología", PSICOLOGA: "Consulta psicología",
  KINESIOLOGIA: "Consulta kinesiología", KINESIOLOGO: "Consulta kinesiología", KINESIOLOGA: "Consulta kinesiología",
  CIRUGIA: "Cirugía bariátrica", "CIRUGIA DIGESTIVA": "Cirugía bariátrica", "CIRUGIA BARIATRICA": "Cirugía bariátrica",
  "CIRUGIA PLASTICA": "Cirugía plástica",
  ENDOCRINOLOGIA: "Consulta medicina", "MEDICINA GENERAL": "Consulta medicina",
  PEDIATRIA: "Consulta medicina", "ENDOCRINOLOGIA INFANTIL": "Consulta medicina",
  NUTRIOLOGIA: "Consulta nutrición", "MEDICINA DEPORTIVA": "Consulta medicina"
};

const PROFESSIONAL_ALIAS_TO_DEAL_INTERES = {
  "magaly cerquera": "Consulta nutrición",
  "katherine saavedra": "Consulta nutrición",
  "peggy huerta": "Consulta psicología",
  "francisca naritelli": "Consulta psicología",
  "rodrigo villagran": "Cirugía bariátrica",
  "nelson aros": "Cirugía bariátrica",
  "alberto sirabo": "Cirugía bariátrica",
  "edmundo ziede": "Cirugía plástica",
  "rosirys ruiz": "Cirugía plástica",
  "ingrid yevenes": "Consulta nutrición",
  "fernando moya": "Consulta nutrición",
  "pablo ramos": "Consulta medicina",
  "carlos nunez": "Consulta medicina",
  "daniza jaldin": "Consulta medicina",
  "rodrigo bancalari": "Consulta medicina",
  "francisco bencina": "Consulta medicina"
};

function deriveDealInteresFromSpecialty(specialty, alias) {
  if (alias) {
    const fromAlias = PROFESSIONAL_ALIAS_TO_DEAL_INTERES[alias.toLowerCase()];
    if (fromAlias) return fromAlias;
  }
  if (specialty) {
    const key = normalizeKey(specialty);
    if (SPECIALTY_TO_DEAL_INTERES[key]) return SPECIALTY_TO_DEAL_INTERES[key];
    for (const [k, v] of Object.entries(SPECIALTY_TO_DEAL_INTERES)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
  }
  return "Consulta médica";
}

function isCoverageInsuranceQuestion(normalizedText) {
  return [
    "COBERTURA",
    "CUBRE",
    "CUBRIR",
    "ACEPTAN",
    "CONVENIO",
    "SE PUEDE CON",
    "TRABAJAN CON",
    "ATIENDEN CON",
    "SERVIRA",
    "SIRVE",
    "APLICA"
  ].some((phrase) => normalizedText.includes(phrase));
}

function hasInsuranceAnswerContext(normalizedText) {
  return [
    "MI PREVISION",
    "PREVISION",
    "ASEGURADORA",
    "ISAPRE",
    "SOY",
    "TENGO",
    "CUENTO CON",
    "USO",
    "PARTICULAR"
  ].some((phrase) => normalizedText.includes(phrase));
}

function detectNegatedAseguradora(normalizedText) {
  for (const [alias, canonical] of SORTED_ASEGURADORA_ALIASES) {
    const negationPattern = new RegExp(`\\bNO\\s+(?:SOY|TENGO|CUENTO CON|USO|ES)\\s+${escapeRegex(alias)}\\b`);
    if (negationPattern.test(normalizedText)) {
      return canonical;
    }
  }
  return null;
}

function findExplicitAseguradora(normalizedText) {
  return SORTED_ASEGURADORA_ALIASES.find(([alias]) => normalizedText.includes(alias)) || null;
}

function parseAseguradora(text) {
  const normalized = normalizeKey(text);

  if (!normalized) return null;

  const negatedAseguradora = detectNegatedAseguradora(normalized);
  const aliasEntry = findExplicitAseguradora(normalized);
  const looksLikeInsuranceAnswer =
    aliasEntry &&
    (
      normalized === aliasEntry[0] ||
      normalized === `ISAPRE ${aliasEntry[0]}` ||
      (
        !isCoverageInsuranceQuestion(normalized) &&
        (
          normalized.split(" ").length <= 4 ||
          hasInsuranceAnswerContext(normalized)
        )
      )
    );

  if (
    negatedAseguradora === "FONASA" &&
    normalized.includes("ISAPRE") &&
    !isCoverageInsuranceQuestion(normalized) &&
    (!aliasEntry || aliasEntry[1] === "FONASA")
  ) {
    return {
      aseguradora: null,
      modalidad: null,
      isFonasa: false,
      isIsapreGeneric: true,
      negatedAseguradora: "FONASA"
    };
  }

  if (negatedAseguradora && (!aliasEntry || aliasEntry[1] === negatedAseguradora)) {
    return {
      aseguradora: null,
      modalidad: null,
      isFonasa: false,
      isIsapreGeneric: false,
      negatedAseguradora
    };
  }

  if (aliasEntry && (!isCoverageInsuranceQuestion(normalized) || looksLikeInsuranceAnswer)) {
    const [, canonical] = aliasEntry;
    return {
      aseguradora: canonical,
      modalidad: canonical === "FONASA" ? null : (MODALIDAD_FROM_ASEGURADORA[canonical] || null),
      isFonasa: canonical === "FONASA" || canonical === "PAD Fonasa PAD",
      isIsapreGeneric: false,
      negatedAseguradora: null
    };
  }

  if (
    normalized.includes("ISAPRE") &&
    !normalized.includes("FONASA") &&
    !isCoverageInsuranceQuestion(normalized)
  ) {
    return {
      aseguradora: null,
      modalidad: null,
      isFonasa: false,
      isIsapreGeneric: true,
      negatedAseguradora: null
    };
  }

  return null;
}

function parseFonasaTramo(text) {
  const normalized = normalizeKey(text);
  const match = normalized.match(/\bTRAMO\s+([ABCD])\b/) || normalized.match(/^([ABCD])$/);
  if (!match) return null;
  const tramo = match[1].toUpperCase();
  const modalidad = `Tramo ${tramo}`;
  return {
    tramo,
    modalidad,
    isPadEligible: tramo !== "A"
  };
}

function normalizeAseguradoraValue(value) {
  if (!value) return null;
  const parsed = parseAseguradora(value);
  return parsed?.aseguradora || null;
}

function normalizeMeasurementNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, ".").replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function calculateBMI(weightKg, heightM) {
  if (!weightKg || !heightM || heightM <= 0) return null;
  const bmi = weightKg / (heightM * heightM);
  return Math.round(bmi * 10) / 10;
}

function getBMICategory(bmi) {
  if (bmi === null || bmi === undefined) return null;
  if (bmi < 18.5) return "Bajo peso";
  if (bmi < 25) return "Peso normal";
  if (bmi < 30) return "Sobrepeso";
  if (bmi < 35) return "Obesidad grado 1";
  if (bmi < 40) return "Obesidad grado 2";
  return "Obesidad grado 3";
}

function parseMeasurements(text) {
  const source = String(text || "");
  const normalized = normalizeSpaces(source.toLowerCase());

  let weightKg = null;
  let heightM = null;
  let fromCm = false;
  let ambiguous = false;
  let reason = null;

  const explicitWeight =
    normalized.match(/(?:peso\s*:?\s*)?(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kgs|kl|kls|kilo|kilos|kilogramos?)\b/i) ||
    normalized.match(/\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kgs|kl|kls|kilo|kilos|kilogramos?)\b/i);

  if (explicitWeight) {
    weightKg = normalizeMeasurementNumber(explicitWeight[1]);
  }

  const explicitHeightMeters =
    normalized.match(/(?:altura|estatura|mido)\s*:?\s*(1[.,]\d{1,2}|2[.,]0{1,2})\s*(?:m|mt|mts|metro|metros)?\b/i) ||
    normalized.match(/\b(1[.,]\d{1,2}|2[.,]0{1,2})\s*(?:m|mt|mts|metro|metros)\b/i);

  if (explicitHeightMeters) {
    heightM = normalizeMeasurementNumber(explicitHeightMeters[1]);
  }

  const explicitHeightCm =
    normalized.match(/(?:altura|estatura|mido)\s*:?\s*(\d{3})\s*cm\b/i) ||
    normalized.match(/\b(\d{3})\s*cm\b/i);

  if (!heightM && explicitHeightCm) {
    const cm = normalizeMeasurementNumber(explicitHeightCm[1]);
    if (cm) {
      heightM = Math.round((cm / 100) * 100) / 100;
      fromCm = true;
    }
  }

  if (weightKg && heightM) {
    if (weightKg < 25 || weightKg > 350 || heightM < 1.2 || heightM > 2.2) {
      return null;
    }
    return {
      weightKg,
      heightM,
      heightCm: Math.round(heightM * 100),
      ambiguous: false,
      fromCm,
      reason: null
    };
  }

  // Solo inferir por pares si NO hubo dato explícito de peso/altura.
  const pairMatches = Array.from(normalized.matchAll(/\b(\d{2,3}(?:[.,]\d{1,2})?)\b/g)).map((m) => m[1]);
  if (!explicitWeight && !explicitHeightMeters && !explicitHeightCm && pairMatches.length >= 2) {
    const numbers = pairMatches.slice(0, 3).map((v) => normalizeMeasurementNumber(v)).filter(Boolean);
    if (numbers.length >= 2) {
      const [a, b] = numbers;

      if (a >= 40 && a <= 250 && b >= 120 && b <= 220) {
        weightKg = a;
        heightM = Math.round((b / 100) * 100) / 100;
        fromCm = true;
        ambiguous = true;
        reason = "pair_weight_cm";
      } else if (a >= 120 && a <= 220 && b >= 40 && b <= 250) {
        weightKg = b;
        heightM = Math.round((a / 100) * 100) / 100;
        fromCm = true;
        ambiguous = true;
        reason = "pair_cm_weight";
      } else if (a >= 40 && a <= 250 && b >= 1.2 && b <= 2.2) {
        weightKg = a;
        heightM = b;
        ambiguous = true;
        reason = "pair_weight_m";
      } else if (a >= 1.2 && a <= 2.2 && b >= 40 && b <= 250) {
        weightKg = b;
        heightM = a;
        ambiguous = true;
        reason = "pair_m_weight";
      }
    }
  }

  if (!weightKg && !heightM) return null;
  if (weightKg && (weightKg < 25 || weightKg > 350)) return null;
  if (heightM && (heightM < 1.2 || heightM > 2.2)) return null;

  return {
    weightKg: weightKg || null,
    heightM: heightM || null,
    heightCm: heightM ? Math.round(heightM * 100) : null,
    ambiguous,
    fromCm,
    reason
  };
}

function buildBMIContext(text) {
  const parsed = parseMeasurements(text);
  if (!parsed || !parsed.weightKg || !parsed.heightM) return null;
  const bmi = calculateBMI(parsed.weightKg, parsed.heightM);
  if (!bmi) return null;
  return {
    weightKg: parsed.weightKg,
    heightM: parsed.heightM,
    heightCm: parsed.heightCm,
    bmi,
    category: getBMICategory(bmi),
    ambiguous: parsed.ambiguous,
    fromCm: parsed.fromCm,
    reason: parsed.reason
  };
}

function structuredLeadToMeasurementText(structured) {
  if (!structured) return "";
  const parts = [];
  if (structured.weight) parts.push(`peso ${structured.weight}`);
  if (structured.height) parts.push(`estatura ${structured.height}`);
  return parts.join(" ");
}

function calculateHumanDelay(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return 1000;

  const chars = cleanText.length;
  let delay = 700 + chars * 18 + Math.floor(Math.random() * 700);

  if (chars < 25) delay += 150;
  if (chars > 120) delay += 400;

  delay = Math.max(900, delay);
  delay = Math.min(delay, 4500);

  return delay;
}

function getHistory(conversationId) {
  if (!conversationHistory.has(conversationId)) {
    conversationHistory.set(conversationId, []);
  }
  return conversationHistory.get(conversationId);
}

function addToHistory(conversationId, role, content) {
  const history = getHistory(conversationId);
  history.push({ role, content: String(content || "").trim() });
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }
}

function buildInitialConversationState() {
  return {
    contactDraft: {
      c_rut: null,
      c_nombres: null,
      c_apellidos: null,
      c_fecha: null,
      c_tel1: null,
      c_tel2: null,
      c_email: null,
      c_aseguradora: null,
      c_modalidad: null,
      c_direccion: null,
      c_comuna: null
    },
    dealDraft: {
      dealPipelineId: null,
      dealOwnerId: null,
      dealSucursal: null,
      dealPeso: null,
      dealEstatura: null,
      dealInteres: null,
      dealUrlMedinet: null,
      dealCirugiasPrevias: null,
      dealCirujanoBariatrico: null,
      dealCirujanoPlastico: null,
      dealCirujanoBalon: null,
      dealCirujanoGeneral: null,
      dealValidacionPad: null,
      dealNumeroFamilia: null,
      dealColab1: null,
      dealColab2: null,
      dealColab3: null
    },
    identity: {
      matchStatus: "no_context",
      customerId: null,
      matchedBy: null,
      requiresUserConfirmation: false,
      safeToUseHistoricalContext: false,
      possibleContexts: [],
      whatsappPhone: null,
      channelExternalId: null,
      channelDisplayName: null,
      sourceProfileName: null,
      channelSourceType: null,
      saysExistingPatient: false,
      lastSellSearchRut: null,
      sellSearchCompleted: false,
      sellContactFound: false,
      sellDealFound: false,
      sellSummary: null,
      sellRaw: null,
      supportSearchCompleted: false,
      foundInSupport: false,
      supportSummary: null,
      supportRaw: null,
      supportInferredRut: null,
      lastSupportSearchKey: null,
      likelyClinicalRecordOnly: false,
      caseType: null,
      nextAction: null,
      lastQuestionReason: null,
      lastMissingFields: [],
      lastResolvedContext: null,
      verifiedRutAt: null,
      verifiedWhatsappAt: null,
      verifiedPairAt: null
    },
    measurements: {
      weightKg: null,
      heightM: null,
      heightCm: null,
      bmi: null,
      bmiCategory: null,
      pendingConfirmation: false,
      proposedWeightKg: null,
      proposedHeightM: null,
      proposedHeightCm: null,
      askedMeasurementInstructions: false
    },
    customerMemory: {
      customerId: null,
      previousConversations: [],
      isReturning: false
    },
    openHelp: {
      asked: false,
      askedAt: null,
      response: null,
      classifiedIntent: null
    },
    booking: {
      pendingSlots: null,
      pendingProfessional: null,
      pendingSpecialty: null,
      awaitingSlotChoice: false,
      awaitingPatientData: false,
      chosenSlot: null,
      missingFields: null
    },
    system: {
      aiEnabled: true,
      humanTakenOver: false,
      assigneeId: null,
      botMessagesSent: 0,
      introducedAsAntonia: false,
      handoffReason: null,
      lastQuestionKey: null,
      lastInboundMessageId: null,
      lastOutboundFingerprint: null,
      lastOutboundText: null,
      lastOutboundReason: null,
      lastOutboundAt: null
    }
  };
}

function mergeConversationState(baseState, persistedState) {
  const merged = buildInitialConversationState();
  for (const key of Object.keys(merged)) {
    if (persistedState && typeof persistedState[key] === "object" && persistedState[key] !== null) {
      merged[key] = { ...merged[key], ...persistedState[key] };
    } else if (persistedState && persistedState[key] !== undefined) {
      merged[key] = persistedState[key];
    } else if (baseState && baseState[key] !== undefined) {
      if (typeof merged[key] === "object" && merged[key] !== null) {
        merged[key] = { ...merged[key], ...baseState[key] };
      } else {
        merged[key] = baseState[key];
      }
    }
  }
  return merged;
}

function getConversationState(conversationId) {
  if (!conversationStates.has(conversationId)) {
    conversationStates.set(conversationId, buildInitialConversationState());
  }
  return conversationStates.get(conversationId);
}

async function hydrateConversationCache(conversationId) {
  if (hydratedConversations.has(conversationId)) {
    return getConversationState(conversationId);
  }

  const baseState = getConversationState(conversationId);

  if (!dbEnabled()) {
    hydratedConversations.add(conversationId);
    return baseState;
  }

  try {
    const record = await getConversationRecord(conversationId);
    if (record?.state_json) {
      conversationStates.set(conversationId, mergeConversationState(baseState, record.state_json));
    }

    const recentMessages = await getRecentConversationMessages(conversationId, MAX_HISTORY_MESSAGES);
    if (recentMessages.length > 0) {
      conversationHistory.set(
        conversationId,
        recentMessages.map((row) => ({
          role: row.role === "assistant" ? "assistant" : row.role === "system" ? "system" : "user",
          content: String(row.content || "").trim()
        }))
      );
    }
  } catch (error) {
    console.error("DB HYDRATION ERROR:", error.message);
  }

  hydratedConversations.add(conversationId);
  return getConversationState(conversationId);
}

async function persistConversationSnapshot(conversationId, state, channel = null) {
  if (!dbEnabled()) return;
  try {
    await upsertConversationState(conversationId, channel, state);
    await upsertStructuredLead(conversationId, channel, state);
  } catch (error) {
    console.error("DB SNAPSHOT ERROR:", error.message);
  }
}

async function persistConversationMessage({ conversationId, role, messageId = null, channel = null, sourceType = null, content = "", rawJson = null }) {
  if (!dbEnabled()) return true;
  try {
    return await insertConversationMessage({
      conversationId,
      role,
      messageId,
      channel,
      sourceType,
      content,
      rawJson
    });
  } catch (error) {
    console.error("DB MESSAGE ERROR:", error.message);
    return false;
  }
}

function updateIdentityChannelContext(state, info = null, channelLabel = null) {
  if (!state.identity) {
    state.identity = {};
  }

  if (info?.channelExternalId) {
    state.identity.channelExternalId = info.channelExternalId;
  }
  if (info?.channelDisplayName) {
    state.identity.channelDisplayName = info.channelDisplayName;
  }
  if (info?.sourceProfileName) {
    state.identity.sourceProfileName = info.sourceProfileName;
  }
  if (info?.sourceType || channelLabel) {
    state.identity.channelSourceType = info?.sourceType || channelLabel;
  }

  const isWhatsappChannel = /whatsapp/i.test(String(info?.sourceType || channelLabel || state.identity.channelSourceType || ""));
  const whatsappPhone = isWhatsappChannel
    ? normalizePhone(state.identity.channelExternalId || state.identity.whatsappPhone || null)
    : normalizePhone(state.identity.whatsappPhone || null);

  if (whatsappPhone) {
    state.identity.whatsappPhone = whatsappPhone;
    if (isWhatsappChannel) {
      state.identity.verifiedWhatsappAt = state.identity.verifiedWhatsappAt || new Date().toISOString();
    }
  }
}

function applyCustomerResolutionToState(state, resolved, options = {}) {
  const hasVerifiedRut = Boolean(options.hasVerifiedRut);
  const hasWhatsapp = Boolean(options.hasWhatsapp);
  const nowIso = new Date().toISOString();

  state.identity.customerId = resolved?.customer?.id || state.identity.customerId || null;
  state.identity.matchedBy = resolved?.matchedBy || null;
  state.identity.possibleContexts = resolved?.customer
    ? [{ customerId: resolved.customer.id, matchedBy: resolved.matchedBy || null }]
    : [];

  if (hasVerifiedRut && hasWhatsapp) {
    state.identity.matchStatus = "identity_confirmed";
    state.identity.requiresUserConfirmation = false;
    state.identity.safeToUseHistoricalContext = true;
    state.identity.verifiedRutAt = state.identity.verifiedRutAt || nowIso;
    state.identity.verifiedWhatsappAt = state.identity.verifiedWhatsappAt || nowIso;
    state.identity.verifiedPairAt = state.identity.verifiedPairAt || nowIso;
    return;
  }

  if (hasVerifiedRut) {
    state.identity.matchStatus = "identity_confirmed";
    state.identity.requiresUserConfirmation = false;
    state.identity.safeToUseHistoricalContext = true;
    state.identity.verifiedRutAt = state.identity.verifiedRutAt || nowIso;
    return;
  }

  if (resolved?.customer && resolved.matchedBy === "whatsapp") {
    state.identity.matchStatus = "probable_context_from_whatsapp";
    state.identity.requiresUserConfirmation = true;
    state.identity.safeToUseHistoricalContext = false;
    return;
  }

  if (hasWhatsapp) {
    state.identity.matchStatus = "awaiting_rut";
    state.identity.requiresUserConfirmation = true;
    state.identity.safeToUseHistoricalContext = false;
    return;
  }

  state.identity.matchStatus = "no_context";
  state.identity.requiresUserConfirmation = false;
  state.identity.safeToUseHistoricalContext = false;
}

async function syncCustomerChannelsFromState(customerId, conversationId, state, channelLabel) {
  if (!customerId) return;

  const profile = buildCustomerProfile(state);
  const identity = state.identity || {};
  const verified = Boolean(identity.verifiedPairAt || identity.verifiedRutAt);
  const isWhatsappChannel = /whatsapp/i.test(String(identity.channelSourceType || channelLabel || ""));
  const canAttachWhatsapp = Boolean(profile.whatsappPhone || (isWhatsappChannel && identity.channelExternalId));

  if (canAttachWhatsapp) {
    await addCustomerChannel({
      customerId,
      channelType: "whatsapp",
      channelValue: profile.whatsappPhone,
      isPrimary: true,
      verified,
      sourceSystem: isWhatsappChannel ? identity.channelSourceType || "sunco" : "sunco",
      externalId: isWhatsappChannel ? identity.channelExternalId || null : null,
      metadata: {
        conversationId,
        channel: channelLabel,
        channelDisplayName: identity.channelDisplayName || null,
        sourceProfileName: identity.sourceProfileName || null
      }
    });
  }

  if (profile.telefonoPrincipal) {
    await addCustomerChannel({
      customerId,
      channelType: "phone",
      channelValue: profile.telefonoPrincipal,
      isPrimary: profile.telefonoPrincipal === profile.whatsappPhone,
      verified,
      sourceSystem: "conversation",
      metadata: { conversationId, channel: channelLabel }
    });
  }

  if (profile.email) {
    await addCustomerChannel({
      customerId,
      channelType: "email",
      channelValue: profile.email,
      verified,
      sourceSystem: "conversation",
      metadata: { conversationId, channel: channelLabel }
    });
  }
}

async function ensureCustomerContext({ conversationId, state, info = null, channelLabel = null, loadSummaries = true }) {
  if (!dbEnabled()) {
    return { customer: null, summaries: [], customerContextBlock: null };
  }

  updateIdentityChannelContext(state, info, channelLabel);

  const customerProfile = buildCustomerProfile(state);
  const verifiedRut = state.identity?.verifiedRutAt ? customerProfile.rut : null;
  const resolvedWhatsapp = customerProfile.whatsappPhone;
  const resolved = await resolveCustomerFromIdentifiers({
    whatsappPhone: resolvedWhatsapp,
    rut: verifiedRut
  });

  applyCustomerResolutionToState(state, resolved, {
    hasVerifiedRut: Boolean(verifiedRut),
    hasWhatsapp: Boolean(resolvedWhatsapp)
  });

  const customer = await upsertCustomer(customerProfile, {
    customerId: state.identity.customerId || resolved.customer?.id || null,
    conversationAt: new Date().toISOString()
  });

  if (!customer) {
    state.customerMemory = {
      customerId: null,
      previousConversations: [],
      isReturning: false
    };
    return { customer: null, summaries: [], customerContextBlock: null };
  }

  state.identity.customerId = customer.id;
  state.identity.matchedBy = state.identity.matchedBy || (customerProfile.rut ? "rut" : customerProfile.whatsappPhone ? "whatsapp" : null);
  applyCustomerResolutionToState(state, { customer, matchedBy: state.identity.matchedBy }, {
    hasVerifiedRut: Boolean(state.identity?.verifiedRutAt && customerProfile.rut),
    hasWhatsapp: Boolean(customerProfile.whatsappPhone)
  });

  await linkConversationToCustomer(conversationId, customer.id, {
    channel: channelLabel,
    channelExternalId: state.identity.channelExternalId || null,
    channelDisplayName: state.identity.channelDisplayName || null,
    sourceProfileName: state.identity.sourceProfileName || null,
    whatsappPhone: customerProfile.whatsappPhone
  });
  await syncCustomerChannelsFromState(customer.id, conversationId, state, channelLabel);

  const summaries = loadSummaries ? await getCustomerSummaries(customer.id, 3) : [];
  enrichStateFromCustomer(state, customer, summaries, {
    populateDrafts: Boolean(state.identity.safeToUseHistoricalContext)
  });

  return {
    customer,
    summaries,
    customerContextBlock: buildCustomerContextBlock(customer, summaries, {
      includeSensitiveIdentity: Boolean(state.identity.safeToUseHistoricalContext)
    })
  };
}

async function maybeSaveConversationSummary(conversationId, state, channelLabel = null) {
  if (!dbEnabled()) return null;

  try {
    let customerId = state?.identity?.customerId || null;

    if (!customerId) {
      const ensured = await ensureCustomerContext({
        conversationId,
        state,
        info: null,
        channelLabel,
        loadSummaries: false
      });
      customerId = ensured.customer?.id || state?.identity?.customerId || null;
    }

    if (!customerId) {
      return null;
    }

    return await saveConversationToCustomer(customerId, conversationId, state, channelLabel);
  } catch (error) {
    console.error("CUSTOMER SUMMARY ERROR:", error.message);
    return null;
  }
}

function claimInboundMessageFallback(conversationId, messageId) {
  if (!messageId) return true;
  cleanupRecentMap(recentInboundMessageClaims, INBOUND_DEDUPE_TTL_MS);
  const key = `${conversationId}:${messageId}`;
  if (recentInboundMessageClaims.has(key)) {
    return false;
  }
  recentInboundMessageClaims.set(key, Date.now());
  return true;
}

async function claimInboundUserMessage({ conversationId, messageId, channel, sourceType, content, rawJson }) {
  if (!messageId) {
    const claimed = claimInboundMessageFallback(conversationId, `${normalizeKey(content).slice(0, 80)}:${sourceType || ""}`);
    if (!claimed) return false;
    await persistConversationMessage({
      conversationId,
      role: "user",
      messageId: null,
      channel,
      sourceType,
      content,
      rawJson
    });
    return true;
  }

  if (!dbEnabled()) {
    return claimInboundMessageFallback(conversationId, messageId);
  }

  try {
    return await insertConversationMessage({
      conversationId,
      role: "user",
      messageId,
      channel,
      sourceType,
      content,
      rawJson
    });
  } catch (error) {
    console.error("DB MESSAGE CLAIM ERROR:", error.message);
    return claimInboundMessageFallback(conversationId, messageId);
  }
}

async function sendManagedReply({
  appId,
  conversationId,
  messageId,
  userText,
  reply,
  kind,
  state,
  info,
  channelLabel,
  resolverDecision = null,
  disableAiAfterSend = false,
  handoffReasonAfterSend = null,
  allowDuplicateText = false
}) {
  const delayMs = calculateHumanDelay(reply);
  await sleep(delayMs);

  const latestState = getConversationState(conversationId);
  if (!latestState.system.aiEnabled) {
    return resJsonSkip("ai_disabled_after_delay");
  }

  if (!isStillLatestUserMessage(conversationId, messageId)) {
    return resJsonSkip("stale_message_after_delay");
  }

  const finalReply = appendAntoniaIntroduction(latestState, reply);
  if (!allowDuplicateText && shouldSuppressOutboundReply(latestState, finalReply, kind)) {
    await saveConversationEvent({
      conversationId,
      info,
      channelLabel,
      userText,
      botReply: null,
      state: latestState,
      resolverDecision: buildBlockedDecision(latestState, "duplicate_reply_suppressed")
    });
    await persistConversationSnapshot(conversationId, latestState, channelLabel);
    return resJsonSkip("duplicate_reply_suppressed");
  }

  try {
    await sendConversationReply(appId, conversationId, finalReply);
  } catch (sendError) {
    console.error("SEND_REPLY_ERROR:", sendError.message);
    await saveConversationEvent({
      conversationId, info, channelLabel, userText,
      botReply: `[SEND_FAILED] ${finalReply}`,
      state: latestState,
      resolverDecision: { ...resolverDecision, sendError: sendError.message }
    });
    throw sendError;
  }
  addToHistory(conversationId, "assistant", finalReply);

  latestState.system.botMessagesSent += 1;
  rememberOutboundReply(latestState, finalReply, kind);
  let shouldSaveSummary = false;

  if (disableAiAfterSend) {
    latestState.system.aiEnabled = false;
    latestState.system.handoffReason = handoffReasonAfterSend || latestState.system.handoffReason || null;
    shouldSaveSummary = true;
  } else if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
    markMaxMessagesReached(latestState);
    shouldSaveSummary = true;
  }

  await persistConversationMessage({
    conversationId,
    role: "assistant",
    channel: channelLabel,
    sourceType: "api:conversations",
    content: finalReply,
    rawJson: { kind, resolverDecision }
  });
  await saveConversationEvent({
    conversationId,
    info,
    channelLabel,
    userText,
    botReply: finalReply,
    state: latestState,
    resolverDecision
  });
  await persistConversationSnapshot(conversationId, latestState, channelLabel);
  if (shouldSaveSummary) {
    await maybeSaveConversationSummary(conversationId, latestState, channelLabel);
  }

  return {
    ok: true,
    reply: finalReply,
    delayMs,
    botMessagesSent: latestState.system.botMessagesSent,
    handoffReason: latestState.system.handoffReason || null,
    resolverDecision: resolverDecision || null
  };
}

function resJsonSkip(reason) {
  return { ok: true, skipped: reason };
}

function extractConversationInfo(payload) {
  const appId = payload?.app?.id || payload?.app?._id || payload?.appId || SUNCO_APP_ID || null;
  const event = Array.isArray(payload?.events) ? payload.events[0] : null;
  const eventPayload = event?.payload || {};
  const message = eventPayload?.message || payload?.message || null;
  const source = message?.source || {};
  const conversation = eventPayload?.conversation || payload?.conversation || {};
  const authorUser = message?.author?.user || {};
  const sourceClient = source?.client || {};

  const conversationId = conversation?.id || conversation?._id || null;
  let userText = "";
  if (message?.author?.type === "user" && message?.content?.type === "text") {
    userText = message?.content?.text || "";
  }

  return {
    appId,
    conversationId,
    userText: String(userText || "").trim(),
    eventType: event?.type || null,
    authorType: message?.author?.type || null,
    messageId: message?.id || null,
    sourceType: source?.type || null,
    channelDisplayName: sourceClient?.displayName || message?.author?.displayName || null,
    channelExternalId: sourceClient?.externalId || null,
    authorDisplayName: message?.author?.displayName || null,
    sourceProfileName: sourceClient?.raw?.profile?.name || sourceClient?.raw?.name || null,
    entryPoint: source?.entryPoint || null,
    rawMessage: message,
    rawConversation: conversation,
    rawSource: source,
    rawAuthorUser: authorUser
  };
}

function hasScheduleIntent(text) {
  const normalized = normalizeKey(text);
  return [
    "TIENE HORA",
    "TENDRA HORA",
    "TENDRA HORAS",
    "TENDRA DISPONIBILIDAD",
    "HAY HORA",
    "HAY HORAS",
    "AGENDAR",
    "AGENDA",
    "DISPONIBILIDAD",
    "DISPONIBLE",
    "HORITA",
    "CITA",
    "CONTROL",
    "CAMBIO HORA",
    "CAMBIO DE HORA",
    "REAGENDAR",
    "RESERVAR HORA",
    "TOMA DE HORA",
    "HORA EN",
    "QUIERO HORA",
    "QUIERO UNA HORA",
    "AGENDAR EN",
    "AGENDA EN"
  ].some((phrase) => normalized.includes(phrase));
}

function hasExplicitScheduleIntent(text) {
  const normalized = normalizeKey(text);
  return [
    "HORA CON",
    "HORA PARA",
    "AGENDAR CON",
    "AGENDAR PARA",
    "DISPONIBILIDAD CON",
    "DISPONIBLES CON",
    "DISPONIBLE CON",
    "AGENDA CON",
    "RESERVAR HORA CON",
    "CAMBIO DE HORA",
    "CONTROL CON",
    "ONLINE",
    "TELEMEDICINA",
    "PRESENCIAL"
  ].some((phrase) => normalized.includes(phrase));
}

function extractProfessionalReference(text) {
  const source = normalizeSpaces(String(text || ""));
  const normalized = normalizeKey(source);

  if (/\bRODRIGO\s+VILLAGRAN\b|\bRODRIGO\s+VILLAGRA\b|\bDR\s+VILLAGRAN\b|\bDR\s+VILLAGRA\b|\bDOCTOR\s+VILLAGRAN\b|\bDOCTOR\s+VILLAGRA\b/.test(normalized)) {
    return { professionalName: "Rodrigo Villagran", matchType: "known" };
  }

  const titledMatch = source.match(/\b(?:dr|dra|doctor|doctora)\.?\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,3})/i);
  if (titledMatch) {
    return { professionalName: titleCaseWords(titledMatch[1]), matchType: "titled" };
  }

  const withConMatch = source.match(/\b(?:con|para)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i);
  if (withConMatch) {
    return { professionalName: titleCaseWords(withConMatch[1]), matchType: "con_phrase" };
  }

  return { professionalName: null, matchType: null };
}

function isKnownAgendaProfessional(name) {
  if (!name) return false;
  return KNOWN_AGENDA_PROFESSIONALS.has(normalizeKey(name));
}

function detectUnknownProfessionalScheduleRequest(text) {
  const { professionalName, matchType } = extractProfessionalReference(text);
  if (!professionalName) {
    return { shouldDerive: false, professionalName: null };
  }

  if (!hasScheduleIntent(text) && !hasExplicitScheduleIntent(text)) {
    return { shouldDerive: false, professionalName };
  }

  if (isKnownAgendaProfessional(professionalName)) {
    return { shouldDerive: false, professionalName };
  }

  if (matchType !== "titled") {
    return { shouldDerive: false, professionalName };
  }

  return {
    shouldDerive: true,
    professionalName
  };
}

function getUnknownProfessionalScheduleMessage(professionalName) {
  const intro = professionalName
    ? `Gracias. En esta franja horaria no tengo acceso a la agenda de ${professionalName}, así que voy a derivar tu conversación con una agente para que te ayude mejor.`
    : "Gracias. En esta franja horaria no tengo acceso a esa agenda, así que voy a derivar tu conversación con una agente para que te ayude mejor.";

  return [
    intro,
    "",
    `Si quieres revisar como alternativa, quizás encuentres disponibilidad en nuestra agenda web: ${MEDINET_AGENDA_WEB_URL}`
  ].join("\n");
}

function hasAgendaSpecialtyReference(text) {
  return !!extractCanonicalSpecialtyQuery(text);
}

function buildAntoniaFastPathCandidate(text, state) {
  const noFastPath = { shouldTry: false, reason: null, query: null, trigger: null };

  if (state.system.humanTakenOver || !state.system.aiEnabled) return noFastPath;

  const hasIntent = hasScheduleIntent(text) || hasExplicitScheduleIntent(text);

  const alias = extractKnownProfessionalAlias(text);
  // Trigger fast-path if professional is named AND (has schedule intent OR we're already in schedule_request stage)
  const inScheduleStage = state.identity?.lastResolvedStage === "schedule_request" ||
    state.booking?.awaitingSlotChoice || state.booking?.pendingProfessional;
  if (alias && (hasIntent || inScheduleStage)) {
    return { shouldTry: true, reason: "known_professional_alias", query: alias, trigger: "alias" };
  }

  if (!hasIntent && !inScheduleStage) return noFastPath;

  const specialty = extractCanonicalSpecialtyQuery(text);
  if (specialty) {
    return { shouldTry: true, reason: "schedule_intent_with_specialty", query: specialty, trigger: "specialty" };
  }

  const { professionalName, matchType } = extractProfessionalReference(text);
  if (professionalName && (matchType === "titled" || matchType === "con_phrase")) {
    const q = sanitizeMedinetProfessionalCandidate(professionalName) || professionalName.toLowerCase();
    return { shouldTry: true, reason: "schedule_intent_with_professional", query: q, trigger: "professional_ref" };
  }

  // Check cache for any professional name match even without explicit "con" phrase
  const sanitized = sanitizeMedinetProfessionalCandidate(text);
  if (sanitized) {
    const cacheHit = matchProfessionalFromCache(sanitized);
    if (cacheHit) {
      return { shouldTry: true, reason: "cache_professional_match", query: sanitized, trigger: "cache" };
    }
  }

  return noFastPath;
}

function detectExistingPatientIntent(text) {
  const normalized = normalizeKey(text);
  return [
    "YA SOY PACIENTE",
    "YA SOY CLIENTE",
    "YA ME ATENDI",
    "YA ME ATENDI CON USTEDES",
    "YA ME OPERE",
    "YA ME OPERE CON USTEDES",
    "YA TENGO FICHA",
    "TENGO FICHA",
    "SOY PACIENTE CLINYCO",
    "SOY PACIENTE"
  ].some((phrase) => normalized.includes(phrase));
}

function updateDraftsFromText(state, text, info) {
  const cleanText = String(text || "");
  const structured = parseStructuredLeadText(cleanText);

  const email = extractEmail(cleanText) || extractEmail(structured.email);
  if (email) state.contactDraft.c_email = email;

  const phone = extractPhone(cleanText) || normalizePhone(structured.phone_number);
  if (phone) {
    state.contactDraft.c_tel1 = phone;
    if (!state.contactDraft.c_tel2) {
      state.contactDraft.c_tel2 = phone;
    }
  }

  const rut = extractRut(cleanText);
  if (rut) {
    state.contactDraft.c_rut = formatRutHuman(rut) || rut;
    state.identity.verifiedRutAt = state.identity.verifiedRutAt || new Date().toISOString();
  }

  const dob = extractDate(cleanText);
  if (dob) state.contactDraft.c_fecha = dob;

  const address = extractAddress(cleanText);
  if (address) state.contactDraft.c_direccion = address;

  const preferredFullName = structured.full_name || extractName(cleanText);
  if (preferredFullName && isUsablePersonName(preferredFullName)) {
    const split = splitNames(preferredFullName);
    if (split.nombres) state.contactDraft.c_nombres = split.nombres;
    if (split.apellidos) state.contactDraft.c_apellidos = split.apellidos;
  }

  if (!state.contactDraft.c_nombres && isUsablePersonName(info?.authorDisplayName)) {
    const split = splitNames(info.authorDisplayName);
    if (split.nombres) state.contactDraft.c_nombres = split.nombres;
    if (split.apellidos) state.contactDraft.c_apellidos = split.apellidos;
  }

  const comuna = detectComuna(structured.city) || detectComuna(cleanText) || detectComuna(info?.authorDisplayName) || detectComuna(info?.sourceProfileName);
  if (comuna) {
    state.contactDraft.c_comuna = comuna;
    if (!state.dealDraft.dealSucursal) {
      const sucursal = detectSucursal(comuna);
      if (sucursal) state.dealDraft.dealSucursal = sucursal;
    }
  }

  const insuranceInfo = parseAseguradora(structured.insurance || cleanText);
  if (insuranceInfo?.negatedAseguradora === "FONASA" && state.contactDraft.c_aseguradora === "FONASA") {
    state.contactDraft.c_aseguradora = null;
    clearFonasaDerivedState(state);
  }
  if (insuranceInfo?.isIsapreGeneric && state.contactDraft.c_aseguradora === "FONASA") {
    state.contactDraft.c_aseguradora = null;
    clearFonasaDerivedState(state);
  }
  if (insuranceInfo?.aseguradora) {
    state.contactDraft.c_aseguradora = insuranceInfo.aseguradora;
    if (insuranceInfo.aseguradora !== "FONASA" && insuranceInfo.modalidad) {
      clearFonasaDerivedState(state);
      state.contactDraft.c_modalidad = insuranceInfo.modalidad;
    }
    if (insuranceInfo.aseguradora === "FONASA" && !parseFonasaTramo(cleanText)) {
      state.contactDraft.c_modalidad = null;
    }
  }

  const tramo = parseFonasaTramo(cleanText);
  if (tramo) {
    state.contactDraft.c_aseguradora = "FONASA";
    state.contactDraft.c_modalidad = tramo.modalidad;
    state.dealDraft.dealValidacionPad = tramo.isPadEligible
      ? "Posible evaluación PAD Fonasa"
      : "No aplica PAD Fonasa por Tramo A";
  } else if (state.contactDraft.c_aseguradora && state.contactDraft.c_aseguradora !== "FONASA") {
    clearFonasaDerivedState(state);
  }

  const structuredMeasurementText = structuredLeadToMeasurementText(structured);
  const bmiContext = buildBMIContext(structuredMeasurementText) || buildBMIContext(cleanText);
  if (bmiContext) {
    if (bmiContext.ambiguous) {
      state.measurements.pendingConfirmation = true;
      state.measurements.proposedWeightKg = bmiContext.weightKg;
      state.measurements.proposedHeightM = bmiContext.heightM;
      state.measurements.proposedHeightCm = bmiContext.heightCm;
    } else {
      applyConfirmedMeasurements(state, bmiContext);
    }
  }

  const procedure = detectProcedure(cleanText);
  if (procedure) {
    state.dealDraft.dealInteres = procedure.label;
    if (!state.dealDraft.dealPipelineId && procedure.pipelineId) {
      state.dealDraft.dealPipelineId = procedure.pipelineId;
    }
    if (procedure.key === "BALON" && !state.dealDraft.dealCirujanoBalon) {
      state.dealDraft.dealCirujanoBalon = "AUN NO LO DECIDE";
    }
    if (procedure.key === "BARIATRICA" && !state.dealDraft.dealCirujanoBariatrico) {
      state.dealDraft.dealCirujanoBariatrico = "AUN NO LO DECIDE";
    }
  }

  // Derive dealInteres from professional name when not already set
  if (!state.dealDraft.dealInteres) {
    const alias = extractKnownProfessionalAlias(cleanText);
    if (alias) {
      const cachedProf = matchProfessionalFromCache(alias);
      const specialty = cachedProf?.specialty || null;
      const derived = deriveDealInteresFromSpecialty(specialty, alias);
      if (derived) {
        state.dealDraft.dealInteres = derived;
        console.log(`Derived dealInteres="${derived}" from professional="${alias}" specialty="${specialty}"`);
      }
    }
  }

  if (detectExistingPatientIntent(cleanText)) {
    state.identity.saysExistingPatient = true;
  }
}

function applyConfirmedMeasurements(state, bmiContext) {
  state.measurements.weightKg = bmiContext.weightKg;
  state.measurements.heightM = bmiContext.heightM;
  state.measurements.heightCm = bmiContext.heightCm;
  state.measurements.bmi = bmiContext.bmi;
  state.measurements.bmiCategory = bmiContext.category;
  state.measurements.pendingConfirmation = false;
  state.measurements.proposedWeightKg = null;
  state.measurements.proposedHeightM = null;
  state.measurements.proposedHeightCm = null;
  state.dealDraft.dealPeso = String(bmiContext.weightKg);
  state.dealDraft.dealEstatura = String(bmiContext.heightCm);
}

// =========================
// Open-help conversational layer (Step 10)
// =========================
function ensureOpenHelpState(state) {
  if (!state.openHelp) {
    state.openHelp = { asked: false, askedAt: null, response: null, classifiedIntent: null };
  }
  return state.openHelp;
}

const CLEAR_INTENT_TOKENS = [
  "AGENDAR", "AGENDA", "HORA", "CIRUGIA", "MANGA", "BYPASS", "BALON", "GASTRICO",
  "CONSULTA", "CONTROL", "NUTRICION", "NUTRIOLOGIA", "PSICOLOGIA", "PSIQUIATRIA",
  "ENDOSCOPIA", "PLASTICA", "BARIATRICA", "ENDOCRINOLOGIA", "PAD", "FONASA", "ISAPRE",
  "PRESUPUESTO", "PRECIO", "COSTO", "VALOR", "OPERARME", "OPERAR", "EVALUACION",
  "EXAMEN", "EXAMENES", "BIOPSIA", "HOLTER", "LABORATORIO", "TELEMEDICINA", "ONLINE",
  "PRESENCIAL", "DERIVAR", "AGENTE", "HUMANO", "PERSONA"
];

function hasClearTopLevelIntent(text) {
  const nk = normalizeKey(text);
  return CLEAR_INTENT_TOKENS.some((t) => nk.includes(t)) || hasScheduleIntent(text) || hasAgendaSpecialtyReference(text);
}

function classifyOpenHelpIntent(text) {
  const nk = normalizeKey(text);
  const trimmed = nk.trim();
  if (trimmed === "1") return "schedule";
  if (trimmed === "2") return "orientation";
  if (trimmed === "3") return "existing_patient";
  if (trimmed === "4") return "human";
  if (/AGENDAR|AGENDA|HORA|RESERVAR|CITA/.test(nk)) return "schedule";
  if (/INFORMACION|ORIENTACION|PRECIO|VALOR|COSTO|PRESUPUESTO|COTIZAR/.test(nk)) return "orientation";
  if (/YA SOY PACIENTE|YA ME ATENDI|SEGUIMIENTO|CONTROL|MI OPERACION/.test(nk)) return "existing_patient";
  if (/EVALUAR|EVALUACION|PRIMERA VEZ|PRIMERA CONSULTA/.test(nk)) return "evaluation";
  if (/AGENTE|HUMANO|PERSONA|EJECUTIVA|DERIVAR/.test(nk)) return "human";
  return "unknown";
}

function shouldAskOpenHelpQuestion(state, userText) {
  ensureOpenHelpState(state);
  if (state.openHelp.asked) return false;
  if (state.system.botMessagesSent < 5) return false;
  if (hasClearTopLevelIntent(userText)) return false;
  if (state.dealDraft?.dealInteres || state.booking?.pendingProfessional || state.booking?.pendingSpecialty) return false;
  const resolvedStage = state.identity?.lastResolvedStage;
  if (resolvedStage === "schedule_request" || resolvedStage === "missing_insurance" || resolvedStage === "missing_modality" || resolvedStage === "missing_interest") return false;
  const insuranceInfo = parseAseguradora(userText);
  if (insuranceInfo?.aseguradora || insuranceInfo?.isIsapreGeneric) return false;
  return true;
}

function getOpenHelpQuestion() {
  return [
    "Noto que llevamos un rato conversando y quiero asegurarme de ayudarte bien.",
    "",
    "¿En qué te puedo ayudar hoy?",
    "1. Agendar una hora médica",
    "2. Información sobre procedimientos o precios",
    "3. Ya soy paciente y necesito seguimiento",
    "4. Hablar con una agente"
  ].join("\n");
}

function buildCalculatedDataBlock(state, originalText) {
  return [
    originalText,
    "",
    "[DATOS_CALCULADOS]",
    `peso_kg=${state.measurements.weightKg}`,
    `altura_m=${state.measurements.heightM}`,
    `altura_cm=${state.measurements.heightCm}`,
    `imc=${state.measurements.bmi}`,
    `categoria_imc=${state.measurements.bmiCategory}`
  ].join("\n");
}

function buildStateSummary(state) {
  const parts = [
    `[ESTADO_ACTUAL]`,
    `c_rut=${state.contactDraft.c_rut || ""}`,
    `c_nombres=${state.contactDraft.c_nombres || ""}`,
    `c_apellidos=${state.contactDraft.c_apellidos || ""}`,
    `c_fecha=${state.contactDraft.c_fecha || ""}`,
    `c_tel1=${state.contactDraft.c_tel1 || ""}`,
    `c_email=${state.contactDraft.c_email || ""}`,
    `c_aseguradora=${state.contactDraft.c_aseguradora || ""}`,
    `c_modalidad=${state.contactDraft.c_modalidad || ""}`,
    `c_direccion=${state.contactDraft.c_direccion || ""}`,
    `c_comuna=${state.contactDraft.c_comuna || ""}`,
    `dealInteres=${state.dealDraft.dealInteres || ""}`,
    `dealPipelineId=${state.dealDraft.dealPipelineId || ""}`,
    `dealSucursal=${state.dealDraft.dealSucursal || ""}`,
    `dealPeso=${state.dealDraft.dealPeso || ""}`,
    `dealEstatura=${state.dealDraft.dealEstatura || ""}`,
    `dealValidacionPad=${state.dealDraft.dealValidacionPad || ""}`,
    `bmi=${state.measurements.bmi || ""}`,
    `bmiCategory=${state.measurements.bmiCategory || ""}`,
    `customerId=${state.identity.customerId || ""}`,
    `matchStatus=${state.identity.matchStatus || ""}`,
    `matchedBy=${state.identity.matchedBy || ""}`,
    `isReturning=${state.customerMemory?.isReturning ? "si" : "no"}`,
    `saysExistingPatient=${state.identity.saysExistingPatient ? "si" : "no"}`,
    `sellContactFound=${state.identity.sellContactFound ? "si" : "no"}`,
    `sellDealFound=${state.identity.sellDealFound ? "si" : "no"}`,
    `foundInSupport=${state.identity.foundInSupport ? "si" : "no"}`,
    `likelyClinicalRecordOnly=${state.identity.likelyClinicalRecordOnly ? "si" : "no"}`,
    `botMessagesSent=${state.system.botMessagesSent}`
  ];

  if (state.identity.sellSummary) {
    parts.push(`[SELL_RESUMEN] ${state.identity.sellSummary}`);
  }

  if (state.identity.supportSummary) {
    parts.push(`[SUPPORT_RESUMEN] ${state.identity.supportSummary}`);
  }

  if (state.identity.caseType || state.identity.nextAction) {
    parts.push(`[RESOLVER] caseType=${state.identity.caseType || ""} nextAction=${state.identity.nextAction || ""}`);
  }

  if (state.identity.lastResolvedStage) {
    parts.push(`[RESOLVER_ETAPA] ${state.identity.lastResolvedStage}`);
  }

  if (Array.isArray(state.identity.lastMissingFields) && state.identity.lastMissingFields.length) {
    parts.push(`[RESOLVER_FALTANTES] ${state.identity.lastMissingFields.join(",")}`);
  }

  if (state.identity.lastQuestionReason) {
    parts.push(`[RESOLVER_MOTIVO] ${state.identity.lastQuestionReason}`);
  }

  return parts.join("\n");
}

function getMeasurementInstructionMessage() {
  return [
    "Para orientarte mejor, envíame por favor:",
    "• Peso en kilos, sin decimales",
    "• Estatura en metros, con punto o coma",
    "Ejemplo: 120 kg y 1.78 m"
  ].join("\n");
}

function getMeasurementConfirmationMessage(weightKg, heightM) {
  return [
    "Quiero confirmar los datos antes de continuar:",
    "",
    `Tu peso es ${weightKg} kilos y tu estatura ${heightM} metros. ¿Está correcto?`,
    "",
    "Responde:",
    "1 si",
    "2 no"
  ].join("\n");
}

function getCaseEMessage() {
  return [
    "Gracias. Si ya eres paciente Clínyco pero no encuentro tus datos con la búsqueda por RUT, es probable que estés registrado solo en ficha clínica y yo no tengo acceso a esa información.",
    "",
    "Una de nuestras agentes, enfermeras o nutricionistas, te puede ayudar mejor. Voy a derivar tu caso."
  ].join("\n");
}

function getMaxMessagesClosure() {
  return "Quedo atenta. Saludos, que tengas un muy buen día. Antonia 😊";
}

async function searchSellByRut(rut) {
  if (!ENABLE_SELL_SEARCH || !rut) {
    return null;
  }

  const endpoint = `${BOX_AI_BASE_URL}/api/search-rut`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rut })
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(`Box AI search-rut failed: ${response.status} ${raw}`);
  }

  return data;
}

function getZendeskSupportAuthHeader() {
  if (!ZENDESK_SUPPORT_EMAIL || !ZENDESK_SUPPORT_TOKEN) {
    return null;
  }
  return `Basic ${Buffer.from(`${ZENDESK_SUPPORT_EMAIL}/token:${ZENDESK_SUPPORT_TOKEN}`).toString("base64")}`;
}

async function zendeskSupportGet(path, params = {}) {
  if (!ZENDESK_SUBDOMAIN) {
    throw new Error("Missing ZENDESK_SUBDOMAIN");
  }

  const authHeader = getZendeskSupportAuthHeader();
  if (!authHeader) {
    throw new Error("Missing ZENDESK_SUPPORT_EMAIL or ZENDESK_SUPPORT_TOKEN");
  }

  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json"
    }
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(`Zendesk Support request failed: ${response.status} ${raw}`);
  }

  return data;
}

async function searchSupportByEmail(email) {
  if (!email) return [];
  const query = `type:user ${email}`;
  const data = await zendeskSupportGet("/api/v2/users/search.json", { query });
  return Array.isArray(data?.users) ? data.users : [];
}

async function searchSupportByPhone(phone) {
  if (!phone) return [];
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return [];
  const query = `role:end-user phone:*${digits}`;
  const data = await zendeskSupportGet("/api/v2/search.json", { query });
  return Array.isArray(data?.results) ? data.results.filter((item) => item?.result_type === "user") : [];
}

async function searchSupportByName(name) {
  if (!name) return [];
  const query = normalizeSpaces(name);
  if (!query) return [];
  const data = await zendeskSupportGet("/api/v2/users/search.json", { query });
  return Array.isArray(data?.users) ? data.users : [];
}

async function searchTicketsForUserIds(userIds) {
  const uniqueIds = Array.from(new Set((userIds || []).filter(Boolean))).slice(0, 3);
  const tickets = [];

  for (const userId of uniqueIds) {
    try {
      const data = await zendeskSupportGet("/api/v2/search.json", {
        query: `type:ticket requester_id:${userId}`,
        sort_by: "updated_at",
        sort_order: "desc"
      });
      const results = Array.isArray(data?.results) ? data.results.filter((item) => item?.result_type === "ticket") : [];
      tickets.push(...results.slice(0, 5));
    } catch (error) {
      console.error(`SUPPORT TICKET SEARCH ERROR for user ${userId}:`, error.message);
    }
  }

  const deduped = new Map();
  for (const ticket of tickets) {
    if (ticket?.id && !deduped.has(ticket.id)) {
      deduped.set(ticket.id, ticket);
    }
  }
  return Array.from(deduped.values()).sort((a, b) => {
    const ad = new Date(a?.updated_at || a?.created_at || 0).getTime();
    const bd = new Date(b?.updated_at || b?.created_at || 0).getTime();
    return bd - ad;
  });
}

async function searchSupportReal({ email, phone, name, channelDisplayName, sourceProfileName }) {
  if (!ENABLE_SUPPORT_SEARCH) {
    return null;
  }

  const usersById = new Map();

  const mergeUsers = (users) => {
    for (const user of users || []) {
      if (user?.id && !usersById.has(user.id)) {
        usersById.set(user.id, user);
      }
    }
  };

  if (email) {
    mergeUsers(await searchSupportByEmail(email));
  }

  if (phone) {
    mergeUsers(await searchSupportByPhone(phone));
  }

  if (!usersById.size && name) {
    mergeUsers((await searchSupportByName(name)).slice(0, 8));
  }

  if (!usersById.size && channelDisplayName) {
    mergeUsers((await searchSupportByName(channelDisplayName)).slice(0, 8));
  }

  if (!usersById.size && sourceProfileName) {
    mergeUsers((await searchSupportByName(sourceProfileName)).slice(0, 8));
  }

  const filteredUsers = filterSupportUsers(Array.from(usersById.values()), { email, phone, name, channelDisplayName, sourceProfileName });
  const tickets = filterSupportTickets(await searchTicketsForUserIds(filteredUsers.map((u) => u.id)));

  return {
    found: filteredUsers.length > 0 || tickets.length > 0,
    usersCount: filteredUsers.length,
    ticketsCount: tickets.length,
    latestTicketId: tickets[0]?.id || null,
    users: filteredUsers,
    tickets
  };
}

function updateStateFromSellSearch(state, sellData) {
  if (!sellData) return;

  state.identity.sellSearchCompleted = true;
  state.identity.sellContactFound = Boolean(sellData.contact || sellData.contacts_found > 0);
  state.identity.sellDealFound = Boolean(sellData.deal || sellData.deals_found_total > 0 || sellData.deals_found > 0);

  const summaryBits = [];
  if (state.identity.sellContactFound) summaryBits.push("contacto encontrado");
  if (state.identity.sellDealFound) summaryBits.push("deal encontrado");
  if (!summaryBits.length) summaryBits.push("sin coincidencias en Sell");
  state.identity.sellSummary = summaryBits.join(", ");

  const contact = sellData.contact || null;
  if (contact?.display_name && (!state.contactDraft.c_nombres || !state.contactDraft.c_apellidos)) {
    const split = splitNames(contact.display_name);
    if (!state.contactDraft.c_nombres && split.nombres) state.contactDraft.c_nombres = split.nombres;
    if (!state.contactDraft.c_apellidos && split.apellidos) state.contactDraft.c_apellidos = split.apellidos;
  }

  const deals = Array.isArray(sellData.deals) ? sellData.deals : [];
  if (!state.dealDraft.dealPipelineId && deals.length && deals[0]?.pipeline_id) {
    state.dealDraft.dealPipelineId = deals[0].pipeline_id;
  }
}

async function maybeRunIdentitySearch(state, info) {
  const rut = state.contactDraft.c_rut || null;
  const supportEmail = state.contactDraft.c_email || null;
  const supportPhone = state.contactDraft.c_tel1 || null;
  const supportName =
    [state.contactDraft.c_nombres, state.contactDraft.c_apellidos]
      .filter(Boolean)
      .join(" ")
      .trim() || null;
  const channelDisplayName = info?.authorDisplayName || null;
  const sourceProfileName = info?.sourceProfileName || null;

  // 1) SELL: solo si hay RUT
  if (ENABLE_SELL_SEARCH && rut) {
    const sameRut =
      state.identity.lastSellSearchRut === rut &&
      state.identity.sellSearchCompleted;

    if (!sameRut) {
      state.identity.lastSellSearchRut = rut;
      try {
        const sellData = await searchSellByRut(rut);
        state.identity.sellRaw = sellData || null;
        updateStateFromSellSearch(state, sellData);
      } catch (error) {
        console.error("SELL SEARCH ERROR:", error.message);
        state.identity.sellSearchCompleted = false;
        state.identity.sellSummary = `error_busqueda_sell: ${error.message}`;
      }
    }
  }

  // 2) SUPPORT: independiente del RUT
  if (!ENABLE_SUPPORT_SEARCH) {
    return;
  }

  const supportCandidates = {
    email: supportEmail,
    phone: supportPhone,
    name: supportName,
    channelDisplayName,
    sourceProfileName
  };

  const hasSupportInput = Object.values(supportCandidates).some(Boolean);
  if (!hasSupportInput) {
    return;
  }

  const supportSearchKey = JSON.stringify(supportCandidates);

  // Rebuscar solo si cambió la identidad conocida
  if (state.identity.lastSupportSearchKey === supportSearchKey) {
    return;
  }

  state.identity.lastSupportSearchKey = supportSearchKey;

  try {
    const supportData = await searchSupportReal(supportCandidates);

    state.identity.supportRaw = supportData || null;
    state.identity.supportSearchCompleted = true;
    state.identity.foundInSupport = Boolean(supportData?.found);
    state.identity.supportSummary = supportData?.found
      ? `usuarios_support=${supportData.usersCount}, tickets_support=${supportData.ticketsCount}, ultimo_ticket=${supportData.latestTicketId || ""}`
      : "sin coincidencias en Support";

    const firstUser = supportData?.users?.[0] || null;
    const supportHints = extractSupportIdentityHints(supportData);

    if (firstUser && supportData?.usersCount === 1) {
      if (!state.contactDraft.c_nombres || !state.contactDraft.c_apellidos) {
        const split = splitNames(firstUser.name || "");
        if (!state.contactDraft.c_nombres && split.nombres) {
          state.contactDraft.c_nombres = split.nombres;
        }
        if (!state.contactDraft.c_apellidos && split.apellidos) {
          state.contactDraft.c_apellidos = split.apellidos;
        }
      }
    }

    if (!state.contactDraft.c_email && supportHints.email) {
      state.contactDraft.c_email = supportHints.email;
    }

    if (!state.contactDraft.c_tel1 && supportHints.phone) {
      state.contactDraft.c_tel1 = supportHints.phone;
      if (!state.contactDraft.c_tel2) {
        state.contactDraft.c_tel2 = supportHints.phone;
      }
    }

    if (supportHints.rut) {
      state.identity.supportInferredRut = supportHints.rut;
    }
  } catch (error) {
    console.error("SUPPORT SEARCH ERROR:", error.message);
    state.identity.supportSearchCompleted = false;
    state.identity.supportSummary = `error_busqueda_support: ${error.message}`;
  }
}

function shouldTriggerCaseE(state) {
  return Boolean(
    state.identity.saysExistingPatient &&
    state.contactDraft.c_rut &&
    state.identity.sellSearchCompleted &&
    !state.identity.sellContactFound &&
    !state.identity.sellDealFound &&
    (!ENABLE_SUPPORT_SEARCH || state.identity.supportSearchCompleted) &&
    !state.identity.foundInSupport
  );
}

function shouldAskForFonasaTramo(state, latestUserText) {
  const key = normalizeKey(latestUserText || "");
  const parsed = parseAseguradora(latestUserText || "");
  const needsTramoForThisFlow =
    Boolean(state.dealDraft.dealInteres) ||
    ["PAD", "BONO", "COPAGO", "COBERTURA", "TRAMO"].some((phrase) => key.includes(phrase));

  if (!needsTramoForThisFlow) return false;
  if (parseFonasaTramo(latestUserText || "")) return false;
  if (parsed?.negatedAseguradora === "FONASA") return false;
  if (parsed?.aseguradora && parsed.aseguradora !== "FONASA") return false;
  if (parsed?.isIsapreGeneric) return false;
  return state.contactDraft.c_aseguradora === "FONASA" && !state.contactDraft.c_modalidad;
}

function shouldAskForSpecificAseguradora(state, latestUserText) {
  const key = normalizeKey(latestUserText || "");
  const parsed = parseAseguradora(latestUserText || "");
  const needsSpecificInsurance =
    Boolean(state.dealDraft.dealInteres) ||
    ["VALOR", "PRECIO", "COSTO", "COTIZ", "COBERTURA", "BONO", "ISAPRE"].some((phrase) => key.includes(phrase));
  if (!needsSpecificInsurance) return false;
  return Boolean(parsed?.isIsapreGeneric) && !normalizeAseguradoraValue(state.contactDraft.c_aseguradora);
}

function isMeasurementQuestionNeeded(state) {
  const interes = normalizeKey(state.dealDraft.dealInteres || "");
  const isWeightHeightRelevant = ["BALON GASTRICO", "CIRUGIA BARIATRICA"].includes(interes);
  return isWeightHeightRelevant && (!state.measurements.weightKg || !state.measurements.heightM);
}

function appendAntoniaIntroduction(state, reply) {
  if (state.system.botMessagesSent === 1 && !state.system.introducedAsAntonia) {
    state.system.introducedAsAntonia = true;
    return `Hola, hablas con Antonia 😊\n\n${reply}`;
  }
  return reply;
}

function buildResolverQuestionKey(decision) {
  if (!decision?.question) return null;
  const missing = Array.isArray(decision.missingFields) ? decision.missingFields.join(",") : "";
  return [decision.caseType || "", decision.nextAction || "", missing, decision.question].join("|");
}

function shouldUseResolverQuestion(state, decision, latestUserText = "") {
  if (!decision?.question) return false;
  if (!decision.shouldDerive) {
    const hasMissingFields = Array.isArray(decision.missingFields) && decision.missingFields.length > 0;
    const canAskIdentity =
      Array.isArray(decision.missingFields) &&
      decision.missingFields.includes("identity_min") &&
      Boolean(state?.identity?.saysExistingPatient);
    const canAskMeasurements =
      Array.isArray(decision.missingFields) &&
      decision.missingFields.some((field) => ["dealPeso", "dealEstatura"].includes(field));
    const isStrongResolverTurn =
      decision.caseType === "A" ||
      canAskIdentity ||
      canAskMeasurements;
    if (!hasMissingFields && !isStrongResolverTurn) return false;
    if (!isStrongResolverTurn && hasScheduleIntent(latestUserText)) return false;
    if (!isStrongResolverTurn) return false;
  }

  const key = buildResolverQuestionKey(decision);
  if (!key) return false;
  if (state.system.lastQuestionKey === key) return false;

  state.system.lastQuestionKey = key;
  return true;
}

function buildOpenAISystemPrompt() {
  return `
Eres Antonia, asistente de Clinyco.

Objetivo:
- contestar en forma amable, cercana y útil
- fidelizar al paciente
- extraer datos relevantes para contacto y deal
- no repetir preguntas ya respondidas
- avanzar paso a paso
- máximo 2 frases por respuesta
- hacer solo 1 pregunta a la vez
- no sonar como robot
- responder en español chileno neutral, profesional y cálido
- escucha la intención real antes de preguntar datos
- si la persona habla como humano normal, tú también debes responder como humano normal
- evita preguntas duras tipo flujo si ya entendiste la necesidad

Identidad:
- idealmente en tu segundo mensaje debes presentarte como Antonia
- no digas que eres una IA

Reglas operativas:
- no inventes precios
- no des diagnósticos médicos
- si ya sabemos previsión o aseguradora, no volver a preguntarla
- si ya sabemos interés/procedimiento, avanzar a la siguiente pregunta útil
- si ya sabemos teléfono, no volver a pedirlo
- si el usuario solo responde con una palabra, interpreta usando el contexto
- si el usuario pide hora, agenda, control, cambio de hora, cita o escribe "horita", entiende que está hablando de agenda aunque no use palabras perfectas
- si la persona pregunta por un doctor, una doctora, una especialidad o un control, no respondas con "¿Qué procedimiento o evaluación te interesa?" salvo que de verdad no haya contexto
- si recibes un bloque [MEMORIA_CLIENTE] tentativo, úsalo solo para orientar una pregunta breve de verificación
- mientras la identidad no esté confirmada, no reveles ni cites nombre, RUT, WhatsApp ni detalles históricos como si fueran datos confirmados del usuario actual
- no pidas RUT, correo o teléfono al inicio si todavía puedes orientar primero
- si el usuario ya entregó peso y estatura confirmados, usa el IMC disponible en el historial
- si el usuario pregunta por cirugía y aún no sabemos previsión, puedes preguntar si es Fonasa, Isapre o Particular
- si el usuario es Fonasa y aún no sabemos el tramo, debes pedir Tramo A, B, C o D
- si el usuario es Fonasa Tramo A, debes mencionar que el bono PAD no aplica; para tramos B, C o D sí puede aplicar según la prestación
- si el usuario dice Isapre pero no especifica cuál, debes preguntar la aseguradora exacta
- para peso y estatura, si necesitas pedirlos, usa esta pauta exacta:
  Para orientarte mejor, indícame por favor:\n• Peso en kilos, sin decimales\n• Estatura en metros, usando punto o coma\nEjemplo: 120 kg y 1.78 m
- si en el historial hay un bloque [DATOS_CALCULADOS], úsalo
- cuando informes el IMC, explica brevemente qué significa en lenguaje simple y aclara que es una referencia inicial, no un diagnóstico
- si el IMC sugiere sobrepeso u obesidad y el usuario consulta por balón o bariátrica, continúa guiando el proceso con naturalidad
- no pidas RUT de forma proactiva salvo que el usuario diga que ya es paciente o entregue el RUT por su cuenta
- si ya fue identificado un caso de derivación clínica, no sigas preguntando datos
- si preguntan por la agenda u hora de un profesional que no esté en la lista disponible, no inventes disponibilidad; indica que derivarás con una agente porque no tienes acceso a esa agenda en esta franja horaria y sugiere la agenda web ${MEDINET_AGENDA_WEB_URL}

Datos importantes:
- si quiere avanzar, cotizar, agendar o resolver su caso y ya tenemos teléfono, no vuelvas a pedirlo
- si ya tenemos teléfono, previsión, interés y los datos clínicos mínimos, prioriza una derivación clara con una agente en vez de seguir explorando
- no ofrezcas llamada telefónica por defecto si la persona no la pidió
- no ofrezcas horarios específicos si no tienes acceso real a agenda
- si la persona quiere avanzar y ya tenemos los datos principales, indica que dejarás su solicitud lista para coordinación con una agente y, como alternativa, comparte la agenda web
- si ya entregó teléfono y ya tenemos lo esencial, cierra cordialmente o deriva de forma clara
- si un profesional aparece como inactivo en la base de conocimiento, dilo con honestidad, explica el motivo si está disponible y usa el mensaje sugerido para cliente
- si la persona ya dijo lo que necesita y tú puedes orientar, responde primero y pregunta después solo si hace falta

${buildKnowledgePromptContext()}
`.trim();
}

async function askOpenAI({ systemPrompt, stateSummary, history }) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  if (!openai) {
    throw new Error("OpenAI client not initialized");
  }

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "system", content: stateSummary },
      ...history
    ]
  });

  return response.choices?.[0]?.message?.content?.trim() || "Gracias por escribirnos.";
}

async function sendConversationReply(appId, conversationId, reply) {
  if (!ZENDESK_SUBDOMAIN || !SUNCO_KEY_ID || !SUNCO_KEY_SECRET) {
    throw new Error("Missing ZENDESK_SUBDOMAIN or SUNCO credentials");
  }

  const auth = Buffer.from(`${SUNCO_KEY_ID}:${SUNCO_KEY_SECRET}`).toString("base64");

  const response = await fetch(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/sc/v2/apps/${appId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        author: { type: "business" },
        content: { type: "text", text: reply }
      })
    }
  );

  const raw = await response.text();
  console.log("Conversations send raw:", raw);

  if (!response.ok) {
    throw new Error(`Conversations send failed: ${raw}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { ok: true, rawResponse: raw };
  }
}

app.get("/", (req, res) => {
  res.send("Clinyco Conversations AI OK");
});

app.post("/admin/sync-knowledge", requireKnowledgeSyncKey, async (req, res) => {
  if (knowledgeSyncInProgress) {
    return res.status(409).json({ ok: false, error: "sync_in_progress" });
  }

  knowledgeSyncInProgress = true;
  try {
    const syncResult = await runKnowledgeSyncNow();
    const stdoutLines = tailLines(syncResult.stdout, 25);
    const stderrLines = tailLines(syncResult.stderr, 25);

    console.log("KNOWLEDGE_SYNC_OK", safeJson({
      durationMs: syncResult.durationMs,
      stdoutLines,
      stderrLines
    }));

    return res.json({
      ok: true,
      durationMs: syncResult.durationMs,
      stdoutLines,
      stderrLines
    });
  } catch (error) {
    const stdoutLines = tailLines(error?.stdout || "", 25);
    const stderrLines = tailLines(error?.stderr || "", 25);

    console.error("ERROR /admin/sync-knowledge:", error.message, safeJson({
      stdoutLines,
      stderrLines
    }));

    return res.status(500).json({
      ok: false,
      error: error.message,
      stdoutLines,
      stderrLines
    });
  } finally {
    knowledgeSyncInProgress = false;
  }
});


app.get("/debug/events", requireDebugKey, async (req, res) => {
  try {
    const events = await getDebugEvents(req.query.limit || 50);
    return res.json({ ok: true, events });
  } catch (error) {
    console.error("ERROR /debug/events:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/debug/conversation/:conversationId", requireDebugKey, async (req, res) => {
  try {
    const events = await getDebugConversationEvents(req.params.conversationId);
    return res.json({ ok: true, events });
  } catch (error) {
    console.error("ERROR /debug/conversation/:conversationId:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/debug/reset/:conversationId", requireDebugKey, async (req, res) => {
  try {
    const { conversationId } = req.params;
    conversationStates.delete(conversationId);
    conversationHistory.delete(conversationId);
    const pool = getDebugPool();
    if (pool) {
      await pool.query("DELETE FROM conversations WHERE conversation_id = $1", [conversationId]);
      await pool.query("DELETE FROM conversation_messages WHERE conversation_id = $1", [conversationId]);
    }
    console.log(`RESET conversation ${conversationId}`);
    return res.json({ ok: true, reset: conversationId });
  } catch (error) {
    console.error("ERROR /debug/reset:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/debug/health", requireDebugKey, async (req, res) => {
  try {
    const pool = getDebugPool();
    const db = pool ? "configured" : "memory_fallback";
    return res.json({ ok: true, db, origin: DEBUG_DASHBOARD_ORIGIN });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});



app.get("/support-search-test", async (req, res) => {
  try {
    if (!ENABLE_SUPPORT_SEARCH) {
      return res.status(400).json({ ok: false, error: "ENABLE_SUPPORT_SEARCH is false" });
    }

    const email = req.query.email ? String(req.query.email) : null;
    const phone = req.query.phone ? String(req.query.phone) : null;
    const name = req.query.name ? String(req.query.name) : null;

    const result = await searchSupportReal({ email, phone, name, channelDisplayName: null, sourceProfileName: null });
    return res.json({ ok: true, result });
  } catch (error) {
    console.error("ERROR /support-search-test:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/ticket-assigned", async (req, res) => {
  try {
    console.log("===== /ticket-assigned webhook =====");
    console.log("Body:", safeJson(req.body));

    const { event, conversation_id, assignee_id } = req.body || {};

    if (!conversation_id) {
      return res.status(400).json({ ok: false, error: "Missing conversation_id" });
    }

    await hydrateConversationCache(conversation_id);
    const state = getConversationState(conversation_id);
    state.system.aiEnabled = false;
    state.system.humanTakenOver = true;
    state.system.assigneeId = assignee_id || null;
    state.system.handoffReason = "ticket_assigned";

    console.log("AI disabled for conversation:", conversation_id);
    console.log("Conversation state:", safeJson(state));

    await saveConversationEvent({
      conversationId: conversation_id,
      info: {
        sourceType: "system",
        entryPoint: "ticket_assigned",
        authorDisplayName: null,
        channelDisplayName: null,
        sourceProfileName: null
      },
      channelLabel: "ticket_assigned",
      userText: null,
      botReply: null,
      state,
      resolverDecision: {
        nextAction: "blocked",
        caseType: state?.identity?.caseType || null,
        reason: "ticket_assigned",
        missingFields: state?.identity?.lastMissingFields || []
      }
    });

    await persistConversationSnapshot(conversation_id, state, null);
    await maybeSaveConversationSummary(conversation_id, state, "ticket_assigned");

    return res.json({
      ok: true,
      event: event || "human_takeover",
      conversation_id,
      aiEnabled: state.system.aiEnabled
    });
  } catch (error) {
    console.error("ERROR /ticket-assigned:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/messages", async (req, res) => {
  try {
    console.log("===== /messages webhook =====");
    console.log("Headers:", safeJson(req.headers));
    console.log("Body:", safeJson(req.body));

    const info = extractConversationInfo(req.body);
    const {
      appId,
      conversationId,
      userText,
      eventType,
      authorType,
      messageId,
      sourceType
    } = info;

    console.log("Extracted appId:", appId);
    console.log("Extracted conversationId:", conversationId);
    console.log("Extracted userText:", userText);
    console.log("Extracted eventType:", eventType);
    console.log("Extracted authorType:", authorType);
    console.log("Extracted messageId:", messageId);
    console.log("Extracted sourceType:", sourceType);

    if (eventType !== "conversation:message") {
      return res.json({ ok: true, skipped: "non_message_event" });
    }

    if (!conversationId) {
      return res.status(400).json({ ok: false, error: "Missing conversationId" });
    }

    await hydrateConversationCache(conversationId);
    const state = getConversationState(conversationId);
    const channelLabel = info.sourceType || info.entryPoint || null;
    updateIdentityChannelContext(state, info, channelLabel);

    if (authorType === "business" && isRealHumanBusinessTakeover(info)) {
      state.system.aiEnabled = false;
      state.system.humanTakenOver = true;
      state.system.handoffReason = "human_business_message_detected";
      console.log("AI disabled due to human business message:", conversationId);
      console.log("Business sourceType:", sourceType);

      await saveConversationEvent({
        conversationId,
        info,
        channelLabel: info.sourceType || info.entryPoint || null,
        userText: null,
        botReply: null,
        state,
        resolverDecision: {
          nextAction: "blocked",
          caseType: state?.identity?.caseType || null,
          reason: "human_business_message_detected",
          missingFields: state?.identity?.lastMissingFields || []
        }
      });

      await persistConversationSnapshot(conversationId, state, channelLabel);
      await maybeSaveConversationSummary(conversationId, state, channelLabel);
      return res.json({ ok: true, skipped: "human_business_message_detected" });
    }

    if (authorType !== "user") {
      return res.json({ ok: true, skipped: "non_user_message" });
    }

    if (!appId || !userText) {
      return res.json({ ok: true, skipped: "payload_not_parsed_yet" });
    }

    if (isRecentOutboundEcho(state, userText)) {
      await saveConversationEvent({
        conversationId,
        info,
        channelLabel,
        userText,
        botReply: null,
        state,
        resolverDecision: buildBlockedDecision(state, "recent_outbound_echo")
      });
      await persistConversationSnapshot(conversationId, state, channelLabel);
      return res.json({ ok: true, skipped: "recent_outbound_echo" });
    }

    await persistConversationSnapshot(conversationId, state, channelLabel);

    if (resumeSoftHandoffIfAllowed(state, userText)) {
      await persistConversationSnapshot(conversationId, state, channelLabel);
    }

    if (!state.system.aiEnabled) {
      console.log("AI blocked: disabled for", conversationId);
      await saveConversationEvent({
        conversationId,
        info,
        channelLabel,
        userText,
        botReply: null,
        state,
        resolverDecision: buildBlockedDecision(state, state?.system?.handoffReason || "ai_disabled")
      });
      await persistConversationSnapshot(conversationId, state, channelLabel);
      return res.json({ ok: true, skipped: "ai_disabled" });
    }

    if (state.system.botMessagesSent >= MAX_BOT_MESSAGES) {
      markMaxMessagesReached(state);
      await saveConversationEvent({
        conversationId,
        info,
        channelLabel,
        userText,
        botReply: null,
        state,
        resolverDecision: buildBlockedDecision(state, "max_bot_messages_reached")
      });
      await persistConversationSnapshot(conversationId, state, channelLabel);
      return res.json({ ok: true, skipped: "max_bot_messages_reached" });
    }

    const inboundClaimed = await claimInboundUserMessage({
      conversationId,
      messageId,
      channel: channelLabel,
      sourceType,
      content: userText,
      rawJson: info.rawMessage
    });

    if (!inboundClaimed) {
      await saveConversationEvent({
        conversationId,
        info,
        channelLabel,
        userText,
        botReply: null,
        state,
        resolverDecision: buildBlockedDecision(state, "duplicate_message")
      });
      return res.json({ ok: true, skipped: "duplicate_message" });
    }

    state.system.lastInboundMessageId = messageId || state.system.lastInboundMessageId || null;
    state.system.lastQuestionKey = null;

    updateDraftsFromText(state, userText, info);
    await ensureCustomerContext({
      conversationId,
      state,
      info,
      channelLabel,
      loadSummaries: true
    });
    await persistConversationSnapshot(conversationId, state, channelLabel);

    // --- Antonia booking slot choice interceptor ---
    if (state.booking.awaitingSlotChoice && state.booking.pendingSlots?.length) {
      const choice = detectBookingSlotChoice(userText, state.booking.pendingSlots);
      if (choice) {
        console.log("Antonia booking: patient chose slot", choice.index + 1, safeJson(choice.slot));
        state.booking.chosenSlot = choice.slot;
        state.booking.awaitingSlotChoice = false;

        const patientData = buildPatientDataFromState(state);
        const missing = getMissingBookingFields(patientData);

        if (missing.length > 0) {
          state.booking.awaitingPatientData = true;
          state.booking.missingFields = missing.map((f) => f.key);
          await persistConversationSnapshot(conversationId, state, channelLabel);

          const missingLabels = missing.map((f) => f.label).join(", ");
          const reply = `Perfecto, seleccionaste la hora ${choice.slot.time} del ${choice.slot.date}. Para completar la reserva necesito los siguientes datos: ${missingLabels}. Por favor envíamelos.`;
          addToHistory(conversationId, "user", userText);
          return res.json(await sendManagedReply({
            appId, conversationId, messageId, userText,
            reply,
            kind: "antonia_booking_collect_data",
            state, info, channelLabel,
            resolverDecision: {
              stage: "antonia_booking",
              nextAction: "collect_patient_data",
              reason: "Booking: collecting missing patient data"
            }
          }));
        }

        // All data available — execute booking
        try {
          console.log("Antonia booking: all data ready, executing booking...");
          // Save slot before clearing state to prevent race condition with concurrent requests
          const slotToBook = { ...choice.slot };
          // Clear booking state BEFORE the slow booking call to prevent duplicate attempts
          state.booking.pendingSlots = null;
          state.booking.awaitingSlotChoice = false;
          state.booking.awaitingPatientData = false;
          state.booking.awaitingConfirmation = false;
          state.booking.chosenSlot = null;
          state.booking.missingFields = null;
          await persistConversationSnapshot(conversationId, state, channelLabel);

          const bookingResult = await runMedinetAntoniaBooking({ slot: slotToBook, patientData });

          const reply = bookingResult?.patient_reply || "Hubo un error al procesar la reserva. Por favor intenta directamente en la agenda web.";
          addToHistory(conversationId, "user", userText);
          return res.json(await sendManagedReply({
            appId, conversationId, messageId, userText,
            reply,
            kind: "antonia_booking_result",
            state, info, channelLabel,
            resolverDecision: {
              stage: "antonia_booking",
              nextAction: "booking_completed",
              reason: "Booking completed by Antonia",
              bookingResult
            }
          }));
        } catch (error) {
          if (error.message?.includes("Executable doesn't exist")) {
            console.error("PLAYWRIGHT_MISSING: run 'npx playwright install chromium'");
          }
          console.error("ANTONIA BOOKING ERROR:", error.message);
          state.booking.pendingSlots = null;
          state.booking.awaitingSlotChoice = false;
          state.booking.awaitingConfirmation = false;
          state.booking.chosenSlot = null;
          state.booking.missingFields = null;
          await persistConversationSnapshot(conversationId, state, channelLabel);
          const errorReply = "Hubo un error al procesar la reserva. Por favor intenta directamente en la agenda web: https://clinyco.medinetapp.com/agendaweb/planned/";
          addToHistory(conversationId, "user", userText);
          return res.json(await sendManagedReply({
            appId, conversationId, messageId, userText,
            reply: errorReply,
            kind: "antonia_booking_error",
            state, info, channelLabel,
            resolverDecision: {
              stage: "antonia_booking",
              nextAction: "booking_error",
              reason: `Booking error: ${error.message}`
            }
          }));
        }
      }
    }

    // --- Antonia booking: user confirming or cancelling ---
    if (state.booking.awaitingConfirmation && state.booking.chosenSlot) {
      const normalized = normalizeKey(userText);
      const isConfirm = /^(si|sí|s[ií][\s,.]|ok|dale|confirmo|confirm[oa]r|yes|ya|1)\b/i.test(normalized);
      const isCancel = /^(no|cancel|cancelar|nop|nope|2)\b/i.test(normalized);

      if (isCancel) {
        state.booking.pendingSlots = null;
        state.booking.awaitingSlotChoice = false;
        state.booking.awaitingPatientData = false;
        state.booking.awaitingConfirmation = false;
        state.booking.chosenSlot = null;
        state.booking.missingFields = null;
        await persistConversationSnapshot(conversationId, state, channelLabel);
        addToHistory(conversationId, "user", userText);
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText,
          reply: "Reserva cancelada. Si necesitas agendar otra hora, solo avísame.",
          kind: "antonia_booking_cancelled",
          state, info, channelLabel,
          resolverDecision: {
            stage: "antonia_booking",
            nextAction: "booking_cancelled",
            reason: "User cancelled booking"
          }
        }));
      }

      if (!isConfirm) {
        // Not a clear yes/no — ask again
        addToHistory(conversationId, "user", userText);
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText,
          reply: "¿Confirmas la reserva? Responde *Sí* para confirmar o *No* para cancelar.",
          kind: "antonia_booking_confirm_retry",
          state, info, channelLabel,
          resolverDecision: {
            stage: "antonia_booking",
            nextAction: "await_confirmation",
            reason: "Booking: unclear confirmation response"
          }
        }));
      }

      // User confirmed — proceed to booking execution
      // (falls through to awaitingPatientData=false + awaitingConfirmation=true handling below)
    }

    // --- Antonia booking: patient providing missing data ---
    if ((state.booking.awaitingPatientData || state.booking.awaitingConfirmation) && state.booking.chosenSlot) {
      // If the only missing field is "direccion" and updateDraftsFromText didn't capture it,
      // treat the entire user text as the address (user naturally replies without "dirección:" prefix)
      if (!state.contactDraft.c_direccion && state.booking.missingFields) {
        const stillMissing = state.booking.missingFields;
        const onlyDireccionMissing = stillMissing.length === 1 && stillMissing[0] === "direccion";
        const textLooksLikeAddress = userText.trim().length >= 3 && !extractEmail(userText);
        if (onlyDireccionMissing && textLooksLikeAddress) {
          state.contactDraft.c_direccion = titleCaseWords(normalizeSpaces(userText.trim()));
        }
      }
      // Re-extract patient data (updateDraftsFromText may have captured new fields)
      const patientData = buildPatientDataFromState(state);
      const missing = getMissingBookingFields(patientData);

      if (missing.length > 0) {
        state.booking.missingFields = missing.map((f) => f.key);
        await persistConversationSnapshot(conversationId, state, channelLabel);

        const missingLabels = missing.map((f) => f.label).join(", ");
        const reply = `Gracias. Aún me falta: ${missingLabels}. Por favor envíamelos para completar tu reserva.`;
        addToHistory(conversationId, "user", userText);
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText,
          reply,
          kind: "antonia_booking_collect_data",
          state, info, channelLabel,
          resolverDecision: {
            stage: "antonia_booking",
            nextAction: "collect_patient_data",
            reason: "Booking: still collecting missing patient data"
          }
        }));
      }

      // All data collected — ask for confirmation before booking
      if (!state.booking.awaitingConfirmation) {
        state.booking.awaitingPatientData = false;
        state.booking.awaitingConfirmation = true;
        state.booking.missingFields = null;
        await persistConversationSnapshot(conversationId, state, channelLabel);

        const slot = state.booking.chosenSlot;
        const confirmReply = `Antes de confirmar, verifica tus datos:\n\n` +
          `- *Profesional:* ${state.booking.pendingProfessional || "—"}\n` +
          `- *Especialidad:* ${state.booking.pendingSpecialty || "—"}\n` +
          `- *Fecha:* ${slot.date || slot.dataDia || "—"}\n` +
          `- *Hora:* ${slot.time || "—"}\n` +
          `- *RUT:* ${patientData.rut}\n` +
          `- *Nombre:* ${patientData.nombres} ${patientData.apPaterno}\n` +
          `- *Fecha de nacimiento:* ${patientData.nacimiento}\n` +
          `- *Previsión:* ${patientData.prevision}\n` +
          `- *Email:* ${patientData.email}\n` +
          `- *Teléfono:* ${patientData.fono}\n` +
          `- *Dirección:* ${patientData.direccion}\n\n` +
          `¿Están correctos? (Sí / No)`;
        addToHistory(conversationId, "user", userText);
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText,
          reply: confirmReply,
          kind: "antonia_booking_confirm",
          state, info, channelLabel,
          resolverDecision: {
            stage: "antonia_booking",
            nextAction: "await_confirmation",
            reason: "Booking: all data collected, awaiting user confirmation"
          }
        }));
      }

      // All data collected — execute booking
      try {
        console.log("Antonia booking: data complete, executing booking...");
        // Save slot before clearing state to prevent race condition with concurrent requests
        const slotToBook = { ...state.booking.chosenSlot };
        // Clear booking state BEFORE the slow booking call to prevent duplicate attempts
        state.booking.pendingSlots = null;
        state.booking.awaitingSlotChoice = false;
        state.booking.awaitingPatientData = false;
        state.booking.awaitingConfirmation = false;
        state.booking.chosenSlot = null;
        state.booking.missingFields = null;
        await persistConversationSnapshot(conversationId, state, channelLabel);

        const bookingResult = await runMedinetAntoniaBooking({ slot: slotToBook, patientData });

        const reply = bookingResult?.patient_reply || "Hubo un error al procesar la reserva. Por favor intenta directamente en la agenda web.";
        addToHistory(conversationId, "user", userText);
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText,
          reply,
          kind: "antonia_booking_result",
          state, info, channelLabel,
          resolverDecision: {
            stage: "antonia_booking",
            nextAction: "booking_completed",
            reason: "Booking completed by Antonia",
            bookingResult
          }
        }));
      } catch (error) {
        if (error.message?.includes("Executable doesn't exist")) {
          console.error("PLAYWRIGHT_MISSING: run 'npx playwright install chromium'");
        }
        console.error("ANTONIA BOOKING ERROR:", error.message);
        state.booking.awaitingPatientData = false;
        state.booking.awaitingConfirmation = false;
        state.booking.chosenSlot = null;
        state.booking.pendingSlots = null;
        state.booking.missingFields = null;
        await persistConversationSnapshot(conversationId, state, channelLabel);
        const errorReply = "Hubo un error al procesar la reserva. Por favor intenta directamente en la agenda web: https://clinyco.medinetapp.com/agendaweb/planned/";
        addToHistory(conversationId, "user", userText);
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText,
          reply: errorReply,
          kind: "antonia_booking_error",
          state, info, channelLabel,
          resolverDecision: {
            stage: "antonia_booking",
            nextAction: "booking_error",
            reason: `Booking error: ${error.message}`
          }
        }));
      }
    }
    // --- End Antonia booking interceptor ---

    // --- Antonia fast-path (Step 8) ---
    let antoniaFastPathAttempted = false;
    const fastPathCandidate = buildAntoniaFastPathCandidate(userText, state);
    if (fastPathCandidate.shouldTry) {
      antoniaFastPathAttempted = true;

      // RUT is required to access MediNet agenda — ask for it if missing
      const patientRut = state.contactDraft?.c_rut;
      if (!patientRut) {
        // Store the professional/query so we can resume after getting RUT
        if (fastPathCandidate.query) {
          state.booking.pendingProfessional = state.booking.pendingProfessional || fastPathCandidate.query;
        }
        await persistConversationSnapshot(conversationId, state, channelLabel);
        const profName = fastPathCandidate.query || "el profesional";
        const rutReply = `Para buscar horas disponibles con ${profName} necesito tu RUT. ¿Me lo puedes indicar?`;
        addToHistory(conversationId, "user", userText);
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText,
          reply: rutReply,
          kind: "antonia_fast_path_need_rut",
          state, info, channelLabel,
          resolverDecision: {
            stage: "antonia_fast_path",
            nextAction: "need_rut_for_medinet",
            reason: `Fast-path needs RUT to search MediNet: ${fastPathCandidate.reason}`
          }
        }));
      }

      // Cache TTL check: refresh if stale (>30 min)
      if (isCacheStale()) {
        console.log("Medinet cache stale (>30 min), refreshing before fast-path...");
        await runMedinetAntoniaCache();
        KNOWN_AGENDA_PROFESSIONALS = buildKnownAgendaProfessionals();
      }

      // Try matching from cache first
      const cachedMatch = matchProfessionalFromCache(fastPathCandidate.query);
      if (cachedMatch) {
        console.log("Medinet cache match:", cachedMatch.name, "id:", cachedMatch.id);
      }

      try {
        console.log("Antonia fast-path triggered:", safeJson(fastPathCandidate));
        const antoniaResponse = await runMedinetAntonia({
          query: fastPathCandidate.query,
          patientPhone: info?.channelDisplayName || info?.authorDisplayName || "",
          patientMessage: userText,
          patientRut: state.contactDraft?.c_rut || ""
        });

        if (antoniaResponse?.patient_reply) {
          // Store available slots for booking flow
          if (antoniaResponse.available_slots?.length) {
            state.booking.pendingSlots = antoniaResponse.available_slots;
            state.booking.pendingProfessional = antoniaResponse.professional || null;
            state.booking.pendingSpecialty = antoniaResponse.specialty || null;
            state.booking.awaitingSlotChoice = true;
            state.booking.awaitingPatientData = false;
            state.booking.awaitingConfirmation = false;
            state.booking.chosenSlot = null;
            state.booking.missingFields = null;
            await persistConversationSnapshot(conversationId, state, channelLabel);
          }
          addToHistory(conversationId, "user", userText);
          return res.json(await sendManagedReply({
            appId,
            conversationId,
            messageId,
            userText,
            reply: antoniaResponse.patient_reply,
            kind: "antonia_fast_path_reply",
            state,
            info,
            channelLabel,
            resolverDecision: {
              stage: "antonia_fast_path",
              nextAction: "antonia_fast_path_reply",
              reason: `Fast-path Antonia: ${fastPathCandidate.reason}`,
              antoniaResponse
            }
          }));
        }
      } catch (error) {
        if (error.message?.includes("Executable doesn't exist")) {
          console.error("PLAYWRIGHT_MISSING: run 'npx playwright install chromium'");
        }
        console.error("ANTONIA FAST-PATH ERROR:", error.message);
      }
    }
    // --- End Antonia fast-path ---

    // Measurement confirmation flow first.
    if (state.measurements.pendingConfirmation) {
      if (isTruthyText(userText)) {
        const bmiContext = {
          weightKg: state.measurements.proposedWeightKg,
          heightM: state.measurements.proposedHeightM,
          heightCm: state.measurements.proposedHeightCm,
          bmi: calculateBMI(state.measurements.proposedWeightKg, state.measurements.proposedHeightM),
          category: getBMICategory(calculateBMI(state.measurements.proposedWeightKg, state.measurements.proposedHeightM))
        };
        applyConfirmedMeasurements(state, bmiContext);
        addToHistory(conversationId, "user", buildCalculatedDataBlock(state, userText));
      } else if (isFalsyText(userText)) {
        state.measurements.pendingConfirmation = false;
        state.measurements.proposedWeightKg = null;
        state.measurements.proposedHeightM = null;
        state.measurements.proposedHeightCm = null;
        addToHistory(conversationId, "user", userText);
        return res.json(await sendManagedReply({
          appId,
          conversationId,
          messageId,
          userText,
          reply: getMeasurementInstructionMessage(),
          kind: "measurement_instruction",
          state,
          info,
          channelLabel,
          resolverDecision: buildResolverQuestionDecision(state, "measurement_instruction")
        }));
      } else {
        addToHistory(conversationId, "user", userText);
        return res.json(await sendManagedReply({
          appId,
          conversationId,
          messageId,
          userText,
          reply: "Para confirmar, responde 1 si está correcto o 2 si no.",
          kind: "measurement_confirmation_prompt",
          state,
          info,
          channelLabel,
          resolverDecision: buildResolverQuestionDecision(state, "measurement_confirmation_prompt")
        }));
      }
    } else {
      // --- Bare-number weight/height fix (Step 7) ---
      const bareNumberMatch = userText.trim().match(/^(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kg|kgs|kilo|kilos|kilogramos?|cm|centimetros?|metros?|m|mt|mts)?\s*$/i);
      const lastMissing = state.identity.lastMissingFields || [];
      if (bareNumberMatch) {
        const rawNum = parseFloat(bareNumberMatch[1].replace(",", "."));
        const unitHint = (bareNumberMatch[0].match(/(?:kg|kgs|kilo|kilos|kilogramos?|cm|centimetros?|metros?|m|mt|mts)\s*$/i) || [""])[0].toLowerCase();
        const isWeightUnit = /^(kg|kgs|kilo|kilos|kilogramos?)$/.test(unitHint);
        const isHeightUnit = /^(cm|centimetros?|metros?|m|mt|mts)$/.test(unitHint);

        if ((lastMissing.includes("dealPeso") || isWeightUnit) && !isHeightUnit && rawNum >= 30 && rawNum <= 350) {
          state.dealDraft.dealPeso = String(rawNum);
          state.measurements.weightKg = rawNum;
          console.log("Bare-number weight fix: dealPeso =", rawNum);
        } else if ((lastMissing.includes("dealEstatura") || isHeightUnit) && !isWeightUnit) {
          if (rawNum >= 100 && rawNum <= 220) {
            state.dealDraft.dealEstatura = String(rawNum);
            state.measurements.heightCm = rawNum;
            state.measurements.heightM = Math.round((rawNum / 100) * 100) / 100;
            console.log("Bare-number height fix (cm): dealEstatura =", rawNum);
          } else if (rawNum >= 1.2 && rawNum <= 2.2) {
            state.measurements.heightM = rawNum;
            state.measurements.heightCm = Math.round(rawNum * 100);
            state.dealDraft.dealEstatura = String(state.measurements.heightCm);
            console.log("Bare-number height fix (m): dealEstatura =", state.measurements.heightCm);
          }
        }
      }
      // --- End bare-number fix ---

      const bmiSourceText = [userText, structuredLeadToMeasurementText(parseStructuredLeadText(userText))].filter(Boolean).join("\n");
      const bmiContext = buildBMIContext(bmiSourceText);
      if (bmiContext) {
        if (bmiContext.ambiguous) {
          state.measurements.pendingConfirmation = true;
          state.measurements.proposedWeightKg = bmiContext.weightKg;
          state.measurements.proposedHeightM = bmiContext.heightM;
          state.measurements.proposedHeightCm = bmiContext.heightCm;

          addToHistory(conversationId, "user", userText);
          return res.json(await sendManagedReply({
            appId,
            conversationId,
            messageId,
            userText,
            reply: getMeasurementConfirmationMessage(bmiContext.weightKg, bmiContext.heightM),
            kind: "measurement_confirmation_request",
            state,
            info,
            channelLabel,
            resolverDecision: buildResolverQuestionDecision(state, "measurement_confirmation_request")
          }));
        }

        applyConfirmedMeasurements(state, bmiContext);
        addToHistory(conversationId, "user", buildCalculatedDataBlock(state, userText));
        console.log("BMI detected:", safeJson(bmiContext));
      } else {
        addToHistory(conversationId, "user", userText);
      }
    }

    const unknownProfessionalSchedule = detectUnknownProfessionalScheduleRequest(userText);
    if (unknownProfessionalSchedule.shouldDerive) {
      return res.json(await sendManagedReply({
        appId,
        conversationId,
        messageId,
        userText,
        reply: getUnknownProfessionalScheduleMessage(unknownProfessionalSchedule.professionalName),
        kind: "unknown_professional_schedule",
        state,
        info,
        channelLabel,
        resolverDecision: buildBlockedDecision(state, "unknown_professional_schedule", "derive"),
        disableAiAfterSend: true,
        handoffReasonAfterSend: "unknown_professional_schedule"
      }));
    }

    // --- Open-help layer (Step 11) ---
    ensureOpenHelpState(state);
    if (state.openHelp.asked && !state.openHelp.classifiedIntent) {
      state.openHelp.response = userText;
      state.openHelp.classifiedIntent = classifyOpenHelpIntent(userText);
      console.log("Open-help classified:", state.openHelp.classifiedIntent);

      if (state.openHelp.classifiedIntent === "human") {
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText,
          reply: "Perfecto, te derivo con una agente. Un momento por favor.",
          kind: "open_help_derive_human",
          state, info, channelLabel,
          resolverDecision: buildBlockedDecision(state, "open_help_derive", "derive"),
          disableAiAfterSend: true,
          handoffReasonAfterSend: "open_help_derive"
        }));
      }
    }

    if (shouldAskOpenHelpQuestion(state, userText)) {
      state.openHelp.asked = true;
      state.openHelp.askedAt = new Date().toISOString();
      return res.json(await sendManagedReply({
        appId, conversationId, messageId, userText,
        reply: getOpenHelpQuestion(),
        kind: "open_help_question",
        state, info, channelLabel,
        resolverDecision: buildResolverQuestionDecision(state, "open_help_question")
      }));
    }
    // --- End open-help layer ---

    await maybeRunIdentitySearch(state, info);
    const customerMemory = await ensureCustomerContext({
      conversationId,
      state,
      info,
      channelLabel,
      loadSummaries: true
    });

    if (shouldTriggerCaseE(state)) {
      state.identity.likelyClinicalRecordOnly = true;
      return res.json(await sendManagedReply({
        appId,
        conversationId,
        messageId,
        userText,
        reply: getCaseEMessage(),
        kind: "case_e",
        state,
        info,
        channelLabel,
        resolverDecision: buildBlockedDecision(state, "clinical_record_only", "derive"),
        disableAiAfterSend: true,
        handoffReasonAfterSend: "clinical_record_only"
      }));
    }

    if (shouldAskForFonasaTramo(state, userText)) {
      return res.json(await sendManagedReply({
        appId,
        conversationId,
        messageId,
        userText,
        reply: "Perfecto. ¿Me indicas tu tramo de Fonasa? Puede ser A, B, C o D.",
        kind: "ask_fonasa_tramo",
        state,
        info,
        channelLabel,
        resolverDecision: buildResolverQuestionDecision(state, "missing_fonasa_tramo")
      }));
    }

    if (shouldAskForSpecificAseguradora(state, userText)) {
      return res.json(await sendManagedReply({
        appId,
        conversationId,
        messageId,
        userText,
        reply: "Perfecto. ¿Qué aseguradora tienes? Por ejemplo Banmédica, Colmena, Consalud o Cruz Blanca.",
        kind: "ask_specific_aseguradora",
        state,
        info,
        channelLabel,
        resolverDecision: buildResolverQuestionDecision(state, "missing_specific_aseguradora")
      }));
    }

    if (state.contactDraft.c_modalidad === "Tramo A" && !/TRAMO A/i.test(state.dealDraft.dealValidacionPad || "")) {
      state.dealDraft.dealValidacionPad = "No aplica PAD Fonasa por Tramo A";
    }

    const resolverContext = resolveIdentityAndContext({
      state,
      supportResult: state.identity.supportRaw,
      sellResult: state.identity.sellRaw,
      latestUserText: userText
    });
    const resolverDecision = getNextBestQuestion(
      state,
      state.identity.supportRaw,
      state.identity.sellRaw,
      userText
    );

    applyResolverToState(state, resolverDecision);
    console.log("Resolver context:", safeJson(resolverContext));
    console.log("Resolver decision:", safeJson(resolverDecision));

    const unknownScheduleRequest = detectUnknownProfessionalScheduleRequest(userText);
    const hardDerive =
      resolverDecision.shouldDerive && (
        resolverDecision.caseType === "E" ||
        /clinical_record_only|ficha clinica|ficha clínica/i.test(String(resolverDecision.reason || "")) ||
        unknownScheduleRequest.shouldDerive
      );

    if (!antoniaFastPathAttempted && resolverContext.stage === "agenda_without_direct_access") {
      try {
        const medinetQuery = extractMedinetQuery(userText);
        const antoniaResponse = await runMedinetAntonia({
          query: medinetQuery,
          patientPhone: info?.channelDisplayName || info?.authorDisplayName || "",
          patientMessage: userText
        });

        if (antoniaResponse?.patient_reply) {
          // Store available slots for booking flow
          if (antoniaResponse.available_slots?.length) {
            state.booking.pendingSlots = antoniaResponse.available_slots;
            state.booking.pendingProfessional = antoniaResponse.professional || null;
            state.booking.pendingSpecialty = antoniaResponse.specialty || null;
            state.booking.awaitingSlotChoice = true;
            state.booking.awaitingPatientData = false;
            state.booking.awaitingConfirmation = false;
            state.booking.chosenSlot = null;
            state.booking.missingFields = null;
            await persistConversationSnapshot(conversationId, state, channelLabel);
          }
          return res.json(await sendManagedReply({
            appId,
            conversationId,
            messageId,
            userText,
            reply: antoniaResponse.patient_reply,
            kind: "antonia_medinet_reply",
            state,
            info,
            channelLabel,
            resolverDecision: {
              ...resolverDecision,
              nextAction: "antonia_medinet_reply",
              reason: "Agenda resuelta por Antonia Medinet",
              antoniaResponse
            }
          }));
        }
      } catch (error) {
        if (error.message?.includes("Executable doesn't exist")) {
          console.error("PLAYWRIGHT_MISSING: run 'npx playwright install chromium'");
        }
        console.error("ANTONIA MEDINET ERROR:", error.message);
      }
    }

    if (resolverDecision.shouldDerive && !hardDerive) {
      resolverDecision.shouldDerive = false;
    }

    if (hardDerive) {
      return res.json(await sendManagedReply({
        appId,
        conversationId,
        messageId,
        userText,
        reply: resolverDecision.question,
        kind: "resolver_derive",
        state,
        info,
        channelLabel,
        resolverDecision,
        disableAiAfterSend: true,
        handoffReasonAfterSend: resolverDecision.caseType === "E" ? "clinical_record_only" : "resolver_derive"
      }));
    }

    if (shouldUseResolverQuestion(state, resolverDecision, userText)) {
      return res.json(await sendManagedReply({
        appId,
        conversationId,
        messageId,
        userText,
        reply: resolverDecision.question,
        kind: "resolver_question",
        state,
        info,
        channelLabel,
        resolverDecision
      }));
    }

    console.log("Conversation history:", safeJson(getHistory(conversationId)));
    console.log("Conversation state:", safeJson(state));

    const history = getHistory(conversationId);
    const customerContextBlock = customerMemory?.customerContextBlock || null;
    const stateSummary = [buildStateSummary(state), customerContextBlock].filter(Boolean).join("\n\n");
    const systemPrompt = buildOpenAISystemPrompt();

    let reply = await askOpenAI({
      systemPrompt,
      stateSummary,
      history
    });

    const isTenthMessage = state.system.botMessagesSent + 1 >= MAX_BOT_MESSAGES;
    if (isTenthMessage) {
      const closure = getMaxMessagesClosure();
      reply = `${reply}\n\n${closure}`;
    }

    const openAiResult = await sendManagedReply({
      appId,
      conversationId,
      messageId,
      userText,
      reply,
      kind: "openai_reply",
      state,
      info,
      channelLabel,
      resolverDecision: buildResolverQuestionDecision(state, "openai_reply")
    });

    if (openAiResult.ok && !openAiResult.skipped) {
      openAiResult.contactDraft = getConversationState(conversationId).contactDraft;
      openAiResult.dealDraft = getConversationState(conversationId).dealDraft;
    }

    return res.json(openAiResult);
  } catch (error) {
    console.error("ERROR /messages:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
await initDb();
app.listen(PORT, () => {
  console.log(`Clinyco Conversations AI running on port ${PORT}`);
  console.log(`Database persistence: ${dbEnabled() ? "enabled" : "disabled"}`);
});
