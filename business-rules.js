export const MEDINET_AGENDA_WEB_URL = "https://clinyco.medinetapp.com/agendaweb/planned/";

export const PAD_ELIGIBLE_TRAMOS = ["Tramo B", "Tramo C", "Tramo D"];
export const PAD_INELIGIBLE_TRAMOS = ["Tramo A"];
export const PAD_PROCEDURES = [
  "Tratamiento quirúrgico de abdomen flácido",
  "Cirugía bariátrica por by-pass gástrico con seguimiento",
  "Cirugía bariátrica por manga gástrica con seguimiento",
  "Tratamiento quirúrgico de colelitiasis"
];

export const PROVIDER_AVAILABILITY = {
  "RODRIGO VILLAGRAN": {
    displayName: "Dr. Rodrigo Villagrán",
    modalities: ["presencial", "telemedicina"],
    locations: ["Santiago", "Antofagasta", "Calama"]
  }
};

export function isPadEligibleModality(modality) {
  return PAD_ELIGIBLE_TRAMOS.includes(String(modality || "").trim());
}

export function getProviderAvailability(key) {
  return PROVIDER_AVAILABILITY[key] || null;
}

export function buildBusinessFactsPrompt() {
  const villagran = PROVIDER_AVAILABILITY["RODRIGO VILLAGRAN"];
  return [
    "- Clinyco tiene presencia en Antofagasta, Calama y Santiago",
    "- Endoscopía solo en Antofagasta",
    "- La agenda médica completa está disponible en Antofagasta",
    "- En Calama las consultas presenciales con cirujanos se realizan en DiagnoSalud, Av. Granaderos #1483",
    `- ${villagran.displayName} atiende en modalidad ${villagran.modalities.join(" y ")} en ${villagran.locations.join(", ")}`,
    "- Las cirugías plásticas en Antofagasta las ofrecen Francisco Bencina, Edmundo Ziede y Rosirys Ruiz",
    `- Bono PAD Fonasa: solo aplica para ${PAD_ELIGIBLE_TRAMOS.join(", ")} y no aplica para ${PAD_INELIGIBLE_TRAMOS.join(", ")}`,
    `- Prestaciones PAD que ofrece Clinyco: ${PAD_PROCEDURES.join("; ")}`
  ].join("\n");
}

export function buildPadEligibilityReply(modality = null) {
  const cleanModality = String(modality || "").trim();
  const eligibleList = PAD_ELIGIBLE_TRAMOS.join(", ");

  if (cleanModality && isPadEligibleModality(cleanModality)) {
    return `Sí. Para Fonasa ${cleanModality}, el bono PAD puede aplicar. En Clinyco trabajamos PAD para estas prestaciones: ${PAD_PROCEDURES.join(", ")}.`;
  }

  if (cleanModality && PAD_INELIGIBLE_TRAMOS.includes(cleanModality)) {
    return `Para Fonasa ${cleanModality}, el bono PAD no aplica. En Clinyco el PAD Fonasa aplica solo para ${eligibleList}.`;
  }

  return `En Clinyco, el bono PAD Fonasa aplica solo para ${eligibleList}. No aplica para ${PAD_INELIGIBLE_TRAMOS.join(", ")}.`;
}

export function buildPadProceduresReply() {
  return `Las prestaciones PAD Fonasa que trabajamos en Clinyco son: ${PAD_PROCEDURES.join(", ")}.`;
}

export function buildProviderAvailabilityReply(providerKey) {
  const provider = getProviderAvailability(providerKey);
  if (!provider) return null;

  return `${provider.displayName} atiende en modalidad ${provider.modalities.join(" y ")} en ${provider.locations.join(", ")}. Si quieres, puedo ayudarte a dejar tu solicitud lista o también puedes revisar la agenda web: ${MEDINET_AGENDA_WEB_URL}`;
}
