import { extractEmail, extractPhone, extractRut, extractName, splitNames, detectExistingPatientIntent } from "./identity-normalizers.js";
import { parseAseguradora, parseFonasaTramo } from "./parseInsurance.js";
import { detectProcedure } from "./detectProcedure.js";
import { parseStructuredBlock } from "./parseStructuredBlock.js";

export function updateDraftsFromText(state, text, info = {}) {
  const cleanText = String(text || "");
  const structured = parseStructuredBlock(cleanText);

  const email = structured.email || extractEmail(cleanText);
  if (email) state.contactDraft.c_email = email;

  const phone = structured.phone || extractPhone(cleanText);
  if (phone) {
    state.contactDraft.c_tel1 = phone;
    if (!state.contactDraft.c_tel2) state.contactDraft.c_tel2 = phone;
  }

  const rut = structured.rut || extractRut(cleanText);
  if (rut) state.contactDraft.c_rut = rut;

  const fullName = structured.fullName || extractName(cleanText);
  if (fullName) {
    const split = splitNames(fullName);
    if (split.nombres) state.contactDraft.c_nombres = split.nombres;
    if (split.apellidos) state.contactDraft.c_apellidos = split.apellidos;
  }

  if (!state.contactDraft.c_nombres && info.authorDisplayName) {
    const split = splitNames(info.authorDisplayName);
    if (split.nombres) state.contactDraft.c_nombres = split.nombres;
    if (split.apellidos) state.contactDraft.c_apellidos = split.apellidos;
  }

  if (structured.birthDate) state.contactDraft.c_fecha = structured.birthDate;
  if (structured.city) state.contactDraft.c_comuna = structured.city;

  const insuranceInfo = parseAseguradora(cleanText);
  if (insuranceInfo?.aseguradora) {
    state.contactDraft.c_aseguradora = insuranceInfo.aseguradora;
    if (insuranceInfo.aseguradora !== "FONASA" && insuranceInfo.modalidad) {
      state.contactDraft.c_modalidad = insuranceInfo.modalidad;
    }
  }

  const tramo = parseFonasaTramo(cleanText);
  if (tramo) {
    state.contactDraft.c_aseguradora = "FONASA";
    state.contactDraft.c_modalidad = tramo.modalidad;
    state.dealDraft.dealValidacionPad = tramo.isPadEligible
      ? "Posible evaluación PAD Fonasa"
      : "No aplica PAD Fonasa por Tramo A";
  }

  const procedure = detectProcedure(cleanText);
  if (procedure) {
    state.dealDraft.dealInteres = procedure.label;
    if (!state.dealDraft.dealPipelineId && procedure.pipelineId) {
      state.dealDraft.dealPipelineId = procedure.pipelineId;
    }
  }

  if (detectExistingPatientIntent(cleanText)) {
    state.identity.saysExistingPatient = true;
  }

  if (structured.weightKg) state.dealDraft.dealPeso = String(structured.weightKg);
  if (structured.heightCm) state.dealDraft.dealEstatura = String(structured.heightCm);
  if (structured.bmi) {
    state.measurements.weightKg = structured.weightKg;
    state.measurements.heightM = structured.heightM;
    state.measurements.heightCm = structured.heightCm;
    state.measurements.bmi = structured.bmi;
    state.measurements.bmiCategory = structured.bmiCategory;
  }

  return state;
}
