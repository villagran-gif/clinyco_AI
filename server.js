import { requestedExam, publishedExamProfessionals, examFollowup, EXAM_HANDOFF } from "./melania/exam-policy.js";
import { publishedProfessionals, publishedSlots, reservePublishedSlot, UNAVAILABLE } from "./melania/agendaweb-only.js";
import { bookAgendaweb } from "./Antonia/medinet-api.js";
import { isEndoscopyBooking, ENDOSCOPY_HANDOFF } from "./melania/booking-policy.js";
import express from "express";
import { runModelBooking } from "./conversation/model-booking.js";
import { conversationPrompt, conversationContext, parseConversationDecision, applyConversationFacts, recentConversationHistory } from "./conversation/model-conversation.js";
import { controlKey, createControlStore, ControlError } from "./conversation/control.js";
const antoniaControl = createControlStore(getControlPool);
import OpenAI from "openai";
import { antoniaAIConfig, createAntoniaClient, CHILEAN_STYLE } from "./analysis/antonia-provider.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, readFileSync, writeFileSync, constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { initLogger, wrapOpenAI } from "braintrust";
import { getNextBestQuestion } from "./conversation-resolver.js";
import {
  getPool as getControlPool,
  dbEnabled,
  initDb,
  getConversationRecord,
  getRecentConversationMessages,
  getRecentCompleteConversationHistory,
  upsertConversationState,
  insertConversationMessage,
  upsertStructuredLead,
  buildCustomerProfile,
  upsertCustomer,
  linkConversationToCustomer,
  addCustomerChannel,
  getCustomerSummaries,
  trackLeadScoreChange,
  getLeadScoreHistory,
  getEmojiSentimentBatch
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
  formatRutHuman as formatValidatedRutHuman,
  normalizeRut
} from "./extraction/identity-normalizers.js";
import { calculateLeadScore } from "./scoring/lead-score.js";
import {
  inferBestNextAction,
  onHumanAgentMessage as onEugeniaHumanAgentMessage,
  onMutedPatientMessage as onEugeniaMutedPatientMessage
} from "./eugenia/index.js";
import { createMelaniaHandoffRouter } from "./melania/handoff-router.js";
import { isChatwootPayload, parseChatwootInbound } from "./chatwoot-adapter/parse.js";
import { recordContactEvent } from "./review/crm-links.js";
import { startCrmSync } from "./review/crm-sync.js";
import { getPool as getCrmPool } from "./review/db.js";
import { recordAIUsage } from "./review/ai-usage.js";
import { createReviewer, reviewErrorCode } from "./antonia-improvements/reviewer.js";
import { startDailyProfessionalAgenda } from './review/medinet-professional-agenda.js';
import { startImprovementReviews } from "./antonia-improvements/scheduler.js";
import { registerImprovementApp } from "./antonia-improvements/chatwoot-app.js";
import { runConfiguredSellRestore } from "./review/sell-restore.js";
import { sendChatwootReply, sendChatwootAttachment } from "./chatwoot-adapter/client.js";
import { maybeSyncPrivateLeadNote } from "./chatwoot-adapter/private-lead-note.js";
import reviewRouter from "./review/router.js";
import { start as startFonasapadCron } from "./queue/cron.js";
import { start as startMonthlyCron } from "./queue/monthly-cron.js";
import { analyzeMessage as analyzeSentiment } from "./analysis/sentiment.js";
import {
  searchSlotsViaApi,
  searchSlotsNoAuth,
  buildCacheFromApi,
  formatRutWithDots,
  bookAppointmentForPatient as apiBookAppointment,
  checkCupos,
  DEFAULT_BRANCH_ID,
} from "./Antonia/medinet-api.js";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use("/api/review", reviewRouter);
app.use("/melania", createMelaniaHandoffRouter());

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
const conversationProcessingLocks = new Map(); // per-conversation mutex to serialize message processing

// =========================
// Config
// =========================
const { provider: ANTONIA_AI_PROVIDER, model: ANTONIA_MODEL } = antoniaAIConfig();
const ANTONIA_CONVERSATION_MODEL = process.env.ANTONIA_CONVERSATION_MODEL || (ANTONIA_AI_PROVIDER === "anthropic" ? "claude-opus-5" : ANTONIA_MODEL);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY || null;
const BRAINTRUST_PROJECT_NAME = process.env.BRAINTRUST_PROJECT_NAME || "Clinyco AI - Dev";
const ANTONIA_AUDIO_ENABLED = process.env.ANTONIA_AUDIO_ENABLED === "true";
const ANTONIA_AUDIO_MODEL = process.env.ANTONIA_AUDIO_MODEL || "gpt-4o-mini-tts";
const ANTONIA_AUDIO_VOICE = process.env.ANTONIA_AUDIO_VOICE || "coral";


const MAX_HISTORY_MESSAGES = 14;
// 0 = sin límite artificial de turnos. Si alguna vez se necesita un tope de seguridad,
// puede configurarse explícitamente en Render sin cambiar código.
const MAX_BOT_MESSAGES = Math.max(0, Number(process.env.ANTONIA_MAX_BOT_MESSAGES || 0));

function botMessageLimitReached(count) {
  return MAX_BOT_MESSAGES > 0 && Number(count || 0) >= MAX_BOT_MESSAGES;
}
const INBOUND_DEDUPE_TTL_MS = 2 * 60 * 1000;
const OUTBOUND_DEDUPE_WINDOW_MS = 45 * 1000;
const MEDINET_AGENDA_WEB_URL = "https://clinyco.medinetapp.com/agendaweb/planned/";
const MEDINET_RUT = process.env.MEDINET_RUT || "13580388k";
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

// Remote worker support: when MEDINET_WORKER_URL is set, delegate to the remote worker
// instead of running Playwright locally (useful when Medinet blocks the server's IP)
const MEDINET_WORKER_URL = (process.env.MEDINET_WORKER_URL || "").replace(/\/+$/, "");
const MEDINET_WORKER_TOKEN = process.env.MEDINET_WORKER_TOKEN || "";

async function callMedinetWorkerPath(path, body = {}, timeoutMs = 60000) {
  if (!MEDINET_WORKER_URL || !MEDINET_WORKER_TOKEN) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 5000);

  try {
    const res = await fetch(`${MEDINET_WORKER_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MEDINET_WORKER_TOKEN}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.error(`[medinet-worker-remote] ${path} HTTP ${res.status}:`, bodyText.slice(0, 300));
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error(`[medinet-worker-remote] ${path} error:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callMedinetWorkerLegacy(action, payload = {}, timeoutMs = 60000) {
  return callMedinetWorkerPath("/medinet/run", {
    action,
    payload: { ...payload, timeoutMs }
  }, timeoutMs);
}

async function callMedinetWorkerApiSearch(payload = {}, timeoutMs = 60000) {
  return callMedinetWorkerPath("/medinet/api/search", payload, timeoutMs);
}

async function callMedinetWorkerApiBook(payload = {}, timeoutMs = 60000) {
  return callMedinetWorkerPath("/medinet/api/book", payload, timeoutMs);
}

function useRemoteWorker() {
  return !!(MEDINET_WORKER_URL && MEDINET_WORKER_TOKEN);
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
  const timeoutMs = Number(process.env.MEDINET_ANTONIA_TIMEOUT_MS || 60000);

  // ── 1. Try REST API cache build (no browser, no IP blocking) ──
  if (process.env.MEDINET_API_TOKEN) {
    try {
      console.log("[medinet-api] Building cache via REST API...");
      const apiCache = await buildCacheFromApi();
      if (apiCache && apiCache.professionals?.length > 0) {
        writeFileSync(MEDINET_CACHE_FILE, JSON.stringify(apiCache, null, 2), "utf8");
        console.log(`[medinet-api] Cache built via API: ${apiCache.professionals.length} professionals`);
        return true;
      }
    } catch (apiError) {
      console.warn("[medinet-api] API cache build failed, falling through:", apiError.message);
    }
  }

  // ── 2. Try remote Playwright worker ──
  if (useRemoteWorker()) {
    console.log("[medinet] Cache refresh via remote worker:", MEDINET_WORKER_URL);
    const result = await callMedinetWorkerLegacy("cache", {}, timeoutMs);
    if (result !== null) {
      console.log("MEDINET CACHE REFRESH completed (remote worker)");
      return true;
    }
    console.warn("[medinet] Remote worker cache failed, falling back to local");
  }

  // ── 3. Local Playwright (last resort) ──
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

async function loadPublishedAgendaweb() {
  const result = await callMedinetWorkerPath("/melania/availability", {}, 60000);
  if (result?.success !== true || !Array.isArray(result.professionals)) throw new Error("agendaweb_unavailable");
  return publishedProfessionals(result.professionals);
}

async function runMedinetAntonia({ query, branchId, professionalId }) {
  try {
    const slots = publishedSlots(await loadPublishedAgendaweb(), {query,branchId,professionalId}).slice(0,6);
    return { source:"agendaweb", professional:slots[0]?.professional || query,
      specialty:slots[0]?.specialty || "", available_slots:slots,
      patient_reply: slots.length ? "Cupos publicados en Agenda Web:\n\n" + slots.map((s,i)=>
        (i+1)+". "+s.date+" a las "+s.time+" con "+s.professional+" — "+s.branchName).join("\n") :
        "No encontré cupos publicados en Agenda Web para esa búsqueda." };
  } catch {
    return {source:"agendaweb",available_slots:[],patient_reply:UNAVAILABLE};
  }
}

async function runMedinetAntoniaBooking({slot,patientData,info}) {
  try {
    return await reservePublishedSlot({slot, patientData:{...patientData,rut:formatRutWithDots(patientData.rut || patientData.run || "")},
      load:loadPublishedAgendaweb,check:checkCupos,post:async payload => {
        const receipt = await antoniaControl.send(info.controlKey, info.controlRevision, 'booking', async () => {
          const value = await bookAgendaweb(payload);
          return { confirmed: value?.status === 'agendado_correctamente', value };
        });
        return receipt.value;
      }});
  } catch {
    return {success:false,step:"booking_unconfirmed",message:UNAVAILABLE,
      patient_reply:"No pude confirmar la reserva. El equipo debe verificar Medinet antes de reintentar."};
  }
}

function detectBookingSlotChoice(text, availableSlots) {
  if (!availableSlots || !availableSlots.length) return null;
  const cleaned = String(text || "").trim();

  // Detect explicit "salir" / "cancelar" / "no quiero"
  if (/^(salir|cancelar|no\s*quiero|ninguna|no\s*gracias)$/i.test(cleaned)) {
    return { exit: true };
  }

  // Match patterns: "1", "la 1", "opcion 1", "hora 1", "numero 1", "quiero la 1", etc.
  const numberMatch = cleaned.match(/(?:^|\s)(\d)(?:\s|$|[.,;!?])/);
  const directMatch = cleaned.match(/^(\d)$/);
  const phraseMatch = cleaned.match(/(?:la|opcion|hora|numero|n[uú]mero|quiero|elijo|prefiero)\s*(\d)/i);

  const choiceStr = directMatch?.[1] || phraseMatch?.[1] || numberMatch?.[1];
  if (!choiceStr) return null;

  const index = parseInt(choiceStr, 10) - 1;

  // The "Salir" option is slots.length (last number in the list)
  if (index === availableSlots.length) {
    return { exit: true };
  }

  if (index < 0 || index >= availableSlots.length) return null;

  return { index, slot: availableSlots[index] };
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
    { key: "email", label: "correo electrónico" },
    { key: "fono", label: "teléfono" }
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
const antoniaAI = createAntoniaClient({ openai });
console.info("[antonia-ai]", JSON.stringify({ provider: ANTONIA_AI_PROVIDER, model: ANTONIA_MODEL, conversationModel: ANTONIA_CONVERSATION_MODEL, configured: Boolean(antoniaAI) }));


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

// Per-conversation mutex: ensures only one message is processed at a time per conversation.
// Prevents race conditions when the user sends multiple messages rapidly.
function acquireConversationLock(conversationId) {
  const existing = conversationProcessingLocks.get(conversationId) || Promise.resolve();
  let releaseFn;
  const newLock = new Promise((resolve) => { releaseFn = resolve; });
  // Chain: wait for previous processing to finish before this one starts
  const ready = existing.then(() => {});
  conversationProcessingLocks.set(conversationId, newLock);
  return { ready, release: releaseFn };
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

const NOT_A_PERSON_NAME = new Set([
  "FONASA", "ISAPRE", "BANMEDICA", "COLMENA", "CONSALUD", "CRUZ BLANCA",
  "ESENCIAL", "DIPRECA", "PARTICULAR", "MASVIDA", "VIDATRES", "MEDIMEL",
  "PACIENTE", "CLIENTE", "USUARIO", "HOMBRE", "MUJER", "MAMA", "PAPA",
  "DOCTOR", "DOCTORA", "NUTRIOLOGA", "NUTRICIONISTA", "KINESIOLOGA"
]);

function extractName(text) {
  const source = normalizeSpaces(String(text || ""));
  const match = source.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,3})/i);
  if (!match) return null;
  const candidate = match[1].trim();
  const firstWord = candidate.split(/\s+/)[0].toUpperCase();
  if (NOT_A_PERSON_NAME.has(firstWord)) return null;
  return titleCaseWords(candidate);
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







function isStillLatestUserMessage(conversationId, expectedMessageId) {
  if (!expectedMessageId) return true;
  const latestState = getConversationState(conversationId);
  return latestState?.system?.lastInboundMessageId === expectedMessageId;
}

function isRealHumanBusinessTakeover(info) {
  return info?.transport === "chatwoot" && !!info?.isHumanAgent;
}


function clearSoftHandoffState(state) {
  state.system.aiEnabled = true;
  state.system.humanTakenOver = false;
  state.system.humanPauseUntil = null;
  if (state.system.handoffReason === "max_bot_messages_reached" && MAX_BOT_MESSAGES > 0) {
    state.system.botMessagesSent = Math.max(0, MAX_BOT_MESSAGES - 1);
  }
  state.system.handoffReason = null;
  state.system.lastQuestionKey = null;
}

function resumeSoftHandoffIfAllowed(state, latestUserText) {
  if (state.system.aiEnabled) return false;

  if (state.system.humanTakenOver) return false;

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
  // Match explicit "dirección: ..." prefix — stop at next emoji label, newline, or end
  const match = source.match(/(?:direccion|dirección)\s*:?\s*(.+?)(?=\s*(?:[🏙📱📧🎂🏥🩺🆔👤]|ciudad\s*:|celular\s*:|correo\s*:|fecha\s*:|previsi[oó]n\s*:|tramo\s*:|rut\s*:|nombre\s*:|apellido\s*:|$))/i);
  if (match && match[1].trim()) return titleCaseWords(match[1].trim());
  // Match common street patterns: "Av.", "Calle", "Pasaje", etc. followed by name and number
  const streetMatch = source.match(/^((?:av(?:enida)?|calle|pasaje|psje|pje|los|las|el|la)\b[\s.]*.+?\d+(?:\s*,\s*\w+)?)(?=\s*(?:[🏙📱📧🎂🏥]|$))/i);
  if (streetMatch) return titleCaseWords(streetMatch[1].trim());
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
  if (/\b(CONVERSION(?: DE)? MANGA A BYPASS|MANGA A BYPASS|CONVERTIR MANGA|CIRUGIA REVISIONAL|REVISIONAL)\b/.test(normalized)) {
    return { key: "CONVERSION_MANGA_BYPASS", label: "Conversión de manga a bypass", pipelineId: 1290779 };
  }
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
  return SORTED_ASEGURADORA_ALIASES.find(([alias]) => (' ' + normalizedText + ' ').includes(' ' + alias + ' ')) || null;
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
  if (!cleanText) return 500;

  const chars = cleanText.length;
  const delay = 350 + chars * 6 + Math.floor(Math.random() * 350);
  return Math.min(Math.max(delay, 500), 1600);
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
    conversation: { version: 1, facts: [] },
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
      zendeskRequesterId: null,
      zendeskRequesterLinkedAt: null,
      zendeskTicketId: null,
      zendeskContactSyncKey: null,
      zendeskContactSyncAt: null,
      zendeskNotesSyncKey: null,
      zendeskNotesSyncAt: null,
      directMessageEmail: null,
      directMessagePhone: null,
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
      verifiedPairAt: null,
      savedDataConfirmed: false,
      savedDataShown: false,
      awaitingMissingDataCompletion: false,
      awaitingFinalConfirmation: false
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
      awaitingConfirmation: false,
      chosenSlot: null,
      missingFields: null
    },
    melania: { active: false, lastBookingAt: null, lastBookingSlot: null, lastBookingPatient: null },
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
    },
    leadScore: {
      score: 0,
      category: "frío",
      reasons: [],
      calculatedAt: null
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

    const recentMessages = await getRecentCompleteConversationHistory(conversationId, MAX_HISTORY_MESSAGES);
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
    const previousScore = state.leadScore?.score ?? 0;
    state.leadScore = calculateLeadScore(state);
    await upsertConversationState(conversationId, channel, state);
    await upsertStructuredLead(conversationId, channel, state);
    await trackLeadScoreChange(conversationId, state.leadScore, previousScore, channel || "message", state.system?.botMessagesSent || 0);
  } catch (error) {
    console.error("DB SNAPSHOT ERROR:", error.message);
  }
}

async function persistConversationMessage({ conversationId, role, messageId = null, channel = null, sourceType = null, content = "", rawJson = null, authorDisplayName = null }) {
  if (!dbEnabled()) return true;
  try {
    // Run sentiment analysis on message content
    let analysis = {};
    try {
      analysis = await analyzeSentiment(content, getEmojiSentimentBatch);
    } catch (err) {
      console.error("SENTIMENT_ANALYSIS_ERROR:", err.message);
    }

    return await insertConversationMessage({
      conversationId,
      role,
      messageId,
      channel,
      sourceType,
      content,
      rawJson,
      emojiList: analysis.emojiList || null,
      emojiCount: analysis.emojiCount || 0,
      emojiSentimentAvg: analysis.emojiSentimentAvg,
      textSentimentScore: analysis.textSentimentScore,
      wordCount: analysis.wordCount || 0,
      hasQuestion: analysis.hasQuestion || false,
      detectedSignals: analysis.detectedSignals?.length ? analysis.detectedSignals : null,
      authorDisplayName
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
      // El teléfono de WhatsApp ES identidad mínima: sembrarlo en c_tel1 si está
      // vacío, así el resolver no vuelve a pedirlo (identity_min ya satisfecho).
      // Aplica al canal WhatsApp recibido por Chatwoot. No pisa un valor existente.
      if (state.contactDraft && !state.contactDraft.c_tel1) {
        state.contactDraft.c_tel1 = whatsappPhone;
      }
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

function getMissingPatientDataFields(state) {
  const cd = state.contactDraft || {};
  const missing = [];
  if (!cd.c_fecha) missing.push({ key: "c_fecha", label: "🎂 Fecha de nacimiento:", emoji: "🎂" });
  if (!cd.c_email) missing.push({ key: "c_email", label: "📧 Correo electrónico:", emoji: "📧" });
  if (!cd.c_aseguradora) missing.push({ key: "c_aseguradora", label: "🏥 Previsión:", emoji: "🏥" });
  if (cd.c_aseguradora === "FONASA" && !cd.c_modalidad) missing.push({ key: "c_modalidad", label: "🩺 Tramo Fonasa:", emoji: "🩺" });
  if (!cd.c_direccion) missing.push({ key: "c_direccion", label: "🏡 Dirección:", emoji: "🏡" });
  if (!cd.c_comuna) missing.push({ key: "c_comuna", label: "🏙️ Ciudad:", emoji: "🏙️" });
  if (!cd.c_tel1 && !cd.c_tel2) missing.push({ key: "c_tel1", label: "📱 Número de celular:", emoji: "📱" });
  if (!cd.c_nombres) missing.push({ key: "c_nombres", label: "👤 Nombre completo:", emoji: "👤" });
  if (!cd.c_rut) missing.push({ key: "c_rut", label: "🆔 RUT:", emoji: "🆔" });
  // Medinet requires both apellido paterno AND materno
  if (cd.c_apellidos && !splitApellidos(cd.c_apellidos).materno) {
    missing.push({ key: "c_ap_materno", label: "👤 Apellido materno:", emoji: "👤" });
  }
  return missing;
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
      sourceSystem: isWhatsappChannel ? identity.channelSourceType || "chatwoot" : "conversation",
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
      rawJson,
      authorDisplayName: rawJson?.author?.displayName || null
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
  await antoniaControl.assertActive(info.controlKey, info.controlRevision);
  const guardedSend = (kind, fn) => antoniaControl.send(info.controlKey, info.controlRevision, kind, fn);
  const receipts = [];
  const delayMs = calculateHumanDelay(reply);
  await sleep(delayMs);

  await antoniaControl.assertActive(info.controlKey, info.controlRevision);
  const latestState = getConversationState(conversationId);
  if (!latestState.system.aiEnabled) {
    return resJsonSkip("ai_disabled_after_delay");
  }

  if (!isStillLatestUserMessage(conversationId, messageId)) {
    return resJsonSkip("stale_message_after_delay");
  }

  const rawFinalReply = appendAntoniaIntroduction(latestState, reply);
  const replyBubbles = splitAntoniaReplyBubbles(rawFinalReply);
  const finalReply = replyBubbles.length
    ? replyBubbles.join("\n\n")
    : formatReplyForWhatsApp(rawFinalReply).replace(/\[\[MSG\]\]/g, "\n").trim();
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

  let sentAsAudio = false;
  let deliveredReply = finalReply;
  const sentBubbles = [];
  try {
    if (ANTONIA_AUDIO_ENABLED && info?.transport === "chatwoot" && wantsAudioReply(userText)) {
      try {
        const audioBytes = await generateAntoniaAudio(finalReply);
        receipts.push(await guardedSend('audio_intro', () => sendChatwootReply({
          conversationId, content: "🎙️ Te lo envío por audio. La voz de Antonia es generada por IA.",
        })));
        receipts.push(await guardedSend('audio', () => sendChatwootAttachment({
          conversationId,
          bytes: audioBytes,
          filename: `antonia-${Date.now()}.ogg`,
          mimeType: "audio/ogg",
        })));
        sentAsAudio = true;
      } catch (audioError) {
        // Never fall back after an uncertain or partial external send.
        if (receipts.length || audioError instanceof ControlError) throw audioError;
        await antoniaControl.assertActive(info.controlKey, info.controlRevision);
        console.error("ANTONIA_AUDIO_SEND_ERROR, fallback text:", audioError.message);
      }
    }

    if (!sentAsAudio) {
      const bubblesToSend = replyBubbles.length ? replyBubbles : [finalReply];
      for (let i = 0; i < bubblesToSend.length; i += 1) {
        if (i > 0) {
          await sleep(300 + Math.floor(Math.random() * 450));
          if (!getConversationState(conversationId).system.aiEnabled) break;
          if (!isStillLatestUserMessage(conversationId, messageId)) break;
        }
        try {
          receipts.push(await guardedSend('text', () => sendConversationReply(appId, conversationId, bubblesToSend[i], info)));
        } catch (error) {
          if (error instanceof ControlError && sentBubbles.length) break;
          throw error;
        }
        sentBubbles.push(bubblesToSend[i]);
      }
      if (sentBubbles.length) {
        deliveredReply = sentBubbles.join("\n\n");
      }
    }
  } catch (sendError) {
    if (sendError instanceof ControlError) {
      await saveConversationEvent({conversationId,info,channelLabel,userText,botReply:null,
        state:latestState,resolverDecision:{nextAction:'blocked',reason:sendError.message,receipts}});
      return resJsonSkip(sendError.message);
    }
    console.error("SEND_REPLY_ERROR:", sendError.message);
    await saveConversationEvent({
      conversationId, info, channelLabel, userText,
      botReply: `[SEND_FAILED] ${finalReply}`,
      state: latestState,
      resolverDecision: { ...resolverDecision, sendError: sendError.message }
    });
    throw sendError;
  }
  if (!sentAsAudio && !sentBubbles.length) return resJsonSkip('human_control_before_send');
  addToHistory(conversationId, "assistant", deliveredReply);

  latestState.system.botMessagesSent += 1;
  rememberOutboundReply(latestState, deliveredReply, kind);
  // Public reply has already been delivered. Keep the private agent card secondary.
  // A human takeover also stops pending Antonia card updates.
  try {
    await antoniaControl.assertActive(info.controlKey, info.controlRevision);
    await maybeSyncPrivateLeadNote({ conversationId, channel: channelLabel, state: latestState });
  } catch (error) {
    if (!(error instanceof ControlError)) console.warn('ANTONIA_CARD_CONTROL_UNAVAILABLE');
  }
  let shouldSaveSummary = false;

  if (disableAiAfterSend) {
    latestState.system.aiEnabled = false;
    latestState.system.handoffReason = handoffReasonAfterSend || latestState.system.handoffReason || null;
    shouldSaveSummary = true;
  } else if (botMessageLimitReached(latestState.system.botMessagesSent)) {
    markMaxMessagesReached(latestState);
    shouldSaveSummary = true;
  }

  await persistConversationMessage({
    conversationId,
    role: "assistant",
    channel: channelLabel,
    sourceType: "api:conversations",
    content: deliveredReply,
    rawJson: { kind, resolverDecision, sentAsAudio, receipts, bubbles: sentAsAudio ? null : sentBubbles },
    authorDisplayName: "Antonia"
  });
  await saveConversationEvent({
    conversationId,
    info,
    channelLabel,
    userText,
    botReply: deliveredReply,
    state: latestState,
    resolverDecision
  });
  await persistConversationSnapshot(conversationId, latestState, channelLabel);
  if (shouldSaveSummary) {
    await maybeSaveConversationSummary(conversationId, latestState, channelLabel);
  }

  return {
    ok: true,
    reply: deliveredReply,
    delayMs,
    botMessagesSent: latestState.system.botMessagesSent,
    handoffReason: latestState.system.handoffReason || null,
    resolverDecision: resolverDecision || null,
    sentAsAudio,
    bubbles: sentAsAudio ? [deliveredReply] : sentBubbles
  };
}

function resJsonSkip(reason) {
  return { ok: true, skipped: reason };
}

function extractConversationInfo(payload) {
  if (!isChatwootPayload(payload)) return null;
  return parseChatwootInbound(payload);
}



function leadScoreBadge(category) {
  switch (String(category || "").toLowerCase()) {
    case "caliente":
      return "🔴";
    case "tibio":
      return "🟡";
    case "frío":
    case "frio":
    default:
      return "🔵";
  }
}

function formatLeadScoreSummary(leadScore) {
  const score = leadScore?.score ?? 0;
  const category = String(leadScore?.category || "frío").toUpperCase();
  const badge = leadScore?.emoji || leadScoreBadge(leadScore?.category);
  const pipelinePrefix = leadScore?.pipeline ? `${leadScore.pipeline} ` : "";
  return `${pipelinePrefix}${badge} ${category} (${score})`;
}

function formatLeadScoreDetail(leadScore) {
  const summary = formatLeadScoreSummary(leadScore);
  const reasons = Array.isArray(leadScore?.reasons) ? leadScore.reasons.filter(Boolean) : [];
  if (!reasons.length) return summary;
  return `${summary} = ${reasons.join(", ")}`;
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
    // Reject time/date expressions mistakenly captured as professional names
    // e.g. "para la segunda semana de abril" should NOT extract "segunda semana"
    const candidateNorm = normalizeKey(withConMatch[1]);
    const isTimeExpression = /\b(PRIMERA|SEGUNDA|TERCERA|CUARTA|ULTIMA|PROXIMA|SIGUIENTE|ESTA|ESA|OTRA|SEMANA|MES|LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE|MANANA|HOY|AYER|TARDE|NOCHE)\b/.test(candidateNorm);
    if (!isTimeExpression) {
      return { professionalName: titleCaseWords(withConMatch[1]), matchType: "con_phrase" };
    }
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

  // If user shows schedule intent and we already have a pendingProfessional from a prior search,
  // re-use that professional instead of searching for generic words like "agendar"
  if (hasIntent && state.booking?.pendingProfessional) {
    const pendingQuery = extractKnownProfessionalAlias(state.booking.pendingProfessional)
      || sanitizeMedinetProfessionalCandidate(state.booking.pendingProfessional)
      || state.booking.pendingProfessional;
    return { shouldTry: true, reason: "schedule_intent_with_pending_professional", query: pendingQuery, trigger: "pending_professional" };
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

  if (state.leadScore?.score > 0) {
    const ls = state.leadScore;
    const lsEmoji = ls.emoji || "";
    const lsPipeline = ls.pipeline ? `${ls.pipeline}= ` : "";
    parts.push(`${lsPipeline}[LEAD_SCORE] ${lsEmoji} ${ls.category.toUpperCase()} (${ls.score}) = ${(ls.reasons || []).join(", ")}`);
  }

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
  return "envíame peso y estatura[[MSG]]por ejemplo 88 kg y 1,69 m";
}

function getMeasurementConfirmationMessage(weightKg, heightM) {
  return `te tengo con ${weightKg} kg y ${heightM} m[[MSG]]está bien?`;
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



































function isPadNonEligibilityLead(text) {
  const key = normalizeKey(text || "");
  const mentionsPad = key.includes("PAD") && key.includes("FONASA");
  const saysNoQualify = [
    "NO CALIFICO",
    "NO CALIFICA",
    "NO CUMPLO",
    "NO ENTRO",
    "NO PUEDO USAR",
    "NO ME SIRVE EL PAD"
  ].some((phrase) => key.includes(phrase));
  return mentionsPad && saysNoQualify;
}

function asksClinicLocationOrNearestSite(text) {
  const key = normalizeKey(text || "");
  return [
    "DONDE ESTAN UBICADOS",
    "DONDE ATIENDEN",
    "DONDE QUEDA",
    "UBICACION DE LA CLINICA",
    "UBICACION DE LA SEDE",
    "DIRECCION DE LA CLINICA",
    "DIRECCION DE LA SEDE",
    "SEDE CERCANA",
    "SEDE MAS CERCANA",
    "QUE SEDE",
    "CUAL SEDE"
  ].some((phrase) => key.includes(phrase));
}

function parseRequestedCareMode(text) {
  const key = normalizeKey(text || "");
  if (/\b(TELEMEDICINA|TELECONSULTA|ONLINE|ON LINE|VIDEO)\b/.test(key)) return "telemedicina";
  if (/\b(PRESENCIAL|PRESENCIALMENTE)\b/.test(key)) return "presencial";
  return null;
}

function parseClinicCityChoice(text) {
  const key = normalizeKey(text || "");
  if (key.includes("SANTIAGO")) return "Santiago";
  if (key.includes("ANTOFAGASTA")) return "Antofagasta";
  return null;
}

function isSimpleScheduleRequest(text) {
  const key = normalizeKey(text || "");
  return ["NECESITO UNA HORA", "QUIERO UNA HORA", "QUIERO AGENDAR", "NECESITO AGENDAR", "AGENDAR HORA", "PEDIR HORA", "HORA DISPONIBLE", "HORAS DISPONIBLES"].some((phrase) => key.includes(phrase));
}

function userExplicitlyRequestsHuman(text) {
  const key = normalizeKey(text || "");
  return /\b(HUMANO|PERSONA REAL|EJECUTIVA|AGENTE|ASESOR|ASESORA)\b/.test(key) && /\b(HABLAR|QUIERO|NECESITO|PASAR|DERIVAR|COMUNICAR)\b/.test(key);
}

function guardOpenAiSchedulingClaims(reply, state) {
  // A model reply is never a transaction receipt, even when slots were listed.
  const key = normalizeKey(reply || "");
  const unsupported = /(?:YA |HE |TE |HEMOS |QUEDO |QUEDA )(?:RESERVAD|AGENDAD|CANCELAD|MODIFICAD|DERIVAD|ASIGNAD|ENVIAD)/.test(key)
    || /(?:RESERVA|CITA|HORA) (?:ESTA |QUEDO |HA SIDO )?CONFIRMADA/.test(key);
  return {reply: unsupported
    ? "No tengo un comprobante de esa gestión. Necesitamos verificarla antes de darla por realizada."
    : reply, handoff:false};
}

function appendAntoniaIntroduction(state, reply) {
  if (state.system.botMessagesSent === 0 && !state.system.introducedAsAntonia) {
    state.system.introducedAsAntonia = true;
    const cleanReply = String(reply || "")
      .trim()
      .replace(/^hola[.!]?\s*/i, "")
      .trim();
    return cleanReply ? `hola soy Antonia[[MSG]]${cleanReply}` : "hola soy Antonia";
  }
  return reply;
}

function buildOpenAISystemPrompt() {
  return conversationPrompt(buildKnowledgePromptContext());
}

function formatReplyForWhatsApp(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanHumanBubble(text) {
  let value = String(text || "").trim();
  if (!value) return "";
  value = value
    .replace(/\bpreferís\b/gi, "prefieres")
    .replace(/\bpodés\b/gi, "puedes")
    .replace(/\bquerés\b/gi, "quieres")
    .replace(/\bmedís\b/gi, "mides")
    .replace(/\bsos\b/gi, "eres")
    .replace(/\btenés\b/gi, "tienes")
    .replace(/\bpasás\b/gi, "pasas")
    .replace(/^[¿¡]\s*/, "")
    .replace(/[.!]+$/, "")
    .trim();
  if (/^(claro|sí|si|perfecto|entiendo|ya|ok)$/i.test(value)) {
    value = value.toLowerCase();
  }
  return value;
}

function splitAntoniaReplyBubbles(text) {
  const clean = formatReplyForWhatsApp(text);
  if (!clean) return [];

  let parts = clean
    .split(/\s*\[\[MSG\]\]\s*/i)
    .map(cleanHumanBubble)
    .filter(Boolean);

  if (parts.length === 1) {
    const ack = parts[0].match(/^(claro|sí|si|perfecto|entiendo|ya|ok)[.!]?\s+([\s\S]+)$/i);
    if (ack?.[2]) {
      parts = [cleanHumanBubble(ack[1]), cleanHumanBubble(ack[2])].filter(Boolean);
    } else {
      const paragraphs = parts[0]
        .split(/\n{2,}/)
        .map(cleanHumanBubble)
        .filter(Boolean);
      if (paragraphs.length > 1) parts = paragraphs;
    }
  }

  const isAfterHoursSequence = /Carolin/i.test(clean) && /\+56973763009/.test(clean);
  if (parts.length > 2 && !isAfterHoursSequence) {
    parts = [parts[0], cleanHumanBubble(parts.slice(1).join("\n"))];
  }

  return parts.slice(0, isAfterHoursSequence ? 5 : 2);
}

function buildReferralPromptContext(referralContext) {
  if (!referralContext) return null;
  const lines = [
    "[CONTEXTO_ANUNCIO]",
    "Este bloque describe el anuncio/origen de la conversación, NO datos declarados por el paciente.",
  ];
  if (referralContext.headline) lines.push(`titular=${referralContext.headline}`);
  if (referralContext.body) lines.push(`texto=${String(referralContext.body).slice(0, 1800)}`);
  if (referralContext.sourceType) lines.push(`origen=${referralContext.sourceType}`);
  if (referralContext.sourceUrl) lines.push(`url=${referralContext.sourceUrl}`);
  return lines.join("\n");
}

async function askAntoniaAI({
  systemPrompt,
  stateSummary,
  history,
  imageUrls = [],
  referralContext = null,
  structured = false,
}) {
  if (!antoniaAI) throw new Error("Antonia AI client not initialized");

  const referralBlock = buildReferralPromptContext(referralContext);
  const safeImageUrls = [...new Set(
    (Array.isArray(imageUrls) ? imageUrls : [])
      .map((url) => String(url || "").trim())
      .filter((url) => /^https?:\/\//i.test(url))
  )].slice(0, 3);

  const baseMessages = [
    { role: "system", content: systemPrompt + "\n\n" + CHILEAN_STYLE },
    { role: "system", content: stateSummary },
    ...(referralBlock ? [{ role: "system", content: referralBlock }] : []),
    ...history.map((item) => ({ ...item })),
  ];

  function withImages(messages) {
    if (!safeImageUrls.length) return messages;
    const result = messages.map((item) => ({ ...item }));
    let lastUserIndex = -1;
    for (let i = result.length - 1; i >= 0; i -= 1) {
      if (result[i]?.role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex < 0) {
      result.push({ role: "user", content: "El paciente envió una imagen." });
      lastUserIndex = result.length - 1;
    }
    const existingText = typeof result[lastUserIndex].content === "string"
      ? result[lastUserIndex].content
      : "El paciente envió una imagen.";
    result[lastUserIndex] = {
      role: "user",
      content: [
        { type: "text", text: existingText || "El paciente envió una imagen. Obsérvala antes de responder." },
        ...safeImageUrls.map((url) => ({
          type: "image_url",
          image_url: { url, detail: "auto" },
        })),
      ],
    };
    return result;
  }

  async function createCompletion(messages) {
    const request = {
      model: ANTONIA_CONVERSATION_MODEL,
      ...(structured ? { response_format: { type: "json_object" } } : {}),
      messages,
      max_completion_tokens: Math.max(300, Number(process.env.ANTONIA_MAX_COMPLETION_TOKENS || 4096)),
    };
    if (String(ANTONIA_CONVERSATION_MODEL).startsWith("gpt-5.6")) {
      request.reasoning_effort = process.env.ANTONIA_REASONING_EFFORT || "none";
    }
    const completion = await antoniaAI.chat.completions.create(request, { timeout: 45000, maxRetries: 0 });
    try {
      await recordAIUsage(getCrmPool(), { provider: ANTONIA_AI_PROVIDER, model: completion.model || ANTONIA_CONVERSATION_MODEL, usage: completion.usage, purpose: 'antonia_chat' });
    } catch (usageError) {
      console.warn('[ai-usage] no se pudo registrar el consumo:', usageError.message);
    }
    if (completion.choices?.[0]?.finish_reason === "length") throw new Error("Antonia response exceeded output limit");
    return completion;
  }

  let response;
  try {
    response = await createCompletion(withImages(baseMessages));
  } catch (error) {
    if (!safeImageUrls.length || ![400, 422].includes(error?.status) || reviewErrorCode(error) === "ai_quota_exhausted") throw error;
    console.warn("[vision] multimodal request failed; retrying with text/referral only:", error.message);
    response = await createCompletion(baseMessages);
  }

  let reply = response.choices?.[0]?.message?.content?.trim() || "";
  if (!reply) {
    const finishReason = response.choices?.[0]?.finish_reason || null;
    console.warn("[antonia-ai-empty] respuesta vacía; reintentando", safeJson({ finishReason, model: ANTONIA_MODEL }));
    try {
      const retry = await createCompletion([
        ...baseMessages,
        {
          role: "system",
          content: structured ? "Devuelve el objeto JSON solicitado con action, patientSubject, reply y facts. No incluyas texto fuera del JSON." : "Responde a la pregunta actual usando sólo el contexto autorizado."
        }
      ]);
      reply = retry.choices?.[0]?.message?.content?.trim() || "";
    } catch (retryError) {
      console.warn("[antonia-ai-empty] retry failed:", retryError.message);
    }
  }
  if (!reply) throw new Error("Antonia returned an empty response");
  return structured ? reply : formatReplyForWhatsApp(reply);
}

function wantsAudioReply(text) {
  const normalized = normalizeKey(text || "");
  return /\b(AUDIO|NOTA DE VOZ|MENSAJE DE VOZ|VOZ)\b/.test(normalized) &&
    /\b(MANDA|MANDAME|ENVIAME|ENVIA|PUEDES|QUIERO|PREFIERO|RESPONDE|RESPONDER)\b/.test(normalized);
}

async function generateAntoniaAudio(text) {
  if (!openai) throw new Error("OpenAI client not initialized");
  const audioResponse = await openai.audio.speech.create({
    model: ANTONIA_AUDIO_MODEL,
    voice: ANTONIA_AUDIO_VOICE,
    input: String(text || "").slice(0, 3000),
    instructions: "Habla en español chileno neutro, cálido y profesional. Suena natural, cercana y breve, como atención por WhatsApp. Ritmo conversacional, sin tono publicitario.",
    response_format: "opus",
  });
  return Buffer.from(await audioResponse.arrayBuffer());
}

async function sendConversationReply(_appId, conversationId, reply, info = null) {
  if (info?.transport !== "chatwoot") {
    throw new Error("Unsupported transport: Chatwoot is the only active conversation channel");
  }
  return sendChatwootReply({ conversationId, content: reply });
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



app.get("/api/lead-score-history/:conversationId", requireDebugKey, async (req, res) => {
  try {
    const history = await getLeadScoreHistory(req.params.conversationId, parseInt(req.query.limit) || 50);
    return res.json({ ok: true, count: history.length, history });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

const handleInboundWebhook = async (req, res) => {
  try {
    console.log("===== /chatwoot/inbound =====");

    const info = extractConversationInfo(req.body);
    // Independent projection: failures must not stop Antonia's reply.
    if (process.env.CRM_LINKS_SYNC_ENABLED === "true" && isChatwootPayload(req.body)) {
      recordContactEvent(getCrmPool(), req.body).catch(() => console.warn("CRM_LINKS_SYNC_FAILED"));
    }
    if (!info) {
      return res.status(400).json({ ok: false, error: "invalid_chatwoot_payload" });
    }
    const {
      appId,
      conversationId,
      userText,
      eventType,
      authorType,
      messageId,
      sourceType
    } = info;
    console.log("[chatwoot] inbound", safeJson({ conversationId, messageId, authorType, sourceType }));

    if (eventType !== "conversation:message") {
      return res.json({ ok: true, skipped: "non_message_event" });
    }

    if (!conversationId) {
      return res.status(400).json({ ok: false, error: "Missing conversationId" });
    }

    if (String(appId) !== String(process.env.CHATWOOT_ACCOUNT_ID || '162472')) {
      return res.status(403).json({ok:false,error:'account_mismatch'});
    }
    if (authorType === 'business' && isRealHumanBusinessTakeover(info) && !messageId)
      return res.status(400).json({ok:false,error:'human_message_id_required'});
    info.controlKey = controlKey(appId, conversationId);
    const control = authorType === 'business' && isRealHumanBusinessTakeover(info)
      ? await antoniaControl.change(info.controlKey, {
          mode:'human_active', actor:`chatwoot:${info.rawSource?.id || 'unidentified'}`,
          reason:'human_business_message_detected', eventId:`human-message:${messageId}`,
          humanEvent:true,
        })
      : await antoniaControl.read(info.controlKey);
    info.controlRevision = control.revision;
    if (authorType === 'business' && isRealHumanBusinessTakeover(info) && control.mode !== 'human_active') {
      return res.json({ok:true,skipped:'duplicate_human_event_after_resume'});
    }
    await hydrateConversationCache(conversationId);
    const state = getConversationState(conversationId);
    const channelLabel = info.sourceType || info.entryPoint || null;
    updateIdentityChannelContext(state, info, channelLabel);
    // Save paused patient messages without running the questionnaire or model hooks.
    if (authorType === 'user' && control.mode === 'human_active') {
      state.system.aiEnabled = false;
      state.system.humanTakenOver = true;
      state.system.humanPauseUntil = null;
      await persistConversationSnapshot(conversationId, state, channelLabel);
      await insertConversationMessage({conversationId,role:'user',messageId,channel:channelLabel,
        sourceType,content:userText,rawJson:{humanControl:true}});
      return res.json({ok:true,skipped:'human_control'});
    }


    if (authorType === "business" && isRealHumanBusinessTakeover(info)) {
      const humanBusinessText = String(info?.businessText || "").trim();
      if (humanBusinessText) {
        addToHistory(conversationId, "assistant", humanBusinessText);
        if (dbEnabled()) {
          try {
            await insertConversationMessage({
              conversationId,
              role: "assistant",
              messageId: messageId || null,
              channel: info.sourceType || info.entryPoint || null,
              sourceType: info.sourceType || null,
              content: humanBusinessText,
              rawJson: { transport: "chatwoot", senderType: info.senderType || "user", humanAgent: true },
              authorDisplayName: null,
            });
          } catch (humanHistoryError) {
            console.warn(`[history] no se pudo normalizar mensaje humano ${conversationId}:`, humanHistoryError.message);
          }
        }
      }
      state.system.aiEnabled = false;
      state.system.humanTakenOver = true;
      state.system.humanPauseUntil = null;
      state.system.handoffReason = "human_business_message_detected";
      console.log(
        "AI paused due to human business message:",
        conversationId,
        "persistent revision",
        control.revision
      );
      console.log("Business sourceType:", sourceType);

      // ── EugenIA observes human agent comments but never mutates Antonia state ──
      try {
        const businessText = info?.businessText || info?.rawMessage?.content?.text || userText || "";
        const resolverNext = getNextBestQuestion(state, state.identity.supportRaw, state.identity.sellRaw, businessText);
        const resolverForObservation = {
          ...resolverNext,
          actionLabel: inferBestNextAction(resolverNext)
        };
        await onEugeniaHumanAgentMessage({
          conversationId,
          ticketId: null,
          text: businessText,
          sourcePublic: true,
          state,
          resolverDecision: resolverForObservation,
          logger: console
        });
      } catch (corrErr) {
        console.error("AGENT_CORRECTION_ERROR:", corrErr.message);
      }

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

    // Serialize user message processing per conversation to prevent race conditions.
    // Without this, multiple rapid messages (e.g. data + RUT) process concurrently,
    // causing stale state reads and conflicting bot responses.
    const convLock = acquireConversationLock(conversationId);
    await convLock.ready;
    try {
    // Re-hydrate state after acquiring lock — a prior message may have updated it
    await hydrateConversationCache(conversationId);
    Object.assign(state, getConversationState(conversationId));
    await antoniaControl.assertActive(info.controlKey, info.controlRevision);
    // Queued turns from before explicit reactivation are history, never work to replay.
    const rawCreatedAt = info.rawMessage?.created_at;
    const occurredAt = typeof rawCreatedAt === 'number'
      ? rawCreatedAt * 1000 : Date.parse(rawCreatedAt || '');
    if (control.resumed_at && Number.isFinite(occurredAt) && occurredAt <= Date.parse(control.resumed_at)) {
      await insertConversationMessage({conversationId,role:'user',messageId,channel:channelLabel,
        sourceType,content:userText,rawJson:{beforeExplicitResume:true}});
      return res.json({ok:true,skipped:'before_explicit_resume'});
    }
    if (control.resumed_at && state.system.controlRevision !== control.revision) {
      const latestRecord = await getConversationRecord(conversationId);
      if (latestRecord?.state_json) Object.assign(state, mergeConversationState(state, latestRecord.state_json));
      const recent = await getRecentCompleteConversationHistory(conversationId, MAX_HISTORY_MESSAGES);
      conversationHistory.set(conversationId, recent.map(row => ({role:row.role,content:row.content})));
      clearSoftHandoffState(state);
      state.system.controlRevision = control.revision;
      state.system.resumeContextPending = true;
      // Keep collected facts; discard only the stale question/booking interaction.
      if (state.preevaluation) state.preevaluation.awaiting = null;
      state.melania = {...state.melania,active:false};
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

      // ── EugenIA Hook 3: PREDICT on patient msg when ai_disabled + note every 2 msgs ──
      try {
        const resolverForP = getNextBestQuestion(state, state.identity.supportRaw, state.identity.sellRaw, userText || "");
        const resolverForMutedPatient = {
          ...resolverForP,
          actionLabel: inferBestNextAction(resolverForP)
        };
        await onEugeniaMutedPatientMessage({
          conversationId,
          ticketId: null,
          state,
          resolverDecision: resolverForMutedPatient,
          logger: console
        });
      } catch (eugeniaErr) {
        console.error("EUGENIA_PREDICT_PATIENT_ERROR:", eugeniaErr.message);
      }

      return res.json({ ok: true, skipped: "ai_disabled" });
    }

    if (botMessageLimitReached(state.system.botMessagesSent)) {
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

    // Every conversational turn reaches the model. Only an explicit booking
    // decision may enter the existing validated transaction engine below.
    const recent = dbEnabled()
      ? await getRecentCompleteConversationHistory(conversationId, MAX_HISTORY_MESSAGES)
      : getHistory(conversationId);
    const history = recentConversationHistory(recent, { messageId, userText, limit: MAX_HISTORY_MESSAGES });
    conversationHistory.set(conversationId, history);
    await antoniaControl.assertActive(info.controlKey, info.controlRevision);
    const decision = parseConversationDecision(await askAntoniaAI({
      systemPrompt: buildOpenAISystemPrompt(), stateSummary: conversationContext(state),
      history, structured: true, imageUrls: info.imageUrls || [], referralContext: info.referralContext || null,
    }));
    await antoniaControl.assertActive(info.controlKey, info.controlRevision);
    applyConversationFacts(state, decision, { userText, messageId });
    state.system.resumeContextPending = false;
    state.leadScore = calculateLeadScore(state);
    await persistConversationSnapshot(conversationId, state, channelLabel);
    if (decision.action !== "booking" || decision.patientSubject !== "self") {
      const guarded = guardOpenAiSchedulingClaims(decision.reply, state);
      let result;
      try {
        result = await sendManagedReply({appId, conversationId, messageId, userText,
        reply: guarded.reply, kind: "model_conversation", state, info, channelLabel,
        resolverDecision: {stage:"model_conversation",nextAction:decision.action,reason:"Contextual model decision"},
        disableAiAfterSend: decision.action === "human_request",
        handoffReasonAfterSend: decision.action === "human_request" ? "patient_requested_human" : null,
        });
      } finally {
        if (decision.action === "human_request") {
          await antoniaControl.change(info.controlKey, {mode:"human_active",actor:"antonia:patient_request",
            reason:"patient_requested_human",eventId:`patient-request:${messageId}`,expectedRevision:info.controlRevision});
        }
      }
      return res.json(result);
    }

    // Exam requests must pass the published service catalogue before any AI questions.
    let examRequest = requestedExam(userText);
    // Recover exam context in conversations started before this deployment.
    if (!examRequest && !state.booking?.unpublishedExam && examFollowup(userText)) {
      try {
        const recent = dbEnabled() ? await getRecentCompleteConversationHistory(conversationId, 20) : getHistory(conversationId);
        for (const message of [...recent].reverse()) {
          if (message.role !== "user") continue;
          const content = message.content || message.text || "";
          if (!content || examFollowup(content)) continue;
          examRequest = requestedExam(content);
          break;
        }
      } catch (error) { console.warn("[agendaweb-policy] History unavailable:", error.message); }
    }
    const pendingExam = state.booking?.unpublishedExam;
    if (examRequest || (pendingExam && examFollowup(userText))) {
      const requested = examRequest || pendingExam;
      let published = [];
      try { published = publishedExamProfessionals(await loadPublishedAgendaweb(), requested); }
      catch (error) { console.warn("[agendaweb-policy] Exam catalogue unavailable:", error.message); }
      if (!published.length) {
        state.melania = { active: false, step: "human_required" };
        state.booking = { ...state.booking, unpublishedExam: requested, chosenSlot: null,
          pendingProfessional: null, pendingSlots: [], awaitingSlotChoice: false,
          awaitingConfirmation: false, awaitingPatientData: false, awaitingRutVerification: false };
        await persistConversationSnapshot(conversationId, state, channelLabel);
        return res.json(await sendManagedReply({
          appId, conversationId, messageId, userText, reply: EXAM_HANDOFF,
          kind: "unpublished_exam_human_only", state, info, channelLabel,
          resolverDecision: { stage: "agendaweb_only", nextAction: "human_required", reason: "Exam not verified in published appointment types" }
        }));
      }
      state.booking.unpublishedExam = null;
    }

    // Never enter automatic booking for an endoscopy, including sessions opened before this policy.
    const normalizedProcedureText = String(userText || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const endoscopyRequest = /endoscop|gastroscop/.test(normalizedProcedureText) &&
      /agend|reserv|hora|cupo|turno|quiero|necesito|hacerme|disponib/.test(normalizedProcedureText);
    if (endoscopyRequest || isEndoscopyBooking(state.melania?.chosenProfessional) ||
        isEndoscopyBooking(state.melania?.chosenSlot) || isEndoscopyBooking(state.booking?.chosenSlot)) {
      state.melania = { active: false };
      state.booking = { ...state.booking, chosenSlot: null, pendingSlots: [], awaitingConfirmation: false,
        awaitingPatientData: false, awaitingRutVerification: false };
      await persistConversationSnapshot(conversationId, state, channelLabel);
      return res.json(await sendManagedReply({
        appId, conversationId, messageId, userText, reply: ENDOSCOPY_HANDOFF,
        kind: "endoscopy_human_only", state, info, channelLabel,
        resolverDecision: { stage: "endoscopy_human_only", nextAction: "human_required" }
      }));
    }

    const bookingReply = await runModelBooking({state,plan:decision.booking,userText,messageId,
      search:runMedinetAntonia,
      reserve:args=>runMedinetAntoniaBooking({...args,info}),
      // Unlike best-effort analytics, consent/attempt persistence must not swallow errors.
      persist:()=>upsertConversationState(conversationId,channelLabel,state),
      assertActive:()=>antoniaControl.assertActive(info.controlKey,info.controlRevision),
    });
    const bookingResult = await sendManagedReply({appId,conversationId,messageId,userText,
      reply:bookingReply,kind:"model_booking",state,info,channelLabel});
    if (bookingResult.ok && !bookingResult.skipped && bookingResult.reply?.includes(bookingReply) &&
        state.booking.modelConfirmation?.messageId === String(messageId)) {
      state.booking.modelConfirmation.presented = true;
      await upsertConversationState(conversationId,channelLabel,state);
    }
    return res.json(bookingResult);
    } finally {
      // Release per-conversation lock so the next queued message can proceed
      convLock.release();
    }
  } catch (error) {
    if (error instanceof ControlError && error.status === 409)
      return res.json({ok:true,skipped:error.message});
    console.error("ERROR /chatwoot/inbound:", error.message);
    if (reviewErrorCode(error) === 'ai_quota_exhausted') {
      return res.status(503).json({ ok: false, error: 'ai_quota_exhausted' });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }
};

function requireChatwootBearer(req, res, next) {
  const expected = process.env.CHATWOOT_ADAPTER_TOKEN;
  if (!expected) {
    return res.status(500).json({ ok: false, error: "CHATWOOT_ADAPTER_TOKEN no configurado" });
  }
  const got = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (got !== expected) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

// Chatwoot Cloud is the single active conversational transport.
app.post("/chatwoot/inbound", requireChatwootBearer, handleInboundWebhook);
console.log("[chatwoot-adapter] mounted POST /chatwoot/inbound");

const PORT = process.env.PORT || 10000;
await initDb();
app.listen(PORT, () => {
  console.log(`Clinyco Conversations AI running on port ${PORT}`);
  console.log(`Database persistence: ${dbEnabled() ? "enabled" : "disabled"}`);
  if (useRemoteWorker()) {
    console.log(`Medinet remote worker: ${MEDINET_WORKER_URL}`);
  } else {
    console.log(`Medinet: local execution (no MEDINET_WORKER_URL configured)`);
  }
  startCrmSync(getCrmPool());
  void runConfiguredSellRestore(getCrmPool());
  startFonasapadCron();
  startMonthlyCron();
  const improvementPool = getCrmPool();
  startDailyProfessionalAgenda({pool: improvementPool});
  startImprovementReviews({ pool: improvementPool, review: createReviewer({ openai: antoniaAI, provider: ANTONIA_AI_PROVIDER, model: ANTONIA_MODEL, pool: improvementPool }) });
  void registerImprovementApp().then(result => console.log('[antonia-improvements-app]', JSON.stringify(result)))
    .catch(error => console.error('[antonia-improvements-app]', error.message));
});
