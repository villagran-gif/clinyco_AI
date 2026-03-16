const BMI_REQUIRED_PROCEDURES = [
  "BALON GASTRICO",
  "CIRUGIA BARIATRICA"
];

function clean(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function firstTruthy(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function normalizeRut(value) {
  const raw = String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (raw.length < 2) return null;
  return `${raw.slice(0, -1)}-${raw.slice(-1)}`;
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("56") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("9") && digits.length === 9) return `+56${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

function normalizeEmail(value) {
  const email = clean(value).toLowerCase();
  return email || null;
}

function normalizeInsurance(value) {
  const key = normalizeKey(value);
  if (!key) return null;
  if (key.includes("FONASA")) return "FONASA";
  if (key.includes("BANMEDICA")) return "BANMEDICA";
  if (key.includes("CONSALUD")) return "CONSALUD";
  if (key.includes("CRUZ BLANCA")) return "CRUZ BLANCA";
  if (key.includes("COLMENA")) return "COLMENA";
  if (key.includes("VIDA TRES")) return "VIDA TRES";
  if (key.includes("MAS VIDA")) return "NUEVA MAS VIDA";
  if (key.includes("PARTICULAR")) return "PARTICULAR";
  return clean(value).toUpperCase() || null;
}

function normalizeProcedure(value) {
  const key = normalizeKey(value);
  if (!key) return null;
  if (key.includes("BALON")) return "Balón gástrico";
  if (key.includes("BARIATR") || key.includes("MANGA") || key.includes("BYPASS")) return "Cirugía bariátrica";
  if (key.includes("PLASTICA") || key.includes("ABDOMINOPLASTIA") || key.includes("LIPO") || key.includes("MAMOPLASTIA")) return "Cirugía plástica";
  if (key.includes("HERNIA") || key.includes("VESICULA") || key.includes("ENDOSCOP")) return "Cirugía general";
  return clean(value) || null;
}

function extractSupportHintsFromText(text) {
  const raw = String(text || "");
  const key = normalizeKey(raw);
  return {
    procedure: normalizeProcedure(raw),
    insurance: normalizeInsurance(raw),
    modality: key.includes("TRAMO A") ? "Tramo A"
      : key.includes("TRAMO B") ? "Tramo B"
      : key.includes("TRAMO C") ? "Tramo C"
      : key.includes("TRAMO D") ? "Tramo D"
      : null,
    saysPatient: key.includes("SOY PACIENTE") || key.includes("YA SOY PACIENTE") || key.includes("YA ME ATENDI") || key.includes("YA ME OPERE"),
    email: normalizeEmail(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null),
    phone: normalizePhone(raw.match(/(?:\+?56\s*)?9\s*\d(?:[\s.-]*\d){7,8}/i)?.[0] || null),
    rut: normalizeRut(raw.match(/\b\d{1,2}[.]?\d{3}[.]?\d{3}-?[\dkK]\b/)?.[0] || null)
  };
}

function summarizeSupport(supportResult = {}) {
  const users = Array.isArray(supportResult.users) ? supportResult.users : [];
  const tickets = Array.isArray(supportResult.tickets) ? supportResult.tickets : [];
  const latestTicket = tickets[0] || {};
  const firstUser = users[0] || {};
  const hints = extractSupportHintsFromText(
    [
      latestTicket.subject,
      latestTicket.description,
      latestTicket.raw_subject,
      latestTicket.via?.source?.from?.name,
      firstUser.notes,
      firstUser.user_fields?.user_prevision_salud,
      firstUser.user_fields?.user_direccion,
      firstUser.user_fields?.social_messaging_user_info
    ].filter(Boolean).join(" ")
  );

  return {
    foundInSupport: Boolean(supportResult.found || users.length || tickets.length),
    ticketCount: tickets.length,
    latestTicketId: latestTicket.id || null,
    usersCount: users.length,
    knownData: {
      c_nombres: clean(firstTruthy(firstUser?.name, supportResult.name)) || null,
      c_email: normalizeEmail(firstTruthy(firstUser?.email, hints.email)),
      c_tel1: normalizePhone(firstTruthy(firstUser?.phone, hints.phone)),
      c_rut: normalizeRut(hints.rut),
      c_aseguradora: hints.insurance,
      c_modalidad: hints.modality,
      dealInteres: hints.procedure
    },
    priorContext: {
      lastProcedure: hints.procedure,
      lastInsurance: hints.insurance,
      lastModality: hints.modality,
      wasPatientMentioned: hints.saysPatient,
      ticketSubjects: tickets.slice(0, 3).map((ticket) => ticket.subject).filter(Boolean)
    }
  };
}

function summarizeSell(sellResult = {}) {
  const deals = Array.isArray(sellResult.deals) ? sellResult.deals : [];
  const primaryDeal = sellResult.deal || deals[0] || null;
  const contact = sellResult.contact || null;

  return {
    foundInSell: Boolean(contact || sellResult.contacts_found > 0 || primaryDeal || sellResult.deals_found_total > 0 || sellResult.deals_found > 0),
    hasDeal: Boolean(primaryDeal || sellResult.deals_found_total > 0 || sellResult.deals_found > 0),
    knownData: {
      c_rut: normalizeRut(firstTruthy(contact?.rut, contact?.c_rut, sellResult.rut)),
      c_nombres: clean(firstTruthy(contact?.display_name, contact?.name)) || null,
      c_email: normalizeEmail(firstTruthy(contact?.email)),
      c_tel1: normalizePhone(firstTruthy(contact?.phone, contact?.mobile)),
      c_aseguradora: normalizeInsurance(firstTruthy(contact?.c_aseguradora, contact?.aseguradora)),
      c_modalidad: clean(firstTruthy(contact?.c_modalidad, contact?.modalidad)) || null,
      dealInteres: normalizeProcedure(firstTruthy(primaryDeal?.name, primaryDeal?.dealInteres, primaryDeal?.interest)),
      dealPeso: firstTruthy(primaryDeal?.dealPeso, primaryDeal?.weight) || null,
      dealEstatura: firstTruthy(primaryDeal?.dealEstatura, primaryDeal?.height) || null
    }
  };
}

function mergeKnownData(state = {}, supportSummary = {}, sellSummary = {}) {
  const contactDraft = state.contactDraft || {};
  const dealDraft = state.dealDraft || {};
  return {
    c_rut: normalizeRut(firstTruthy(contactDraft.c_rut, sellSummary.knownData?.c_rut, supportSummary.knownData?.c_rut)),
    c_nombres: clean(firstTruthy(contactDraft.c_nombres, sellSummary.knownData?.c_nombres, supportSummary.knownData?.c_nombres)) || null,
    c_apellidos: clean(contactDraft.c_apellidos) || null,
    c_email: normalizeEmail(firstTruthy(contactDraft.c_email, sellSummary.knownData?.c_email, supportSummary.knownData?.c_email)),
    c_tel1: normalizePhone(firstTruthy(contactDraft.c_tel1, sellSummary.knownData?.c_tel1, supportSummary.knownData?.c_tel1)),
    c_aseguradora: normalizeInsurance(firstTruthy(contactDraft.c_aseguradora, sellSummary.knownData?.c_aseguradora, supportSummary.knownData?.c_aseguradora)),
    c_modalidad: clean(firstTruthy(contactDraft.c_modalidad, sellSummary.knownData?.c_modalidad, supportSummary.knownData?.c_modalidad)) || null,
    dealInteres: normalizeProcedure(firstTruthy(dealDraft.dealInteres, sellSummary.knownData?.dealInteres, supportSummary.knownData?.dealInteres)),
    dealPeso: firstTruthy(dealDraft.dealPeso, sellSummary.knownData?.dealPeso),
    dealEstatura: firstTruthy(dealDraft.dealEstatura, sellSummary.knownData?.dealEstatura)
  };
}

function inferCaseType({ state, supportSummary, sellSummary, knownData, latestUserText }) {
  const hints = extractSupportHintsFromText(latestUserText);
  const saysExistingPatient = Boolean(state?.identity?.saysExistingPatient || hints.saysPatient);

  if (saysExistingPatient && knownData.c_rut && !sellSummary.foundInSell && !supportSummary.foundInSupport) return "E";
  if (sellSummary.foundInSell && sellSummary.hasDeal) return "A";
  if (sellSummary.foundInSell && !sellSummary.hasDeal) return "B";
  if (!sellSummary.foundInSell && supportSummary.foundInSupport) return "C";
  if (saysExistingPatient && (sellSummary.foundInSell || supportSummary.foundInSupport || knownData.c_rut)) return "D";
  return "C";
}

function inferNextAction({ caseType, knownData }) {
  if (caseType === "E") return "derive";
  if (!knownData.c_rut && !knownData.c_email && !knownData.c_tel1) return "ask_identity";
  if (caseType === "A") return "continue";
  return "complete_missing";
}

function requiresBMI(interest) {
  return BMI_REQUIRED_PROCEDURES.includes(normalizeKey(interest));
}

function hasMinimumClinicalData(knownData) {
  if (!knownData.dealInteres) return false;
  if (!knownData.c_aseguradora) return false;
  if (knownData.c_aseguradora === "FONASA" && !knownData.c_modalidad) return false;
  if (requiresBMI(knownData.dealInteres) && (!knownData.dealPeso || !knownData.dealEstatura)) return false;
  return true;
}

function hasCommercialContactData(knownData) {
  return Boolean(knownData.c_tel1 || knownData.c_email || knownData.c_rut);
}

function hasPositiveAdvanceIntent(text) {
  const key = normalizeKey(text);
  if (!key) return false;
  return ["SI", "SII", "SII QUIERO", "QUIERO AVANZAR", "QUIERO AGENDAR", "ME GUSTARIA AGENDAR", "AGENDAR", "AVANCEMOS", "DALE", "OK", "CLARO"].some((phrase) => key === phrase || key.includes(phrase));
}

function hasScheduleIntent(text) {
  const key = normalizeKey(text);
  return ["HORA", "HORAS", "HORARIO", "HORARIOS", "DISPONIBILIDAD", "AGENDA", "AGENDAR", "RESERVAR", "CITA"].some((phrase) => key.includes(phrase));
}

function detectStage({ state, resolved, latestUserText }) {
  const knownData = resolved.knownData || {};
  const key = normalizeKey(latestUserText);
  const hasMinimum = hasMinimumClinicalData(knownData) && hasCommercialContactData(knownData);

  if (resolved.caseType === "E") return "clinical_record_only";
  if (hasMinimum && hasScheduleIntent(latestUserText)) return "agenda_without_direct_access";
  if (hasMinimum && hasPositiveAdvanceIntent(latestUserText)) return "ready_for_handoff";
  if (hasMinimum && key === "NO") return "handoff_without_call";
  if (resolved.caseType === "A") return "existing_deal";
  if (resolved.foundInSupport && !resolved.foundInSell) return "support_context_recovery";
  if (!knownData.dealInteres) return "missing_interest";
  if (!knownData.c_aseguradora) return "missing_insurance";
  if (knownData.c_aseguradora === "FONASA" && !knownData.c_modalidad) return "missing_modality";
  if (requiresBMI(knownData.dealInteres) && (!knownData.dealPeso || !knownData.dealEstatura)) return "missing_bmi_inputs";
  return "general_guidance";
}

function buildHandoffMessage(resolved, variant = "default") {
  const data = resolved.knownData || {};
  const firstName = clean((data.c_nombres || "").split(" ")[0]);
  const greetingName = firstName ? `${firstName} 😊` : "😊";
  const parts = [];
  const interes = data.dealInteres ? ` de ${data.dealInteres.toLowerCase()}` : "";
  const coverage = [data.c_aseguradora, data.c_modalidad].filter(Boolean).join(" ");

  if (variant === "no_call") {
    parts.push(`Perfecto, ${greetingName} entonces no te llamaremos por ahora.`);
  } else {
    parts.push(`Perfecto, ${greetingName} ya tengo tus datos principales para avanzar${interes}.`);
  }

  if (coverage) {
    parts.push(`Quedas registrada con ${coverage}.`);
  }

  if (variant === "schedule_web") {
    parts.push("En este momento no puedo ver horarios específicos, así que voy a dejar tu solicitud lista para que una agente te ayude con la coordinación.");
    parts.push("Si quieres, también puedes revisar disponibilidad en nuestra agenda web: https://clinyco.medinetapp.com/agendaweb/planned/");
  } else {
    parts.push("Voy a dejar tu solicitud lista para que una agente te ayude con la coordinación.");
    parts.push("Si quieres, también puedes revisar disponibilidad en nuestra agenda web: https://clinyco.medinetapp.com/agendaweb/planned/");
  }

  return parts.join(" ");
}

function getMissingFields(resolved) {
  const data = resolved.knownData || {};
  const missing = [];

  if (!data.c_rut && !data.c_email && !data.c_tel1) missing.push("identity_min");
  if (!data.dealInteres) missing.push("dealInteres");
  if (!data.c_aseguradora) missing.push("c_aseguradora");
  if (data.c_aseguradora === "FONASA" && !data.c_modalidad) missing.push("c_modalidad");

  if (requiresBMI(data.dealInteres)) {
    if (!data.dealPeso) missing.push("dealPeso");
    if (!data.dealEstatura) missing.push("dealEstatura");
  }

  if (resolved.caseType === "A") {
    return missing.filter((field) => ["c_aseguradora", "c_modalidad", "dealPeso", "dealEstatura"].includes(field));
  }

  return missing;
}

export function resolveIdentityAndContext({ state = {}, supportResult = null, sellResult = null, latestUserText = "" }) {
  const supportSummary = summarizeSupport(supportResult || state?.identity?.supportRaw || {});
  const sellSummary = summarizeSell(sellResult || state?.identity?.sellRaw || {});
  const knownData = mergeKnownData(state, supportSummary, sellSummary);
  const caseType = inferCaseType({ state, supportSummary, sellSummary, knownData, latestUserText });
  const nextAction = inferNextAction({ caseType, knownData });
  const stage = detectStage({ state, resolved: { knownData, caseType, foundInSupport: supportSummary.foundInSupport, foundInSell: sellSummary.foundInSell }, latestUserText });

  return {
    foundInSupport: supportSummary.foundInSupport,
    foundInSell: sellSummary.foundInSell,
    hasDeal: sellSummary.hasDeal,
    knownData,
    priorContext: supportSummary.priorContext,
    caseType,
    nextAction,
    stage,
    supportSummary,
    sellSummary
  };
}

export function getNextBestQuestion(state = {}, supportResult = null, sellResult = null, latestUserText = "") {
  const resolved = resolveIdentityAndContext({ state, supportResult, sellResult, latestUserText });
  const missingFields = getMissingFields(resolved);

  if (resolved.caseType === "E") {
    return {
      question: "Si eres paciente Clínyco pero no encuentro tus datos con la búsqueda por RUT, es probable que estés registrado solamente en ficha clínica y yo no tengo acceso. Una de nuestras agentes, enfermeras o nutricionistas te puede ayudar. Derivaré tu caso.",
      reason: "Caso E: paciente declarado sin match en Sell ni Support.",
      missingFields: [],
      shouldDerive: true,
      forceQuestion: true,
      caseType: resolved.caseType,
      nextAction: resolved.nextAction,
      resolved
    };
  }

  if (resolved.stage === "ready_for_handoff") {
    return {
      question: buildHandoffMessage(resolved),
      reason: "Ya tenemos datos suficientes para continuar con coordinación humana.",
      missingFields: [],
      shouldDerive: true,
      forceQuestion: true,
      caseType: resolved.caseType,
      nextAction: "derive_or_send_web",
      resolved
    };
  }

  if (resolved.stage === "handoff_without_call") {
    return {
      question: buildHandoffMessage(resolved, "no_call"),
      reason: "La persona no quiere llamada, pero ya tenemos datos suficientes para derivar.",
      missingFields: [],
      shouldDerive: true,
      forceQuestion: true,
      caseType: resolved.caseType,
      nextAction: "derive_or_send_web",
      resolved
    };
  }

  if (resolved.stage === "agenda_without_direct_access") {
    return {
      question: buildHandoffMessage(resolved, "schedule_web"),
      reason: "La persona pidió horarios, pero esta capa no tiene acceso directo a agenda.",
      missingFields: [],
      shouldDerive: true,
      forceQuestion: true,
      caseType: resolved.caseType,
      nextAction: "derive_or_send_web",
      resolved
    };
  }

  if (resolved.caseType === "A" && missingFields.length === 0) {
    return {
      question: "Perfecto, ya tengo tu contexto y no quiero hacerte repetir datos. Cuéntame qué necesitas resolver hoy para seguir ayudándote.",
      reason: "Caso A: ya existe deal en Sell, no conviene reiniciar ficha.",
      missingFields: [],
      shouldDerive: false,
      forceQuestion: true,
      caseType: resolved.caseType,
      nextAction: resolved.nextAction,
      resolved
    };
  }

  if (resolved.foundInSupport && !resolved.foundInSell && missingFields.length === 0) {
    return {
      question: "Veo que ya habías conversado antes con nosotros. Cuéntame en qué etapa estás hoy o qué te gustaría resolver ahora.",
      reason: "Caso C con contexto en Support y sin faltantes críticos inmediatos.",
      missingFields: [],
      shouldDerive: false,
      forceQuestion: true,
      caseType: resolved.caseType,
      nextAction: resolved.nextAction,
      resolved
    };
  }

  const field = missingFields[0] || null;
  const questionMap = {
    identity_min: {
      question: "Para ayudarte mejor, ¿me compartes tu RUT o tu correo o tu número de teléfono?",
      reason: "Falta identidad mínima para buscar y continuar con contexto."
    },
    dealInteres: {
      question: "¿Qué procedimiento o evaluación te interesa?",
      reason: "Falta definir el interés principal para orientar la conversación."
    },
    c_aseguradora: {
      question: "¿Cuál es tu previsión o aseguradora? Por ejemplo Fonasa, Banmédica, Consalud, Cruz Blanca o Particular.",
      reason: "La previsión cambia la orientación comercial y clínica."
    },
    c_modalidad: {
      question: "Si eres Fonasa, ¿me indicas tu tramo? Responde A, B, C o D.",
      reason: "Falta modalidad de Fonasa."
    },
    dealPeso: {
      question: "Para orientarte mejor, indícame por favor tu peso en kilos, sin decimales.",
      reason: "El procedimiento requiere peso para evaluación inicial."
    },
    dealEstatura: {
      question: "¿Y tu estatura en metros? Puedes escribirla por ejemplo como 1.70.",
      reason: "El procedimiento requiere estatura para evaluación inicial."
    }
  };

  const selected = questionMap[field] || {
    question: "Cuéntame un poco más para poder orientarte mejor.",
    reason: "No hay un faltante priorizado claro."
  };

  return {
    question: selected.question,
    reason: selected.reason,
    missingFields,
    shouldDerive: false,
    forceQuestion: field !== null,
    caseType: resolved.caseType,
    nextAction: resolved.nextAction,
    resolved
  };
}

export function applyResolverToState(state, resolverDecision) {
  state.identity.caseType = resolverDecision?.caseType || null;
  state.identity.nextAction = resolverDecision?.nextAction || null;
  state.identity.lastQuestionReason = resolverDecision?.reason || null;
  state.identity.lastMissingFields = resolverDecision?.missingFields || [];
  state.identity.lastResolvedContext = resolverDecision?.resolved || null;
}
