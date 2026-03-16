import { conversationStages } from "../config/conversation-config.js";
import { includesAny, normalizeKey } from "../utils/text.js";

const INFO_GENERAL_PHRASES = [
  "REQUISITOS", "INFORMACION", "INFORMACIÓN", "COMO ES", "COMO FUNCIONA", "QUIERO SABER", "DUDAS"
];

const EVALUACION_PHRASES = [
  "CALIFICO", "CALIFICA", "ME SIRVE", "PESO", "ESTATURA", "IMC", "OBESIDAD"
];

const AGENDA_PHRASES = [
  "QUIERO HORA", "AGENDAR", "AGENDA", "RESERVAR", "HORA", "DISPONIBILIDAD", "CITA"
];

const EXISTING_PATIENT_PHRASES = [
  "YA SOY PACIENTE", "YA TENGO FICHA", "SOY PACIENTE", "ME OPERE", "ME OPERÉ"
];

const POSTOP_PHRASES = [
  "EXAMENES", "EXÁMENES", "ORDENES", "ÓRDENES", "PRE CIRUGIA", "PRE CIRUGÍA", "POST OP", "POSTOP"
];

export function getConversationStage({ state, userText = "", intent = null }) {
  const text = normalizeKey(userText);

  if (state?.identity?.saysExistingPatient || includesAny(text, EXISTING_PATIENT_PHRASES)) {
    return conversationStages.PACIENTE_EXISTENTE;
  }

  if (includesAny(text, POSTOP_PHRASES)) {
    return conversationStages.POSTOPERATORIO_O_EXAMENES;
  }

  if (includesAny(text, AGENDA_PHRASES)) {
    return conversationStages.AGENDA_O_FICHA;
  }

  if (includesAny(text, EVALUACION_PHRASES) || state?.measurements?.weightKg || state?.measurements?.heightM) {
    return conversationStages.EVALUACION_CLINICA;
  }

  if (includesAny(text, INFO_GENERAL_PHRASES) || intent === "info_general") {
    return conversationStages.INFO_GENERAL;
  }

  return conversationStages.INFO_GENERAL;
}
