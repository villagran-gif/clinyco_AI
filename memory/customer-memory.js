import { getCustomerSummaries, insertConversationSummary, upsertCustomer, addCustomerChannel, recalcTotalConversaciones, dbEnabled } from "../db.js";

/**
 * Enriquece el state con datos conocidos del customer.
 * REGLA: nunca sobrescribe datos que ya existen en el state actual.
 * Solo llena campos que están null/vacíos.
 */
export function enrichStateFromCustomer(state, customer, summaries = []) {
  if (!customer) return state;

  const cd = state.contactDraft;
  if (!cd.c_rut && customer.rut) cd.c_rut = customer.rut;
  if (!cd.c_nombres && customer.nombres) cd.c_nombres = customer.nombres;
  if (!cd.c_apellidos && customer.apellidos) cd.c_apellidos = customer.apellidos;
  if (!cd.c_email && customer.email) cd.c_email = customer.email;
  if (!cd.c_tel1 && customer.tel1) cd.c_tel1 = customer.tel1;
  if (!cd.c_fecha && customer.fecha_nacimiento) cd.c_fecha = customer.fecha_nacimiento;
  if (!cd.c_aseguradora && customer.aseguradora) cd.c_aseguradora = customer.aseguradora;
  if (!cd.c_modalidad && customer.modalidad) cd.c_modalidad = customer.modalidad;
  if (!cd.c_direccion && customer.direccion) cd.c_direccion = customer.direccion;
  if (!cd.c_comuna && customer.comuna) cd.c_comuna = customer.comuna;

  const dd = state.dealDraft;
  if (!dd.dealInteres && customer.ultimo_procedimiento) dd.dealInteres = customer.ultimo_procedimiento;
  if (!dd.dealPeso && customer.peso) dd.dealPeso = Number(customer.peso);
  if (!dd.dealEstatura && customer.altura_cm) dd.dealEstatura = Number(customer.altura_cm);

  const m = state.measurements;
  if (!m.bmi && customer.imc) m.bmi = Number(customer.imc);
  if (!m.bmiCategory && customer.categoria_imc) m.bmiCategory = customer.categoria_imc;
  if (!m.heightCm && customer.altura_cm) m.heightCm = Number(customer.altura_cm);
  if (!m.weightKg && customer.peso) m.weightKg = Number(customer.peso);

  state.customerMemory = {
    customerId: customer.id,
    isReturning: (customer.total_conversaciones || 0) > 0,
    totalConversaciones: customer.total_conversaciones || 0,
    previousSummaries: summaries.slice(0, 3)
  };

  return state;
}

/**
 * Genera bloque [MEMORIA_CLIENTE] para inyectar en el contexto de OpenAI.
 * Máximo 3 conversaciones previas resumidas.
 */
export function buildCustomerContextBlock(customer, summaries = []) {
  if (!customer) return "";

  const parts = ["[MEMORIA_CLIENTE]"];

  const nombre = [customer.nombres, customer.apellidos].filter(Boolean).join(" ");
  if (nombre) parts.push(`Nombre: ${nombre}`);
  if (customer.whatsapp_phone) parts.push(`WhatsApp: ${customer.whatsapp_phone}`);
  if (customer.rut) parts.push(`RUT: ${customer.rut}`);
  if (customer.aseguradora) parts.push(`Previsión: ${customer.aseguradora}${customer.modalidad ? ` ${customer.modalidad}` : ""}`);
  if (customer.comuna) parts.push(`Comuna: ${customer.comuna}`);
  if (customer.ultimo_procedimiento) parts.push(`Último procedimiento consultado: ${customer.ultimo_procedimiento}`);

  const totalConv = customer.total_conversaciones || 0;
  if (totalConv > 0) {
    parts.push(`Conversaciones previas: ${totalConv}`);
  }

  if (summaries.length > 0) {
    parts.push("");
    parts.push("Historial reciente:");
    for (const s of summaries.slice(0, 3)) {
      const fecha = s.created_at ? new Date(s.created_at).toLocaleDateString("es-CL") : "?";
      const items = [];
      if (s.procedimiento) items.push(s.procedimiento);
      if (s.outcome) items.push(`resultado: ${s.outcome}`);
      if (s.stage_final) items.push(`etapa: ${s.stage_final}`);
      if (Array.isArray(s.key_facts)) {
        for (const fact of s.key_facts) items.push(fact);
      }
      parts.push(`  - ${fecha}: ${items.join(" | ") || s.canal || "sin detalle"}`);
    }
  }

  if (totalConv > 0) {
    parts.push("");
    parts.push("IMPORTANTE: Esta persona ya ha conversado antes. Reconócela y usa el contexto previo de forma natural.");
  }

  parts.push("[/MEMORIA_CLIENTE]");
  return parts.join("\n");
}

/**
 * Guarda un resumen de la conversación actual en la ficha del customer.
 * Se llama al derivar (handoff), cerrar, o alcanzar max_messages.
 */
export async function saveConversationToCustomer(customerId, conversationId, state, channel) {
  if (!dbEnabled() || !customerId) return;

  const procedimiento = state?.dealDraft?.dealInteres || null;
  const stageFinal = state?.identity?.caseType || null;
  const handoff = state?.system?.handoffReason || null;
  const outcome = handoff ? `derivado: ${handoff}` : (state?.system?.humanTakenOver ? "tomado_por_humano" : "en_proceso");

  const keyFacts = [];
  if (state?.contactDraft?.c_aseguradora) keyFacts.push(`Previsión: ${state.contactDraft.c_aseguradora}`);
  if (state?.contactDraft?.c_modalidad) keyFacts.push(`Modalidad: ${state.contactDraft.c_modalidad}`);
  if (state?.contactDraft?.c_comuna) keyFacts.push(`Comuna: ${state.contactDraft.c_comuna}`);
  if (state?.measurements?.bmi) keyFacts.push(`IMC: ${state.measurements.bmi}`);
  if (state?.identity?.sellContactFound) keyFacts.push("Encontrado en Sell");
  if (state?.identity?.foundInSupport) keyFacts.push("Encontrado en Support");

  await insertConversationSummary({
    customerId,
    conversationId,
    canal: channel || null,
    procedimiento,
    stageFinal,
    outcome,
    keyFacts
  });

  // Sincronizar datos confirmados al customer (solo no-null, COALESCE en DB)
  const cd = state?.contactDraft || {};
  const dd = state?.dealDraft || {};
  const m = state?.measurements || {};

  await upsertCustomer({
    rut: cd.c_rut || null,
    whatsappPhone: null,
    nombres: cd.c_nombres || null,
    apellidos: cd.c_apellidos || null,
    email: cd.c_email || null,
    tel1: cd.c_tel1 || null,
    fechaNacimiento: cd.c_fecha || null,
    aseguradora: cd.c_aseguradora || null,
    modalidad: cd.c_modalidad || null,
    direccion: cd.c_direccion || null,
    comuna: cd.c_comuna || null,
    ultimoProcedimiento: dd.dealInteres || null,
    peso: m.weightKg || dd.dealPeso || null,
    alturaCm: m.heightCm || dd.dealEstatura || null,
    imc: m.bmi || null,
    categoriaBmi: m.bmiCategory || null
  });

  // Recalcular total_conversaciones desde conteo real de summaries
  await recalcTotalConversaciones(customerId);
}

/**
 * Carga los summaries de un customer para construir el contexto.
 */
export async function loadCustomerContext(customerId) {
  if (!dbEnabled() || !customerId) return [];
  return getCustomerSummaries(customerId, 5);
}
