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
const MELANIA_USERNAME = process.env.MEDINET_JWT_USERNAME || process.env.MELANIA_USERNAME || "";
const MELANIA_PASSWORD = process.env.MEDINET_JWT_PASSWORD || process.env.MELANIA_PASSWORD || "";

// ── Mapeo prevision texto → IDs Medinet ──
// ── Comuna text → Medinet numeric ID ──
const COMUNA_MAP = {
  "algarrobo": 68, "alhué": 338, "alto biobío": 178, "alto del carmen": 27,
  "alto hospicio": 6, "ancud": 254, "andacollo": 32, "angol": 221,
  "antofagasta": 12, "antuco": 166, "antártica": 289, "arauco": 159,
  "arica": 1, "aysén": 276, "buin": 334, "bulnes": 180,
  "cabildo": 58, "cabo de hornos": 288, "cabrero": 167, "calama": 16,
  "calbuco": 245, "caldera": 22, "calera": 63, "calera de tango": 335,
  "calle larga": 54, "camarones": 2, "camiña": 8, "canela": 37,
  "carahue": 201, "cartagena": 69, "casablanca": 46, "castro": 253,
  "catemu": 74, "cauquenes": 126, "cañete": 160, "cerrillos": 296,
  "cerro navia": 297, "chaitén": 270, "chanco": 127, "chañaral": 24,
  "chiguayante": 148, "chile chico": 282, "chillán": 179, "chillán viejo": 184,
  "chimbarongo": 108, "cholchol": 220, "chonchi": 255, "chépica": 107,
  "cisnes": 277, "cobquecura": 181, "cochamó": 246, "cochrane": 279,
  "codegua": 84, "coelemu": 182, "coihaique": 274, "coihueco": 183,
  "coinco": 85, "colbún": 139, "colchane": 9, "colina": 330,
  "collipulli": 222, "coltauco": 86, "combarbalá": 41, "concepción": 146,
  "conchalí": 298, "concón": 47, "constitución": 117, "contulmo": 161,
  "copiapó": 21, "coquimbo": 31, "coronel": 147, "corral": 233,
  "cunco": 202, "curacautín": 223, "curacaví": 339, "curaco de vélez": 256,
  "curanilahue": 162, "curarrehue": 203, "curepto": 118, "curicó": 129,
  "dalcahue": 257, "diego de almagro": 25, "doñihue": 87,
  "el bosque": 299, "el carmen": 185, "el monte": 343, "el quisco": 70,
  "el tabo": 71, "empedrado": 119, "ercilla": 224, "estación central": 300,
  "florida": 149, "freire": 204, "freirina": 28, "fresia": 247,
  "frutillar": 248, "futaleufú": 271, "futrono": 241,
  "galvarino": 205, "general lagos": 4, "gorbea": 206, "graneros": 88,
  "guaitecas": 278, "hijuelas": 64, "hualaihué": 272, "hualañé": 130,
  "hualpén": 157, "hualqui": 150, "huara": 10, "huasco": 29,
  "huechuraba": 301, "illapel": 36, "independencia": 302, "iquique": 5,
  "isla de maipo": 344, "isla de pascua": 52, "juan fernández": 48,
  "la cisterna": 303, "la cruz": 65, "la estrella": 101, "la florida": 304,
  "la granja": 305, "la higuera": 33, "la ligua": 57, "la pintana": 306,
  "la reina": 307, "la serena": 30, "la unión": 240, "lago ranco": 242,
  "lago verde": 275, "laguna blanca": 285, "laja": 168, "lampa": 331,
  "lanco": 234, "las cabras": 89, "las condes": 308, "lautaro": 207,
  "lebu": 158, "licantén": 131, "limache": 80, "linares": 138,
  "litueche": 102, "llaillay": 75, "llanquihue": 250, "lo barnechea": 309,
  "lo espejo": 310, "lo prado": 311, "lolol": 109, "loncoche": 208,
  "longaví": 140, "lonquimay": 225, "los alamos": 163, "los andes": 53,
  "los angeles": 165, "los lagos": 235, "los muermos": 249, "los sauces": 226,
  "los vilos": 38, "lota": 151, "lumaco": 227, "machalí": 90,
  "macul": 312, "maipú": 313, "malloa": 91, "marchihue": 103,
  "mariquina": 237, "maría elena": 20, "maría pinto": 340, "maule": 120,
  "maullín": 251, "mejillones": 13, "melipeuco": 209, "melipilla": 337,
  "molina": 132, "monte patria": 42, "mostazal": 92, "mulchén": 169,
  "máfil": 236, "nacimiento": 170, "nancagua": 110, "natales": 293,
  "navidad": 104, "negrete": 171, "ninhue": 186, "nogales": 66,
  "nueva imperial": 210, "o'higgins": 280, "olivar": 93, "ollagüe": 17,
  "olmué": 81, "osorno": 263, "ovalle": 40, "padre hurtado": 345,
  "padre las casas": 211, "paiguano": 34, "paillaco": 238, "paine": 336,
  "palena": 273, "palmilla": 111, "panguipulli": 239, "panquehue": 76,
  "papudo": 59, "paredones": 105, "parral": 141, "pedro aguirre cerda": 315,
  "pelarco": 121, "pelluhue": 128, "pemuco": 188, "pencahue": 122,
  "penco": 152, "peralillo": 112, "perquenco": 212, "petorca": 60,
  "peumo": 94, "peñaflor": 346, "peñalolén": 316, "pica": 11,
  "pichidegua": 95, "pichilemu": 100, "pinto": 189, "pirque": 328,
  "pitrufquén": 213, "placilla": 113, "portezuelo": 190, "porvenir": 290,
  "pozo almonte": 7, "primavera": 291, "providencia": 317, "puchuncaví": 49,
  "pucón": 214, "pudahuel": 318, "puente alto": 327, "puerto montt": 244,
  "puerto octay": 264, "puerto varas": 252, "pumanque": 114, "punitaqui": 43,
  "punta arenas": 284, "puqueldón": 258, "purranque": 265, "purén": 228,
  "putaendo": 77, "putre": 3, "puyehue": 266, "queilén": 259,
  "quellón": 260, "quemchi": 261, "quilaco": 172, "quilicura": 319,
  "quilleco": 173, "quillota": 62, "quillón": 191, "quilpué": 79,
  "quinchao": 262, "quinta de tilcoco": 96, "quinta normal": 320,
  "quintero": 50, "quirihue": 192, "rancagua": 83, "rauco": 133,
  "recoleta": 321, "renaico": 229, "renca": 322, "rengo": 97,
  "requínoa": 98, "retiro": 142, "reñaca": 348, "rinconada": 55,
  "romeral": 134, "ránquil": 193, "río bueno": 243, "río claro": 123,
  "río hurtado": 44, "río ibáñez": 283, "río negro": 267, "río verde": 286,
  "saavedra": 215, "sagrada familia": 135, "salamanca": 39,
  "san antonio": 67, "san bernardo": 333, "san carlos": 194,
  "san clemente": 124, "san esteban": 56, "san fabián": 195,
  "san felipe": 73, "san fernando": 106, "san gregorio": 287,
  "san ignacio": 196, "san javier": 143, "san joaquín": 323,
  "san josé de maipo": 329, "san juan de la costa": 268, "san miguel": 324,
  "san nicolás": 197, "san pablo": 269, "san pedro": 341,
  "san pedro de atacama": 18, "san pedro de la paz": 153, "san rafael": 125,
  "san ramón": 325, "san rosendo": 174, "san vicente": 99,
  "santa bárbara": 175, "santa cruz": 115, "santa juana": 154,
  "santa maría": 78, "santiago": 295, "santo domingo": 72,
  "sierra gorda": 14, "sin asignar": 347, "talagante": 342,
  "talca": 116, "talcahuano": 155, "taltal": 15, "temuco": 200,
  "teno": 136, "teodoro schmidt": 216, "tierra amarilla": 23, "tiltil": 332,
  "timaukel": 292, "tirúa": 164, "tocopilla": 19, "toltén": 217,
  "tomé": 156, "torres del paine": 294, "tortel": 281, "traiguén": 230,
  "treguaco": 198, "tucapel": 176, "valdivia": 232, "vallenar": 26,
  "valparaíso": 45, "vichuquén": 137, "victoria": 231, "vicuña": 35,
  "vilcún": 218, "villa alegre": 144, "villa alemana": 82, "villarrica": 219,
  "vitacura": 326, "viña del mar": 51, "yerbas buenas": 145, "yumbel": 177,
  "yungay": 199, "zapallar": 61, "ñiquén": 187, "ñuñoa": 314,
};

function resolveComunaId(comunaText) {
  if (!comunaText) return "";
  const key = String(comunaText).toLowerCase().trim();
  // Direct match
  if (COMUNA_MAP[key] !== undefined) return COMUNA_MAP[key];
  // Try without accents
  const normalized = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [name, id] of Object.entries(COMUNA_MAP)) {
    const normName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normName === normalized) return id;
  }
  // Partial match (starts with or contains)
  for (const [name, id] of Object.entries(COMUNA_MAP)) {
    const normName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normName.startsWith(normalized) || normalized.startsWith(normName)) return id;
  }
  return "";
}

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
      comuna: resolveComunaId(patientData.comuna) || 12, // default: Antofagasta
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
