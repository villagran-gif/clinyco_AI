/**
 * Calcula el lead score basado en el estado actual de la conversación.
 * Score 0-100: frío (0-39), tibio (40-69), caliente (70-100).
 * @param {object} state - conversation state completo
 * @returns {{ score: number, category: string, reasons: string[], calculatedAt: string }}
 */
export function calculateLeadScore(state) {
  let score = 0;
  const reasons = [];

  // ── IMC (max +25) ──
  const bmi = state.measurements?.bmi;
  if (bmi >= 35)      { score += 25; reasons.push("IMC >= 35"); }
  else if (bmi >= 30) { score += 15; reasons.push("IMC 30-35"); }
  else if (bmi >= 25) { score += 5;  reasons.push("IMC 25-30"); }

  // ── Previsión (+15) ──
  if (state.contactDraft?.c_aseguradora) { score += 15; reasons.push("previsión"); }

  // ── Datos de contacto (+10 tel, +5 email) ──
  if (state.contactDraft?.c_tel1)  { score += 10; reasons.push("teléfono"); }
  if (state.contactDraft?.c_email) { score += 5;  reasons.push("email"); }

  // ── RUT verificado (+10) ──
  if (state.identity?.verifiedRutAt) { score += 10; reasons.push("RUT verificado"); }

  // ── Procedimiento definido (+15) ──
  if (state.dealDraft?.dealInteres) { score += 15; reasons.push("procedimiento"); }

  // ── Engagement (+5 o +10 mutuamente excluyentes) ──
  const msgs = state.system?.botMessagesSent || 0;
  if (msgs > 10)     { score += 10; reasons.push("engagement alto"); }
  else if (msgs > 5) { score += 5;  reasons.push("engagement medio"); }

  // ── Cita agendada (+15) ──
  if (state.booking?.chosenSlot) { score += 15; reasons.push("cita agendada"); }

  // ── Deal existente en Sell (+10) ──
  if (state.identity?.caseType === "A") { score += 10; reasons.push("deal existente"); }

  // ── Canal WhatsApp (+5) ──
  if (state.identity?.channelSourceType === "whatsapp") { score += 5; reasons.push("WhatsApp"); }

  // ── Urgencia: pidió agendar (+10) ──
  if (state.booking?.pendingSlots || state.booking?.pendingProfessional) {
    score += 10; reasons.push("pidió agendar");
  }

  const capped = Math.min(score, 100);
  const category = capped >= 70 ? "caliente" : capped >= 40 ? "tibio" : "frío";

  return {
    score: capped,
    category,
    reasons,
    calculatedAt: new Date().toISOString()
  };
}
