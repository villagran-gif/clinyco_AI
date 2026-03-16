export function buildStateSummary(state) {
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

  if (state.identity.sellSummary) parts.push(`[SELL_RESUMEN] ${state.identity.sellSummary}`);
  if (state.identity.supportSummary) parts.push(`[SUPPORT_RESUMEN] ${state.identity.supportSummary}`);
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
