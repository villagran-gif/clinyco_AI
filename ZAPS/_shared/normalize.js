/**
 * Shared normalization + formatting helpers used across Zap replacements.
 *
 * Pure functions, no network calls — safe to unit-test in isolation.
 */

// ---- Pipeline & Stage catalogs (mirror of scripts/sync-deals.js) ------------

export const PIPELINE_NAMES = {
  1290779: "Pipeline Cirugía Bariátricas",
  4823817: "Pipeline Balones",
  4959507: "Pipeline Cirugía Plástica",
  5049979: "Pipeline Cirugía General"
};

export const STAGE_NAMES = {
  // Bariátricas
  10693252: "CANDIDATO",
  35699717: "EXAMENES PRE-PAD ENVIADOS",
  10693253: "EXAMENES ENVIADOS",
  10693255: "PROCESO PREOP",
  35531166: "CERRADO AGENDADO",
  10693256: "CERRADO OPERADO",
  10693257: "SUSPENDIDO",
  10693258: "SIN RESPUESTA",
  // Balones
  36009807: "CANDIDATOS",
  36009808: "EXAMENES ALLURION",
  36009814: "EXAMENES ORBERA",
  36009809: "CONTROLES PRE-INSTALACIÓN",
  36009810: "CERRADO AGENDADO",
  36009811: "CERRADO INSTALADO",
  36009812: "DESCALIFICADO",
  36009813: "SIN RESPUESTA",
  // Plástica
  36975471: "CANDIDATO",
  36975472: "ORDEN DE EXAMENES",
  37188752: "PROCESO PRE-OPERATORIO",
  36975473: "CERRADO AGENDADO",
  36975475: "CERRADO OPERADO",
  36975476: "DESCALIFICADO",
  36975477: "SIN RESPUESTA"
  // Pipeline Cirugía General stages — add here as the team finalizes them.
};

function extractDigits(raw) {
  const match = String(raw || "").match(/\d+/);
  return match ? match[0] : "";
}

export function resolvePipelineName(pipelineId) {
  const key = extractDigits(pipelineId);
  return PIPELINE_NAMES[key] || "Pipeline desconocido";
}

export function resolveStageName(stageId) {
  const key = extractDigits(stageId);
  return STAGE_NAMES[key] || "Stage desconocido";
}

// ---- RUT ---------------------------------------------------------------------

/**
 * Strip all dots and hyphens from a Chilean RUT/ID string.
 * Mirrors the two Zapier Formatter `string.replace` steps (".", "-") used in
 * Update Comisiones, ZendeskSell Normaliza RUT al crear contacto, and
 * RUT Normalizado Crear Trato.
 */
export function normalizeRut(raw) {
  return String(raw || "").replace(/[.\-]/g, "");
}

// ---- Dates -------------------------------------------------------------------

/** "DD-MM-YYYY" → "YYYY-MM-DD". Empty/invalid input returns "". */
export function formatDateDmyToYmd(input) {
  if (input == null || input === "") return "";
  const match = String(input).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return "";
  const [, d, m, y] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Any ISO-ish datetime → "YYYY-MM-DD" (UTC). Empty/invalid returns "". */
export function formatDateToYmd(input) {
  if (input == null || input === "") return "";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

// ---- Misc --------------------------------------------------------------------

/** Build a wa.me link from a phone number; returns "" if no digits. */
export function whatsappLink(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}
