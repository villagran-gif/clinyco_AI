import {
  addCustomerChannel,
  buildCustomerProfile,
  getCustomerSummaries,
  insertConversationSummary,
  linkConversationToCustomer,
  refreshCustomerConversationStats,
  upsertCustomer
} from "../db.js";
import { normalizePhone, normalizeRut } from "../extraction/identity-normalizers.js";

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function isWhatsappSource(value) {
  return /whatsapp/i.test(String(value || ""));
}

function setIfEmpty(target, key, value) {
  if (!target || !key) return;
  if (!value) return;
  if (target[key] === null || target[key] === undefined || String(target[key]).trim() === "") {
    target[key] = value;
  }
}

function buildDisplayName(customer) {
  return cleanText([customer?.nombres, customer?.apellidos].filter(Boolean).join(" "));
}

function formatSummaryDate(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function extractPreviousConversationFacts(summaries = []) {
  return summaries.map((summary) => ({
    conversationId: summary.conversation_id,
    canal: summary.canal || null,
    procedimiento: summary.procedimiento || null,
    stageFinal: summary.stage_final || null,
    outcome: summary.outcome || null,
    keyFacts: summary.key_facts || {},
    createdAt: summary.created_at || null
  }));
}

function buildKeyFacts(state = {}, customer = null) {
  const contact = state.contactDraft || {};
  const deal = state.dealDraft || {};
  const measurements = state.measurements || {};
  const identity = state.identity || {};

  return {
    customer_id: customer?.id || null,
    rut: normalizeRut(contact.c_rut || customer?.rut),
    whatsapp_phone: normalizePhone(identity.whatsappPhone || identity.channelExternalId || customer?.whatsapp_phone),
    telefono_principal: normalizePhone(contact.c_tel1 || customer?.telefono_principal),
    email: cleanText(contact.c_email || customer?.email)?.toLowerCase() || null,
    nombres: cleanText(contact.c_nombres || customer?.nombres),
    apellidos: cleanText(contact.c_apellidos || customer?.apellidos),
    comuna: cleanText(contact.c_comuna || customer?.comuna),
    aseguradora: cleanText(contact.c_aseguradora || customer?.aseguradora),
    modalidad: cleanText(contact.c_modalidad || customer?.modalidad),
    procedimiento: cleanText(deal.dealInteres || customer?.ultimo_procedimiento),
    peso: measurements.weightKg ?? deal.dealPeso ?? customer?.peso ?? null,
    altura_cm: measurements.heightCm ?? deal.dealEstatura ?? customer?.altura_cm ?? null,
    imc: measurements.bmi ?? customer?.imc ?? null,
    categoria_imc: cleanText(measurements.bmiCategory || customer?.categoria_imc),
    handoff_reason: state?.system?.handoffReason || null,
    case_type: identity.caseType || null,
    next_action: identity.nextAction || null
  };
}

function inferOutcome(state = {}) {
  const handoffReason = cleanText(state?.system?.handoffReason);
  if (handoffReason) return `handoff:${handoffReason}`;
  if (state?.system?.humanTakenOver) return "human_takeover";
  if (Number(state?.system?.botMessagesSent || 0) >= 10) return "max_bot_messages_reached";
  return "conversation_checkpoint";
}

function inferStageFinal(state = {}) {
  return cleanText(
    state?.identity?.lastResolvedStage ||
    state?.identity?.lastResolvedContext?.stage ||
    state?.identity?.caseType
  );
}

export function enrichStateFromCustomer(state, customer, summaries = [], options = {}) {
  if (!customer) {
    state.customerMemory = {
      customerId: null,
      previousConversations: [],
      isReturning: false
    };
    return state;
  }

  const populateDrafts = options.populateDrafts !== false;
  if (populateDrafts) {
    setIfEmpty(state.contactDraft, "c_rut", customer.rut);
    setIfEmpty(state.contactDraft, "c_nombres", customer.nombres);
    setIfEmpty(state.contactDraft, "c_apellidos", customer.apellidos);
    setIfEmpty(state.contactDraft, "c_fecha", customer.fecha_nacimiento ? String(customer.fecha_nacimiento).slice(0, 10) : null);
    setIfEmpty(state.contactDraft, "c_tel1", customer.telefono_principal || customer.whatsapp_phone);
    setIfEmpty(state.contactDraft, "c_tel2", customer.telefono_principal || customer.whatsapp_phone);
    setIfEmpty(state.contactDraft, "c_email", customer.email);
    setIfEmpty(state.contactDraft, "c_aseguradora", customer.aseguradora);
    setIfEmpty(state.contactDraft, "c_modalidad", customer.modalidad);
    setIfEmpty(state.contactDraft, "c_direccion", customer.direccion);
    setIfEmpty(state.contactDraft, "c_comuna", customer.comuna);

    setIfEmpty(state.dealDraft, "dealInteres", customer.ultimo_procedimiento);
    setIfEmpty(state.dealDraft, "dealPeso", customer.peso);
    setIfEmpty(state.dealDraft, "dealEstatura", customer.altura_cm);

    setIfEmpty(state.measurements, "weightKg", customer.peso);
    setIfEmpty(state.measurements, "heightCm", customer.altura_cm);
    setIfEmpty(state.measurements, "bmi", customer.imc);
    setIfEmpty(state.measurements, "bmiCategory", customer.categoria_imc);
  }

  state.identity.customerId = customer.id;
  state.customerMemory = {
    customerId: customer.id,
    previousConversations: extractPreviousConversationFacts(summaries),
    isReturning: summaries.length > 0
  };

  return state;
}

export function buildCustomerContextBlock(customer, summaries = [], options = {}) {
  if (!customer) return null;

  const limitedSummaries = summaries.slice(0, 3);
  const includeSensitiveIdentity = options.includeSensitiveIdentity !== false;
  const lines = [
    "[MEMORIA_CLIENTE]"
  ];

  if (includeSensitiveIdentity) {
    const displayName = buildDisplayName(customer);
    if (displayName) lines.push(`Nombre: ${displayName}`);

    const idLineParts = [];
    if (customer.whatsapp_phone) idLineParts.push(`WhatsApp: ${customer.whatsapp_phone}`);
    if (customer.rut) idLineParts.push(`RUT: ${customer.rut}`);
    if (idLineParts.length) lines.push(idLineParts.join(" | "));
  } else {
    lines.push("Contexto tentativo por numero de WhatsApp.");
    lines.push("No asumas identidad ni reveles datos personales o historicos como hechos confirmados.");
    lines.push("Usa este contexto solo para formular una pregunta breve de verificacion.");
  }

  if (includeSensitiveIdentity && limitedSummaries.length > 0) {
    const latestDate = formatSummaryDate(limitedSummaries[0].created_at);
    if (latestDate) lines.push(`Ultima conversacion: ${latestDate}`);
  }

  for (const summary of includeSensitiveIdentity ? limitedSummaries : []) {
    const items = [];
    if (summary.procedimiento) items.push(summary.procedimiento);
    if (summary.outcome) items.push(summary.outcome);
    if (summary.stage_final) items.push(`stage=${summary.stage_final}`);
    if (items.length) {
      lines.push(`- ${items.join(" | ")}`);
    }

    const keyFacts = summary.key_facts || {};
    const factParts = [];
    if (keyFacts.aseguradora) factParts.push(`Prevision: ${keyFacts.aseguradora}`);
    if (keyFacts.modalidad) factParts.push(`Modalidad: ${keyFacts.modalidad}`);
    if (keyFacts.comuna) factParts.push(`Comuna: ${keyFacts.comuna}`);
    if (factParts.length) {
      lines.push(`- ${factParts.join(" | ")}`);
    }
  }

  if (!includeSensitiveIdentity && summaries.length > 0) {
    lines.push("Hay historial previo asociado a este numero, pero sigue siendo contexto tentativo.");
  }

  if (includeSensitiveIdentity && summaries.length > 0) {
    lines.push(`Cliente recurrente (${summaries.length} conversaciones previas resumidas)`);
  }

  lines.push("[/MEMORIA_CLIENTE]");
  return lines.join("\n");
}

export async function saveConversationToCustomer(customerId, conversationId, state, channel = null) {
  const conversationAt = new Date().toISOString();
  const customerProfile = buildCustomerProfile(state);
  const customer = await upsertCustomer(customerProfile, {
    customerId,
    conversationAt
  });

  if (!customer) return null;

  const identity = state.identity || {};
  const verified = Boolean(identity.verifiedPairAt || identity.verifiedRutAt);
  const canAttachWhatsapp = Boolean(
    customerProfile.whatsappPhone ||
    (isWhatsappSource(identity.channelSourceType) && identity.channelExternalId)
  );

  await linkConversationToCustomer(conversationId, customer.id, {
    channel,
    channelExternalId: identity.channelExternalId || null,
    channelDisplayName: identity.channelDisplayName || null,
    sourceProfileName: identity.sourceProfileName || null,
    whatsappPhone: customerProfile.whatsappPhone
  });

  if (canAttachWhatsapp) {
    await addCustomerChannel({
      customerId: customer.id,
      channelType: "whatsapp",
      channelValue: customerProfile.whatsappPhone,
      isPrimary: true,
      verified,
      sourceSystem: isWhatsappSource(identity.channelSourceType) ? identity.channelSourceType || "sunco" : "sunco",
      externalId: isWhatsappSource(identity.channelSourceType) ? identity.channelExternalId || null : null,
      metadata: {
        conversationId,
        channel,
        channelDisplayName: identity.channelDisplayName || null,
        sourceProfileName: identity.sourceProfileName || null
      }
    });
  }

  if (customerProfile.telefonoPrincipal) {
    await addCustomerChannel({
      customerId: customer.id,
      channelType: "phone",
      channelValue: customerProfile.telefonoPrincipal,
      isPrimary: customerProfile.telefonoPrincipal === customerProfile.whatsappPhone,
      verified,
      sourceSystem: "conversation",
      metadata: { conversationId, channel }
    });
  }

  if (customerProfile.email) {
    await addCustomerChannel({
      customerId: customer.id,
      channelType: "email",
      channelValue: customerProfile.email,
      verified,
      sourceSystem: "conversation",
      metadata: { conversationId, channel }
    });
  }

  await insertConversationSummary({
    customerId: customer.id,
    conversationId,
    canal: channel,
    procedimiento: customerProfile.ultimoProcedimiento,
    stageFinal: inferStageFinal(state),
    outcome: inferOutcome(state),
    keyFacts: buildKeyFacts(state, customer)
  });

  await refreshCustomerConversationStats(customer.id);
  state.identity.customerId = customer.id;
  return customer;
}

export async function loadCustomerMemory(customerId, limit = 3) {
  if (!customerId) return [];
  return getCustomerSummaries(customerId, limit);
}
