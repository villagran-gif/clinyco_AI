import { createHash } from "node:crypto";
import { inferBestNextAction } from "./prediction.js";

const COPY_PASTE_MAP = {
  identity_min: "Hola! Para poder ayudarte mejor, ¿me compartes tu teléfono o correo electrónico?",
  dealInteres: "Cuéntame, ¿qué procedimiento o evaluación te interesa? Así te puedo orientar mejor 😊",
  c_aseguradora: "¿Cuál es tu previsión de salud? Por ejemplo Fonasa, Banmédica, Cruz Blanca, Consalud o particular",
  c_modalidad: "¿Me indicas tu tramo de Fonasa? Puede ser A, B, C o D",
  dealPeso: "Para orientarte mejor necesito saber tu peso en kilos, ¿me lo puedes indicar?",
  dealEstatura: "¿Y tu estatura? Puedes escribirla en metros, por ejemplo 1.70"
};

function leadScoreBadge(category) {
  if (category === "caliente") return "🔴";
  if (category === "tibio") return "🟡";
  return "🔵";
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

export function buildEugeniaInternalNote({ state, resolverDecision, previousScore = null }) {
  const leadScore = state?.leadScore || {};
  const leadScoreLine = formatLeadScoreDetail(leadScore);
  const delta = previousScore == null
    ? ""
    : ` (delta ${(leadScore.score || 0) - previousScore >= 0 ? "+" : ""}${(leadScore.score || 0) - previousScore})`;

  const contactName = [state?.contactDraft?.c_nombres, state?.contactDraft?.c_apellidos].filter(Boolean).join(" ");
  const patientLine = contactName
    ? `Paciente: ${contactName}${state?.contactDraft?.c_tel1 ? ` | ${state.contactDraft.c_tel1}` : ""}${state?.contactDraft?.c_email ? ` | ${state.contactDraft.c_email}` : ""}`
    : "Paciente: nuevo (sin datos aún)";

  const suggestedQuestion = resolverDecision?.question || "Sin pregunta sugerida";
  const missingFields = Array.isArray(resolverDecision?.missingFields) ? resolverDecision.missingFields : [];
  const copyPaste = COPY_PASTE_MAP[missingFields[0] || ""] || "";
  const actionLabel = inferBestNextAction(resolverDecision);

  const body = [
    "--- EugenIA (nota interna) ---",
    patientLine,
    `Lead Score: ${leadScoreLine}${delta}`,
    "",
    `Pregunta sugerida: ${suggestedQuestion}`,
    copyPaste ? `Versión para copiar y pegar:\n${copyPaste}` : "",
    "",
    `Acción sugerida: ${actionLabel}`,
    missingFields.length ? `Campos faltantes: ${missingFields.join(", ")}` : ""
  ].filter(Boolean).join("\n");

  return {
    body,
    fingerprint: createHash("sha1").update(body).digest("hex"),
    actionLabel
  };
}
