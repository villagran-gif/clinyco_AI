import { fichaFields, conversationStages } from "../config/conversation-config.js";

const stageFieldPriority = {
  [conversationStages.INFO_GENERAL]: [],
  [conversationStages.EVALUACION_CLINICA]: ["c_aseguradora", "c_modalidad", "dealPeso", "dealEstatura"],
  [conversationStages.AGENDA_O_FICHA]: ["c_rut", "c_email", "c_tel1", "c_nombres", "c_apellidos"],
  [conversationStages.PACIENTE_EXISTENTE]: ["c_rut"],
  [conversationStages.POSTOPERATORIO_O_EXAMENES]: ["c_rut", "c_email", "c_tel1"]
};

export function getNextMissingFichaField(state, stage) {
  const draft = state?.contactDraft || {};
  const deal = state?.dealDraft || {};
  const missing = [];

  for (const key of fichaFields) {
    if (!draft[key]) missing.push(key);
  }

  if (!deal.dealInteres) missing.push("dealInteres");
  if (!deal.dealPeso) missing.push("dealPeso");
  if (!deal.dealEstatura) missing.push("dealEstatura");

  const priority = stageFieldPriority[stage] || [];
  const prioritizedMissing = priority.find((field) => missing.includes(field)) || missing[0] || null;

  return {
    stage,
    missing,
    nextField: prioritizedMissing
  };
}
