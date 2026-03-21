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

  // --- Profesionales detalle operativo (from "Equipo medico" tab) ---
  const profDetail = (snapshot.professionals_detail?.records || [])
    .filter((r) => r && r.nombre_profesional)
    .slice(0, 60);
  if (profDetail.length) {
    lines.push("Base de conocimiento operativa:");
    lines.push("- Equipo médico (detalle operativo):");
    for (const p of profDetail) {
      const bits = [
        p.nombre_profesional,
        p.categoria_operativa,
        p.especialidad_web,
        p.horario ? `Horario: ${p.horario}` : null,
        p.valor_interpretado || p.valor ? `Valor: ${p.valor_interpretado || p.valor}` : null,
        p.valor_observacion ? `(${p.valor_observacion})` : null,
        p.previo_pago ? `Previo pago: ${p.previo_pago}` : null,
        p.duracion_interpretada || p.duracion ? `Duración: ${p.duracion_interpretada || p.duracion}` : null,
        p.limites_edad ? `Edad: ${p.limites_edad}` : null,
        p.telemedicina ? `Modalidad: ${p.telemedicina}` : null,
        p.sobrecupo ? `Sobrecupo: ${p.sobrecupo}` : null,
        p.revision_examenes ? `Rev. exámenes: ${p.revision_examenes}` : null,
        p.revision_examenes_dias ? `(${p.revision_examenes_dias})` : null,
        p.observaciones && p.observaciones !== "SIN OBSERVACIONES" ? `Obs: ${p.observaciones}` : null,
        p.notas ? `Notas: ${p.notas}` : null,
        p.agendamiento_web ? `Agenda web: ${p.agendamiento_web}` : null
      ].filter(Boolean);
      lines.push(`  - ${bits.join(" | ")}`);
    }
  }

  // --- Procedimientos (from "examenes" tab) ---
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

  // --- FAQ seguras (from "preguntas frecuentes" tab) ---
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
