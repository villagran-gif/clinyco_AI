import { conversationStages } from "../config/conversation-config.js";

export function decideResponseStrategy({ stage, state, nextMissing }) {
  const hasKnownIdentity = Boolean(state?.contactDraft?.c_rut || state?.contactDraft?.c_email || state?.contactDraft?.c_tel1);

  if (stage === conversationStages.INFO_GENERAL) {
    return {
      strategy: "inform_then_optional_question",
      objective: "orientar_primero",
      askIdentityNow: false,
      missingField: nextMissing?.nextField || null
    };
  }

  if (stage === conversationStages.EVALUACION_CLINICA) {
    return {
      strategy: "ask_one_clinical_field",
      objective: "evaluar_caso",
      askIdentityNow: false,
      missingField: nextMissing?.nextField || null
    };
  }

  if (stage === conversationStages.PACIENTE_EXISTENTE) {
    return {
      strategy: "ask_identity_minimum",
      objective: "ubicar_ficha",
      askIdentityNow: true,
      missingField: state?.contactDraft?.c_rut ? null : "c_rut"
    };
  }

  if (stage === conversationStages.AGENDA_O_FICHA) {
    return {
      strategy: hasKnownIdentity ? "advance_scheduling" : "ask_identity_minimum",
      objective: "agendar_o_derivar",
      askIdentityNow: !hasKnownIdentity,
      missingField: nextMissing?.nextField || null
    };
  }

  return {
    strategy: "inform_then_optional_question",
    objective: "orientar_primero",
    askIdentityNow: false,
    missingField: nextMissing?.nextField || null
  };
}
