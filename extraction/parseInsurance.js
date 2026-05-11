import { normalizeKey } from "../utils/text.js";

export const ASEGURADORA_ALIASES = {
  "BANMEDICA": "BANMEDICA",
  "COLMENA": "COLMENA",
  "CONSALUD": "CONSALUD",
  "CRUZ BLANCA": "CRUZ BLANCA",
  "CRUZBLANCA": "CRUZ BLANCA",
  "CRUZ DEL NORTE": "CRUZ DEL NORTE",
  "DIPRECA": "DIPRECA",
  "ESENCIAL": "ESENCIAL",
  "FONASA": "FONASA",
  "FUNDACION": "FUNDACION",
  "FUNDACIÓN": "FUNDACION",
  "I SALUD": "I SALUD - EX CHUQUICAMATA",
  "CHUQUICAMATA": "I SALUD - EX CHUQUICAMATA",
  "JEAFOSALE": "JEAFOSALE",
  "MEDIMEL": "MEDIMEL-BANMEDICA",
  "NUEVA MAS VIDA": "NUEVA MAS VIDA",
  "MAS VIDA": "NUEVA MAS VIDA",
  "VIDA TRES": "VIDA TRES",
  "PARTICULAR": "PARTICULAR",
  "PAD": "PAD Fonasa PAD",
  "PAD FONASA": "PAD Fonasa PAD"
};

export const MODALIDAD_FROM_ASEGURADORA = {
  "BANMEDICA": "Banmédica",
  "COLMENA": "Colmena",
  "CONSALUD": "Consalud",
  "CRUZ BLANCA": "Cruz Blanca",
  "CRUZ DEL NORTE": "Cruz Norte",
  "DIPRECA": "DIPRECA",
  "FONASA": "Fonasa",
  "FUNDACION": "Fundación",
  "I SALUD - EX CHUQUICAMATA": "I. Chuquicamata",
  "MEDIMEL-BANMEDICA": "MEDIMEL-CB",
  "NUEVA MAS VIDA": "Más Vida",
  "PARTICULAR": "Particular",
  "VIDA TRES": "Vida Tres"
};

export function parseAseguradora(text) {
  const normalized = normalizeKey(text);
  for (const [alias, canonical] of Object.entries(ASEGURADORA_ALIASES)) {
    if ((' ' + normalized + ' ').includes(' ' + alias + ' ')) {
      return {
        aseguradora: canonical,
        modalidad: MODALIDAD_FROM_ASEGURADORA[canonical] || null,
        isFonasa: canonical === "FONASA" || canonical === "PAD Fonasa PAD",
        isIsapreGeneric: false
      };
    }
  }

  if (normalized.includes("ISAPRE")) {
    return {
      aseguradora: null,
      modalidad: null,
      isFonasa: false,
      isIsapreGeneric: true
    };
  }

  return null;
}

export function parseFonasaTramo(text) {
  const normalized = normalizeKey(text);
  const match = normalized.match(/\bTRAMO\s+([ABCD])\b/) || normalized.match(/^([ABCD])$/);
  if (!match) return null;
  const tramo = match[1].toUpperCase();
  return {
    tramo,
    modalidad: `Tramo ${tramo}`,
    isPadEligible: tramo !== "A"
  };
}
