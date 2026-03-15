import express from "express";
import { resolveIdentityAndContext, getNextBestQuestion, applyResolverToState } from "./conversation-resolver.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// =========================
// In-memory state
// =========================
const conversationHistory = new Map();
const conversationStates = new Map();

// =========================
// Config
// =========================
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
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

const MEDINET_AGENDA_WEB_URL = "https://clinyco.medinetapp.com/agendaweb/planned/";
const KNOWN_AGENDA_PROFESSIONALS = new Set([
  "RODRIGO VILLAGRAN",
  "NELSON AROS",
  "ALBERTO SIRABO",
  "FRANCISCO BENCINA",
  "EDMUNDO ZIEDE",
  "ROSIRYS RUIZ"
]);

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
  const match = String(text || "").match(/\b\d{1,2}[.]?\d{3}[.]?\d{3}-?[\dkK]\b/);
  return match ? match[0].trim() : null;
}

function formatRutHuman(raw) {
  const cleaned = String(raw || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (cleaned.length < 2) return null;
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withDots}-${dv}`;
}

function extractName(text) {
  const source = normalizeSpaces(String(text || ""));
  const match = source.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,3})/i);
  if (!match) return null;
  return titleCaseWords(match[1]);
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

function extractDate(text) {
  const match = String(text || "").match(/\b(\d{2})[\/-](\d{2})[\/-](\d{4})\b/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : null;
}

function extractAddress(text) {
  const source = normalizeSpaces(String(text || ""));
  const match = source.match(/(?:direccion|dirección)\s*:?\s*(.+)$/i);
  return match ? titleCaseWords(match[1]) : null;
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
  return null;
}

function parseAseguradora(text) {
  const normalized = normalizeKey(text);

  if (!normalized) return null;

  if (normalized.includes("ISAPRE") && !normalized.includes("FONASA")) {
    return { aseguradora: null, modalidad: null, isFonasa: false, isIsapreGeneric: true };
  }

  for (const [alias, canonical] of Object.entries(ASEGURADORA_ALIASES)) {
    if (normalized.includes(alias)) {
      return {
        aseguradora: canonical,
        modalidad: MODALIDAD_FROM_ASEGURADORA[canonical] || null,
        isFonasa: canonical === "FONASA" || canonical === "PAD Fonasa PAD",
        isIsapreGeneric: false
      };
    }
  }

  return null;
}

function parseFonasaTramo(text) {
  const normalized = normalizeKey(text);
  const match = normalized.match(/\bTRAMO\s+([ABCD])\b/) || normalized.match(/^([ABCD])$/);
  if (!match) return null;
  const tramo = match[1].toUpperCase();
  return {
    tramo,
    modalidad: `Tramo ${tramo}`,
    isPadEligible: tramo === "A" ? false : true
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

  const explicitWeight = normalized.match(/(?:peso\s*:?\s*)?(\d{2,3})(?:\s*(?:kg|kilo|kilos))\b/i);
  if (explicitWeight) {
    weightKg = normalizeMeasurementNumber(explicitWeight[1]);
  }

  const explicitHeightMeters = normalized.match(/(?:altura|estatura|mido)\s*:?\s*(1[.,]\d{1,2}|2[.,]0{1,2})\s*(?:m|metro|metros)?\b/i)
    || normalized.match(/\b(1[.,]\d{1,2}|2[.,]0{1,2})\s*(?:m|metro|metros)\b/i);
  if (explicitHeightMeters) {
    heightM = normalizeMeasurementNumber(explicitHeightMeters[1]);
  }

  const explicitHeightCm = normalized.match(/(?:altura|estatura|mido)\s*:?\s*(\d{3})\s*cm\b/i)
    || normalized.match(/\b(\d{3})\s*cm\b/i);
  if (!heightM && explicitHeightCm) {
    const cm = normalizeMeasurementNumber(explicitHeightCm[1]);
    if (cm) {
      heightM = Math.round((cm / 100) * 100) / 100;
      fromCm = true;
    }
  }

  // Clear explicit data: no need to confirm unless values look unrealistic.
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

  // If one explicit value is missing, try to infer from plain numeric pairs.
  const pairMatches = Array.from(normalized.matchAll(/\b(\d{2,3}(?:[.,]\d{1,2})?)\b/g)).map((m) => m[1]);
  if (pairMatches.length >= 2) {
    const numbers = pairMatches.slice(0, 3).map((v) => normalizeMeasurementNumber(v)).filter(Boolean);
    if (numbers.length >= 2) {
      const [a, b] = numbers;

      if (!weightKg && !heightM) {
        // 120 178 or 178 120 or 66 154
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
      } else if (weightKg && !heightM) {
        if (b >= 120 && b <= 220) {
          heightM = Math.round((b / 100) * 100) / 100;
          fromCm = true;
          ambiguous = true;
          reason = "missing_height_cm";
        } else if (b >= 1.2 && b <= 2.2) {
          heightM = b;
          ambiguous = true;
          reason = "missing_height_m";
        }
      } else if (!weightKg && heightM) {
        if (a >= 40 && a <= 250) {
          weightKg = a;
          ambiguous = true;
          reason = "missing_weight";
        }
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

function getConversationState(conversationId) {
  if (!conversationStates.has(conversationId)) {
    conversationStates.set(conversationId, {
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
        lastSupportSearchKey: null,

        likelyClinicalRecordOnly: false,
        caseType: null,
        nextAction: null,
        lastQuestionReason: null,
        lastMissingFields: [],
        lastResolvedContext: null
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
      system: {
        aiEnabled: true,
        humanTakenOver: false,
        assigneeId: null,
        botMessagesSent: 0,
        introducedAsAntonia: false,
        handoffReason: null,
        lastQuestionKey: null
      }
    });
  }
  return conversationStates.get(conversationId);
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
    "CITA",
    "RESERVAR HORA",
    "TOMA DE HORA"
  ].some((phrase) => normalized.includes(phrase));
}

function extractProfessionalName(text) {
  const source = normalizeSpaces(String(text || ""));

  const titledMatch = source.match(/\b(?:dr|dra|doctor|doctora)\.?\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,3})/i);
  if (titledMatch) {
    return titleCaseWords(titledMatch[1]);
  }

  const withConMatch = source.match(/\b(?:con|para)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})\b/);
  if (withConMatch) {
    return titleCaseWords(withConMatch[1]);
  }

  return null;
}

function isKnownAgendaProfessional(name) {
  if (!name) return false;
  return KNOWN_AGENDA_PROFESSIONALS.has(normalizeKey(name));
}

function detectUnknownProfessionalScheduleRequest(text) {
  const professionalName = extractProfessionalName(text);
  if (!professionalName) {
    return { shouldDerive: false, professionalName: null };
  }

  if (!hasScheduleIntent(text)) {
    return { shouldDerive: false, professionalName };
  }

  if (isKnownAgendaProfessional(professionalName)) {
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

  const email = extractEmail(cleanText);
  if (email) state.contactDraft.c_email = email;

  const phone = extractPhone(cleanText);
  if (phone) {
    state.contactDraft.c_tel1 = phone;
    if (!state.contactDraft.c_tel2) {
      state.contactDraft.c_tel2 = phone;
    }
  }

  const rut = extractRut(cleanText);
  if (rut) {
    state.contactDraft.c_rut = formatRutHuman(rut) || rut;
  }

  const dob = extractDate(cleanText);
  if (dob) state.contactDraft.c_fecha = dob;

  const address = extractAddress(cleanText);
  if (address) state.contactDraft.c_direccion = address;

  const fullName = extractName(cleanText);
  if (fullName) {
    const split = splitNames(fullName);
    if (split.nombres) state.contactDraft.c_nombres = split.nombres;
    if (split.apellidos) state.contactDraft.c_apellidos = split.apellidos;
  }

  if (!state.contactDraft.c_nombres && info?.authorDisplayName) {
    const split = splitNames(info.authorDisplayName);
    if (split.nombres) state.contactDraft.c_nombres = split.nombres;
    if (split.apellidos) state.contactDraft.c_apellidos = split.apellidos;
  }

  const comuna = detectComuna(cleanText) || detectComuna(info?.authorDisplayName) || detectComuna(info?.sourceProfileName);
  if (comuna) {
    state.contactDraft.c_comuna = comuna;
    if (!state.dealDraft.dealSucursal) {
      const sucursal = detectSucursal(comuna);
      if (sucursal) state.dealDraft.dealSucursal = sucursal;
    }
  }

  const insuranceInfo = parseAseguradora(cleanText);
  if (insuranceInfo?.aseguradora) {
    state.contactDraft.c_aseguradora = insuranceInfo.aseguradora;
    if (insuranceInfo.aseguradora !== "FONASA" && insuranceInfo.modalidad) {
      state.contactDraft.c_modalidad = insuranceInfo.modalidad;
    }
  }

  const tramo = parseFonasaTramo(cleanText);
  if (tramo) {
    state.contactDraft.c_aseguradora = "FONASA";
    state.contactDraft.c_modalidad = tramo.modalidad;
    state.dealDraft.dealValidacionPad = tramo.isPadEligible
      ? "Posible evaluación PAD Fonasa"
      : "No aplica PAD Fonasa por Tramo A";
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
    mergeUsers((await searchSupportByName(name)).slice(0, 5));
  }

  if (!usersById.size && channelDisplayName) {
    mergeUsers((await searchSupportByName(channelDisplayName)).slice(0, 5));
  }

  if (!usersById.size && sourceProfileName) {
    mergeUsers((await searchSupportByName(sourceProfileName)).slice(0, 5));
  }

  const users = Array.from(usersById.values());
  const tickets = await searchTicketsForUserIds(users.map((u) => u.id));

  return {
    found: users.length > 0 || tickets.length > 0,
    usersCount: users.length,
    ticketsCount: tickets.length,
    latestTicketId: tickets[0]?.id || null,
    users: users.slice(0, 5),
    tickets: tickets.slice(0, 10)
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
    if (firstUser) {
      if (!state.contactDraft.c_nombres || !state.contactDraft.c_apellidos) {
        const split = splitNames(firstUser.name || "");
        if (!state.contactDraft.c_nombres && split.nombres) {
          state.contactDraft.c_nombres = split.nombres;
        }
        if (!state.contactDraft.c_apellidos && split.apellidos) {
          state.contactDraft.c_apellidos = split.apellidos;
        }
      }

      if (!state.contactDraft.c_email && firstUser.email) {
        state.contactDraft.c_email = String(firstUser.email).toLowerCase();
      }

      if (!state.contactDraft.c_tel1 && firstUser.phone) {
        const normalizedPhone = normalizePhone(firstUser.phone);
        if (normalizedPhone) {
          state.contactDraft.c_tel1 = normalizedPhone;
          if (!state.contactDraft.c_tel2) {
            state.contactDraft.c_tel2 = normalizedPhone;
          }
        }
      }
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

function shouldAskForFonasaTramo(state) {
  return state.contactDraft.c_aseguradora === "FONASA" && !state.contactDraft.c_modalidad;
}

function shouldAskForSpecificAseguradora(state, latestUserText) {
  const parsed = parseAseguradora(latestUserText || "");
  return parsed?.isIsapreGeneric && !state.contactDraft.c_aseguradora;
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

function shouldUseResolverQuestion(state, decision) {
  if (!decision?.question) return false;
  if (decision.shouldDerive) return true;
  if (!Array.isArray(decision.missingFields) || !decision.missingFields.length) return false;

  const key = buildResolverQuestionKey(decision);
  if (!key) return false;
  if (state.system.lastQuestionKey === key) return false;

  state.system.lastQuestionKey = key;
  return true;
}

async function askOpenAI(conversationId, state) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const history = getHistory(conversationId);
  const stateSummary = buildStateSummary(state);

  const systemPrompt = `
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
- si el usuario ya entregó peso y estatura confirmados, usa el IMC disponible en el historial
- si el usuario pregunta por cirugía y aún no sabemos previsión, puedes preguntar si es Fonasa, Isapre o Particular
- si el usuario es Fonasa y aún no sabemos el tramo, debes pedir Tramo A, B, C o D
- si el usuario es Fonasa Tramo A, debes mencionar que no aplica bono PAD Fonasa y seguir orientando con alternativas
- si el usuario dice Isapre pero no especifica cuál, debes preguntar la aseguradora exacta
- para peso y estatura, si necesitas pedirlos, usa esta pauta exacta:
  Para orientarte mejor, indícame por favor:\n• Peso en kilos, sin decimales\n• Estatura en metros, usando punto o coma\nEjemplo: 120 kg y 1.78 m
- si en el historial hay un bloque [DATOS_CALCULADOS], úsalo
- cuando informes el IMC, explica brevemente qué significa en lenguaje simple y aclara que es una referencia inicial, no un diagnóstico
- si el IMC sugiere sobrepeso u obesidad y el usuario consulta por balón o bariátrica, continúa guiando el proceso con naturalidad
- no pidas RUT de forma proactiva salvo que el usuario diga que ya es paciente o entregue el RUT por su cuenta
- si ya fue identificado un caso de derivación clínica, no sigas preguntando datos
- si preguntan por la agenda u hora de un profesional que no esté en la lista disponible, no inventes disponibilidad; indica que derivarás con una agente porque no tienes acceso a esa agenda en esta franja horaria y sugiere la agenda web https://clinyco.medinetapp.com/agendaweb/planned/

Datos importantes:
- Clinyco tiene presencia en Antofagasta, Calama y Santiago
- Endoscopía solo en Antofagasta
- La agenda médica completa está disponible en Antofagasta
- En Santiago por ahora solo hay telemedicina
- En Calama las consultas presenciales con cirujanos se realizan en DiagnoSalud, Av. Granaderos #1483
- Las cirugías en Santiago con el Dr. Rodrigo Villagran se realizan en Clínica Tabancura, RedSalud Vitacura
- El balón gástrico, la manga gástrica y el bypass gástrico lo ofrecen Dr. Nelson Aros, Dr. Rodrigo Villagran y Dr. Alberto Sirabo
- Las cirugías plásticas en Antofagasta las ofrecen Francisco Bencina, Edmundo Ziede y Rosirys Ruiz
- si quiere avanzar, cotizar, agendar o resolver su caso, pedir teléfono
- si ya entregó teléfono y ya tenemos lo esencial, cerrar cordialmente
`.trim();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: stateSummary },
        ...history
      ]
    })
  });

  const raw = await response.text();
  console.log("OpenAI raw:", raw);

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${raw}`);
  }

  const data = JSON.parse(raw);
  return data?.choices?.[0]?.message?.content?.trim() || "Gracias por escribirnos.";
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

  return JSON.parse(raw);
}

app.get("/", (req, res) => {
  res.send("Clinyco Conversations AI OK");
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

app.post("/ticket-assigned", (req, res) => {
  try {
    console.log("===== /ticket-assigned webhook =====");
    console.log("Body:", safeJson(req.body));

    const { event, conversation_id, assignee_id } = req.body || {};

    if (!conversation_id) {
      return res.status(400).json({ ok: false, error: "Missing conversation_id" });
    }

    const state = getConversationState(conversation_id);
    state.system.aiEnabled = false;
    state.system.humanTakenOver = true;
    state.system.assigneeId = assignee_id || null;
    state.system.handoffReason = "ticket_assigned";

    console.log("AI disabled for conversation:", conversation_id);
    console.log("Conversation state:", safeJson(state));

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

    const state = getConversationState(conversationId);

    if (!state.system.aiEnabled) {
      console.log("AI blocked: disabled for", conversationId);
      return res.json({ ok: true, skipped: "ai_disabled" });
    }

    if (state.system.botMessagesSent >= MAX_BOT_MESSAGES) {
      state.system.aiEnabled = false;
      console.log("AI disabled: max bot messages reached for", conversationId);
      return res.json({ ok: true, skipped: "max_bot_messages_reached" });
    }

    if (authorType === "business" && sourceType !== "api:conversations") {
      state.system.aiEnabled = false;
      state.system.humanTakenOver = true;
      state.system.handoffReason = "human_business_message_detected";
      console.log("AI disabled due to human business message:", conversationId);
      console.log("Business sourceType:", sourceType);
      return res.json({ ok: true, skipped: "human_business_message_detected" });
    }

    if (authorType !== "user") {
      return res.json({ ok: true, skipped: "non_user_message" });
    }

    if (!appId || !userText) {
      return res.json({ ok: true, skipped: "payload_not_parsed_yet" });
    }

    updateDraftsFromText(state, userText, info);

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
        const reply = getMeasurementInstructionMessage();
        addToHistory(conversationId, "user", userText);
        addToHistory(conversationId, "assistant", reply);
        const delayMs = calculateHumanDelay(reply);
        await sleep(delayMs);
        const latestState = getConversationState(conversationId);
        if (!latestState.system.aiEnabled) {
          return res.json({ ok: true, skipped: "ai_disabled_after_delay" });
        }
        await sendConversationReply(appId, conversationId, appendAntoniaIntroduction(latestState, reply));
        latestState.system.botMessagesSent += 1;
        if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
          latestState.system.aiEnabled = false;
        }
        return res.json({ ok: true, reply, delayMs, botMessagesSent: latestState.system.botMessagesSent });
      } else {
        const reply = "Para confirmar, responde 1 si está correcto o 2 si no.";
        addToHistory(conversationId, "user", userText);
        addToHistory(conversationId, "assistant", reply);
        const delayMs = calculateHumanDelay(reply);
        await sleep(delayMs);
        const latestState = getConversationState(conversationId);
        if (!latestState.system.aiEnabled) {
          return res.json({ ok: true, skipped: "ai_disabled_after_delay" });
        }
        await sendConversationReply(appId, conversationId, appendAntoniaIntroduction(latestState, reply));
        latestState.system.botMessagesSent += 1;
        if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
          latestState.system.aiEnabled = false;
        }
        return res.json({ ok: true, reply, delayMs, botMessagesSent: latestState.system.botMessagesSent });
      }
    } else {
      const bmiContext = buildBMIContext(userText);
      if (bmiContext) {
        if (bmiContext.ambiguous) {
          state.measurements.pendingConfirmation = true;
          state.measurements.proposedWeightKg = bmiContext.weightKg;
          state.measurements.proposedHeightM = bmiContext.heightM;
          state.measurements.proposedHeightCm = bmiContext.heightCm;

          const reply = getMeasurementConfirmationMessage(bmiContext.weightKg, bmiContext.heightM);
          addToHistory(conversationId, "user", userText);
          addToHistory(conversationId, "assistant", reply);

          const delayMs = calculateHumanDelay(reply);
          await sleep(delayMs);
          const latestState = getConversationState(conversationId);
          if (!latestState.system.aiEnabled) {
            return res.json({ ok: true, skipped: "ai_disabled_after_delay" });
          }
          await sendConversationReply(appId, conversationId, appendAntoniaIntroduction(latestState, reply));
          latestState.system.botMessagesSent += 1;
          if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
            latestState.system.aiEnabled = false;
          }
          return res.json({ ok: true, reply, delayMs, botMessagesSent: latestState.system.botMessagesSent });
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
      state.system.aiEnabled = false;
      state.system.handoffReason = "unknown_professional_schedule";
      const reply = getUnknownProfessionalScheduleMessage(unknownProfessionalSchedule.professionalName);
      addToHistory(conversationId, "assistant", reply);
      const delayMs = calculateHumanDelay(reply);
      await sleep(delayMs);
      await sendConversationReply(appId, conversationId, appendAntoniaIntroduction(state, reply));
      state.system.botMessagesSent += 1;
      return res.json({
        ok: true,
        reply,
        delayMs,
        botMessagesSent: state.system.botMessagesSent,
        handoffReason: state.system.handoffReason
      });
    }

    await maybeRunIdentitySearch(state, info);

    if (shouldTriggerCaseE(state)) {
      state.identity.likelyClinicalRecordOnly = true;
      state.system.aiEnabled = false;
      state.system.handoffReason = "clinical_record_only";
      const reply = getCaseEMessage();
      addToHistory(conversationId, "assistant", reply);
      const delayMs = calculateHumanDelay(reply);
      await sleep(delayMs);
      await sendConversationReply(appId, conversationId, appendAntoniaIntroduction(state, reply));
      state.system.botMessagesSent += 1;
      return res.json({ ok: true, reply, delayMs, botMessagesSent: state.system.botMessagesSent });
    }

    if (shouldAskForFonasaTramo(state)) {
      const reply = "Perfecto. ¿Me indicas tu tramo de Fonasa? Puede ser A, B, C o D.";
      addToHistory(conversationId, "assistant", reply);
      const delayMs = calculateHumanDelay(reply);
      await sleep(delayMs);
      const latestState = getConversationState(conversationId);
      if (!latestState.system.aiEnabled) {
        return res.json({ ok: true, skipped: "ai_disabled_after_delay" });
      }
      const finalReply = appendAntoniaIntroduction(latestState, reply);
      await sendConversationReply(appId, conversationId, finalReply);
      latestState.system.botMessagesSent += 1;
      if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
        latestState.system.aiEnabled = false;
      }
      return res.json({ ok: true, reply: finalReply, delayMs, botMessagesSent: latestState.system.botMessagesSent });
    }

    if (shouldAskForSpecificAseguradora(state, userText)) {
      const reply = "Perfecto. ¿Qué aseguradora tienes? Por ejemplo Banmédica, Colmena, Consalud o Cruz Blanca.";
      addToHistory(conversationId, "assistant", reply);
      const delayMs = calculateHumanDelay(reply);
      await sleep(delayMs);
      const latestState = getConversationState(conversationId);
      if (!latestState.system.aiEnabled) {
        return res.json({ ok: true, skipped: "ai_disabled_after_delay" });
      }
      const finalReply = appendAntoniaIntroduction(latestState, reply);
      await sendConversationReply(appId, conversationId, finalReply);
      latestState.system.botMessagesSent += 1;
      if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
        latestState.system.aiEnabled = false;
      }
      return res.json({ ok: true, reply: finalReply, delayMs, botMessagesSent: latestState.system.botMessagesSent });
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

    if (resolverDecision.shouldDerive) {
      state.system.aiEnabled = false;
      state.system.handoffReason = resolverDecision.caseType === "E"
        ? "clinical_record_only"
        : (state.system.handoffReason || "resolver_derive");

      const reply = resolverDecision.question;
      addToHistory(conversationId, "assistant", reply);
      const delayMs = calculateHumanDelay(reply);
      await sleep(delayMs);
      await sendConversationReply(appId, conversationId, appendAntoniaIntroduction(state, reply));
      state.system.botMessagesSent += 1;
      return res.json({
        ok: true,
        reply,
        delayMs,
        botMessagesSent: state.system.botMessagesSent,
        handoffReason: state.system.handoffReason,
        resolverDecision
      });
    }

    if (shouldUseResolverQuestion(state, resolverDecision)) {
      const reply = resolverDecision.question;
      addToHistory(conversationId, "assistant", reply);
      const delayMs = calculateHumanDelay(reply);
      await sleep(delayMs);

      const latestState = getConversationState(conversationId);
      if (!latestState.system.aiEnabled) {
        return res.json({ ok: true, skipped: "ai_disabled_after_delay" });
      }

      const finalReply = appendAntoniaIntroduction(latestState, reply);
      await sendConversationReply(appId, conversationId, finalReply);
      latestState.system.botMessagesSent += 1;
      if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
        latestState.system.aiEnabled = false;
      }

      return res.json({
        ok: true,
        reply: finalReply,
        delayMs,
        botMessagesSent: latestState.system.botMessagesSent,
        resolverDecision
      });
    }

    console.log("Conversation history:", safeJson(getHistory(conversationId)));
    console.log("Conversation state:", safeJson(state));

    let reply = await askOpenAI(conversationId, state);
    reply = appendAntoniaIntroduction(state, reply);

    const isTenthMessage = state.system.botMessagesSent + 1 >= MAX_BOT_MESSAGES;
    if (isTenthMessage) {
      const closure = getMaxMessagesClosure();
      reply = `${reply}\n\n${closure}`;
    }

    addToHistory(conversationId, "assistant", reply);

    const delayMs = calculateHumanDelay(reply);
    console.log("Human delay ms:", delayMs);
    await sleep(delayMs);

    const latestState = getConversationState(conversationId);
    if (!latestState.system.aiEnabled) {
      console.log("AI send cancelled after delay due to disabled state:", conversationId);
      return res.json({ ok: true, skipped: "ai_disabled_after_delay" });
    }

    if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
      latestState.system.aiEnabled = false;
      console.log("AI send cancelled after delay due to max bot messages:", conversationId);
      return res.json({ ok: true, skipped: "max_bot_messages_reached_after_delay" });
    }

    await sendConversationReply(appId, conversationId, reply);

    latestState.system.botMessagesSent += 1;
    console.log("Bot messages sent:", latestState.system.botMessagesSent, "for", conversationId);

    if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {
      latestState.system.aiEnabled = false;
      latestState.system.handoffReason = latestState.system.handoffReason || "max_bot_messages_reached";
      console.log("AI disabled after message #10:", conversationId);
    }

    return res.json({
      ok: true,
      reply,
      delayMs,
      botMessagesSent: latestState.system.botMessagesSent,
      contactDraft: latestState.contactDraft,
      dealDraft: latestState.dealDraft
    });
  } catch (error) {
    console.error("ERROR /messages:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Clinyco Conversations AI running on port ${PORT}`);
});
