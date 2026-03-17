import { readAllKnowledge } from "./repository.js";

function listActiveRecords(payload) {
  if (!payload || !Array.isArray(payload.records)) return [];
  return payload.records.filter((record) => record && record.activo !== false);
}

function formatList(values = []) {
  return (Array.isArray(values) ? values : [])
    .filter(Boolean)
    .join(", ");
}

export function buildKnowledgePromptContext() {
  const snapshot = readAllKnowledge();
  const lines = [];

  const clinics = listActiveRecords(snapshot.clinics).slice(0, 6);
  if (clinics.length) {
    lines.push("Base de conocimiento operativa:");
    lines.push("- Sedes:");
    for (const clinic of clinics) {
      const bits = [
        clinic.sede,
        clinic.ciudad,
        clinic.modalidad,
        clinic.direccion,
        clinic.observaciones
      ].filter(Boolean);
      lines.push(`  - ${bits.join(" | ")}`);
    }
  }

  const doctors = listActiveRecords(snapshot.doctors).slice(0, 8);
  if (doctors.length) {
    lines.push("- Profesionales:");
    for (const doctor of doctors) {
      const bits = [
        doctor.profesional,
        doctor.especialidad,
        formatList(doctor.procedimientos),
        formatList(doctor.sedes),
        doctor.observaciones
      ].filter(Boolean);
      lines.push(`  - ${bits.join(" | ")}`);
    }
  }

  const procedures = listActiveRecords(snapshot.procedures).slice(0, 8);
  if (procedures.length) {
    lines.push("- Procedimientos:");
    for (const procedure of procedures) {
      const bits = [
        procedure.procedimiento,
        procedure.categoria,
        procedure.requiere_peso_estatura ? "Pedir peso y estatura" : null,
        procedure.se_puede_orientar_sin_rut ? "Se puede orientar sin RUT" : null,
        procedure.observaciones
      ].filter(Boolean);
      lines.push(`  - ${bits.join(" | ")}`);
    }
  }

  const coverageRules = listActiveRecords(snapshot.coverage_rules).slice(0, 8);
  if (coverageRules.length) {
    lines.push("- Reglas de cobertura:");
    for (const rule of coverageRules) {
      const bits = [
        rule.cobertura,
        rule.modalidad,
        rule.regla_simple,
        rule.siguiente_dato ? `Luego pedir: ${rule.siguiente_dato}` : null
      ].filter(Boolean);
      lines.push(`  - ${bits.join(" | ")}`);
    }
  }

  const faqs = listActiveRecords(snapshot.faq_medical_safe).slice(0, 6);
  if (faqs.length) {
    lines.push("- FAQ seguras:");
    for (const faq of faqs) {
      const bits = [
        `Pregunta: ${faq.pregunta_frecuente}`,
        `Respuesta: ${faq.respuesta_aprobada}`,
        faq.cuando_derivar ? `Derivar: ${faq.cuando_derivar}` : null,
        faq.no_prometer ? `No prometer: ${faq.no_prometer}` : null
      ].filter(Boolean);
      lines.push(`  - ${bits.join(" | ")}`);
    }
  }

  return lines.join("\n");
}
