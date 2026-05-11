import { createHash } from "node:crypto";
import { inferBestNextAction } from "./prediction.js";

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
  const actionLabel = inferBestNextAction(resolverDecision);

  const body = [
    "--- EugenIA (nota interna) ---",
    patientLine,
    `Lead Score: ${leadScoreLine}${delta}`,
    "",
    "Pregunta sugerida(copy, paste):",
    "",
    suggestedQuestion,
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
