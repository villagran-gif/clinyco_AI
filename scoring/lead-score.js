/**
 * Lead scoring determinista (0-100) con 15 dimensiones, pipeline-aware.
 * Pipelines: Bariatrica, Balon, Plastica, General.
 * IMC invertido para plastica (menor = mejor candidato).
 */

const PIPELINE_NAMES = {
  1290779: '\u2696\uFE0F"BARI\u00C1TRICA"',
  4823817: '\uD83C\uDF88"BAL\u00D3N"',
  4959507: '\uD83D\uDC8E"PL\u00C1STICA"',
  5049979: '\u24BC"GENERAL"'
};

export function calculateLeadScore(state) {
  let score = 0;
  const reasons = [];
  const pipelineId = state.dealDraft?.dealPipelineId || null;
  const pipeline = PIPELINE_NAMES[pipelineId] || null;

  // 1. IMC (max +25) — invertido para plastica
  const bmi = state.measurements?.bmi;
  const isPlastica = pipelineId === 4959507;
  if (isPlastica) {
    if (bmi && bmi <= 27)      { score += 25; reasons.push("IMC \u2264 27(+25)"); }
    else if (bmi && bmi <= 30) { score += 15; reasons.push("IMC 27-30(+15)"); }
  } else {
    if (bmi >= 35)      { score += 25; reasons.push("IMC \u2265 35(+25)"); }
    else if (bmi >= 30) { score += 15; reasons.push("IMC 30-35(+15)"); }
    else if (bmi >= 25) { score += 5;  reasons.push("IMC 25-30(+5)"); }
  }

  // 2. Prevision (+15)
  if (state.contactDraft?.c_aseguradora) { score += 15; reasons.push("previsi\u00F3n(+15)"); }

  // 3. Telefono (+10)
  if (state.contactDraft?.c_tel1) { score += 10; reasons.push("tel\u00E9fono(+10)"); }

  // 4. Email (+5)
  if (state.contactDraft?.c_email) { score += 5; reasons.push("email(+5)"); }

  // 5. RUT verificado (+10)
  if (state.identity?.verifiedRutAt) { score += 10; reasons.push("RUT verificado(+10)"); }

  // 6. Procedimiento definido (+15)
  if (state.dealDraft?.dealInteres) { score += 15; reasons.push("procedimiento(+15)"); }

  // 7. Engagement (+5 o +10)
  const msgs = state.system?.botMessagesSent || 0;
  if (msgs > 10)     { score += 10; reasons.push("engagement alto(+10)"); }
  else if (msgs > 5) { score += 5;  reasons.push("engagement medio(+5)"); }

  // 8. Cita agendada (+15)
  if (state.booking?.chosenSlot) { score += 15; reasons.push("cita agendada(+15)"); }

  // 9. Deal existente en Sell (+10)
  if (state.identity?.caseType === "A") { score += 10; reasons.push("deal existente(+10)"); }

  // 10. Canal WhatsApp (+5)
  if (state.identity?.channelSourceType === "whatsapp") { score += 5; reasons.push("WhatsApp(+5)"); }

  // 11. Pidio agendar (+10)
  if (state.booking?.pendingSlots || state.booking?.pendingProfessional) {
    score += 10; reasons.push("pidi\u00F3 agendar(+10)");
  }

  // 12. Condicion medica conocida (+10)
  const interes = String(state.dealDraft?.dealInteres || "").toUpperCase();
  const CONDITIONS = ["COLELITIASIS", "HERNIA", "ANTIRREFLUJO", "VESICULA", "COLECISTECTOMIA"];
  const matchedCondition = CONDITIONS.find(c => interes.includes(c));
  if (matchedCondition) { score += 10; reasons.push(`${matchedCondition.toLowerCase()}(+10)`); }

  // 13. Modalidad Fonasa (+5)
  if (state.contactDraft?.c_modalidad) { score += 5; reasons.push("modalidad(+5)"); }

  // 14. Nombre completo (+5)
  if (state.contactDraft?.c_nombres && state.contactDraft?.c_apellidos) {
    score += 5; reasons.push("nombre completo(+5)");
  }

  // 15. Paciente recurrente (+5)
  if (state.customerMemory?.isReturning) { score += 5; reasons.push("recurrente(+5)"); }

  const capped = Math.min(score, 100);
  const category = capped >= 70 ? "caliente" : capped >= 40 ? "tibio" : "fr\u00EDo";
  const emoji = capped >= 70 ? "\uD83D\uDD34" : capped >= 40 ? "\uD83D\uDFE1" : "\uD83D\uDD35";

  return {
    score: capped,
    category,
    emoji,
    pipeline,
    pipelineId,
    reasons,
    calculatedAt: new Date().toISOString()
  };
}
