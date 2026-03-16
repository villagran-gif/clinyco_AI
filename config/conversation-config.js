export const conversationConfig = {
  maxBotMessages: Number(process.env.MAX_BOT_MESSAGES || 15),
  maxHistoryMessages: Number(process.env.MAX_HISTORY_MESSAGES || 20),
  maxCuratedExamples: Number(process.env.MAX_CURATED_EXAMPLES || 3),
  askIdentityEarlyForScheduling: true,
  askIdentityEarlyForGeneralInfo: false,
  requireReasonBeforeSensitiveData: true,
  allowPhoneOrEmailInsteadOfRut: true,
  staleResponseGuardEnabled: true,
  friendlyIdentityPreamble: true,
  supportFallbackByNameEnabled: true,
  supportFallbackByNameOnlyWhenNoStrongIdentifier: true,
  supportIgnoreNotificationUsers: true,
  supportIgnorePageProfiles: true,
  supportIgnoreDoctorProfiles: true,
  useCuratedExamples: true
};

export const fichaFields = [
  "c_nombres",
  "c_apellidos",
  "c_rut",
  "c_fecha",
  "c_email",
  "c_aseguradora",
  "c_modalidad",
  "c_direccion",
  "c_comuna",
  "c_tel1"
];

export const sensitiveIdentityFields = ["c_rut", "c_email", "c_tel1"];

export const conversationStages = {
  INFO_GENERAL: "info_general",
  EVALUACION_CLINICA: "evaluacion_clinica",
  AGENDA_O_FICHA: "agenda_o_ficha",
  PACIENTE_EXISTENTE: "paciente_existente",
  POSTOPERATORIO_O_EXAMENES: "postoperatorio_o_examenes"
};
