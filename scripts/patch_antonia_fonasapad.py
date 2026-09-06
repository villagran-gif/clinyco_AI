from pathlib import Path

# Patch preevaluation parser for bare weight/height
p = Path('fonasapad-preevaluation.js')
s = p.read_text()
old = '''  if (key === "weight") {\n    if (state?.measurements?.weightKg) return { matched: true, value: state.measurements.weightKg };\n    return { matched: false };\n  }\n  if (key === "height") {\n    if (state?.measurements?.heightM) return { matched: true, value: state.measurements.heightM };\n    return { matched: false };\n  }'''
new = '''  if (key === "weight") {\n    if (state?.measurements?.weightKg) return { matched: true, value: state.measurements.weightKg };\n    const m = String(text || "").trim().match(/^(\\d{2,3}(?:[.,]\\d{1,2})?)\\s*(?:kg|kilos?)?$/i);\n    if (m) {\n      const value = Number(m[1].replace(",", "."));\n      if (value >= 30 && value <= 350) {\n        state.measurements.weightKg = value;\n        state.dealDraft.dealPeso = String(value);\n        return { matched: true, value };\n      }\n    }\n    return { matched: false };\n  }\n  if (key === "height") {\n    if (state?.measurements?.heightM) return { matched: true, value: state.measurements.heightM };\n    const m = String(text || "").trim().match(/^(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*(?:cm|m|mt|mts|metros?)?$/i);\n    if (m) {\n      let value = Number(m[1].replace(",", "."));\n      if (value >= 100 && value <= 220) value = value / 100;\n      if (value >= 1.2 && value <= 2.2) {\n        state.measurements.heightM = value;\n        state.measurements.heightCm = Math.round(value * 100);\n        state.dealDraft.dealEstatura = String(state.measurements.heightCm);\n        if (state.measurements.weightKg) state.measurements.bmi = Math.round((state.measurements.weightKg / (value * value)) * 10) / 10;\n        return { matched: true, value };\n      }\n    }\n    return { matched: false };\n  }'''
assert old in s
p.write_text(s.replace(old, new, 1))

# Patch state schema for simple scheduling state
p = Path('memory/state-schema.js')
s = p.read_text()
old = '''      pendingSpecialty: null,\n      awaitingSlotChoice: false,'''
new = '''      pendingSpecialty: null,\n      awaitingCareMode: false,\n      awaitingCityChoice: false,\n      preferredMode: null,\n      preferredCity: null,\n      awaitingSlotChoice: false,'''
assert old in s
p.write_text(s.replace(old, new, 1))

# Server integration
p = Path('server.js')
s = p.read_text()

marker = 'import { createMelaniaHandoffRouter } from "./melania/handoff-router.js";'
insert = marker + '''\nimport {\n  applyFonasaPadPreevaluationAnswer,\n  isFonasaPadPreevaluationRelevant,\n  nextFonasaPadPreevaluationStep,\n} from "./fonasapad-preevaluation.js";'''
assert marker in s
s = s.replace(marker, insert, 1)

marker = 'function guardOpenAiSchedulingClaims(reply, state) {'
helpers = '''function parseRequestedCareMode(text) {\n  const key = normalizeKey(text || "");\n  if (/\\b(TELEMEDICINA|TELECONSULTA|ONLINE|ON LINE|VIDEO)\\b/.test(key)) return "telemedicina";\n  if (/\\b(PRESENCIAL|PRESENCIALMENTE)\\b/.test(key)) return "presencial";\n  return null;\n}\n\nfunction parseClinicCityChoice(text) {\n  const key = normalizeKey(text || "");\n  if (key.includes("SANTIAGO")) return "Santiago";\n  if (key.includes("ANTOFAGASTA")) return "Antofagasta";\n  return null;\n}\n\nfunction isSimpleScheduleRequest(text) {\n  const key = normalizeKey(text || "");\n  return ["NECESITO UNA HORA", "QUIERO UNA HORA", "QUIERO AGENDAR", "NECESITO AGENDAR", "AGENDAR HORA", "PEDIR HORA", "HORA DISPONIBLE", "HORAS DISPONIBLES"].some((phrase) => key.includes(phrase));\n}\n\nfunction userExplicitlyRequestsHuman(text) {\n  const key = normalizeKey(text || "");\n  return /\\b(HUMANO|PERSONA REAL|EJECUTIVA|AGENTE|ASESOR|ASESORA)\\b/.test(key) && /\\b(HABLAR|QUIERO|NECESITO|PASAR|DERIVAR|COMUNICAR)\\b/.test(key);\n}\n\n''' + marker
assert marker in s
s = s.replace(marker, helpers, 1)

old = '''  return {\n    reply: "para no darte una sede u hora incorrecta[[MSG]]te lo confirmo con una agente",\n    handoff: true\n  };'''
new = '''  return {\n    reply: "estamos en Santiago y Antofagasta[[MSG]]presencial o telemedicina?",\n    handoff: false\n  };'''
assert old in s
s = s.replace(old, new, 1)

old = '''    if (asksClinicLocationOrNearestSite(userText) && !(Array.isArray(state.booking?.pendingSlots) && state.booking.pendingSlots.length)) {\n      return res.json(await sendManagedReply({\n        appId,\n        conversationId,\n        messageId,\n        userText,\n        reply: "para no darte una sede incorrecta[[MSG]]te lo confirmo con una agente",\n        kind: "clinic_location_requires_verified_source",\n        state,\n        info,\n        channelLabel,\n        resolverDecision: buildBlockedDecision(state, "clinic_location_requires_verified_source", "derive"),\n        disableAiAfterSend: true,\n        handoffReasonAfterSend: "clinic_location_requires_verified_source"\n      }));\n    }'''
new = '''    if (asksClinicLocationOrNearestSite(userText) && !(Array.isArray(state.booking?.pendingSlots) && state.booking.pendingSlots.length)) {\n      return res.json(await sendManagedReply({\n        appId, conversationId, messageId, userText,\n        reply: "estamos en Santiago y Antofagasta[[MSG]]cuál te acomoda?",\n        kind: "clinic_location_answer", state, info, channelLabel,\n        resolverDecision: buildResolverQuestionDecision(state, "clinic_location_answer")\n      }));\n    }'''
assert old in s
s = s.replace(old, new, 1)

old = '''    const unknownProfessionalSchedule = detectUnknownProfessionalScheduleRequest(userText);\n    if (unknownProfessionalSchedule.shouldDerive) {\n      return res.json(await sendManagedReply({\n        appId,\n        conversationId,\n        messageId,\n        userText,\n        reply: getUnknownProfessionalScheduleMessage(unknownProfessionalSchedule.professionalName),\n        kind: "unknown_professional_schedule",\n        state,\n        info,\n        channelLabel,\n        resolverDecision: buildBlockedDecision(state, "unknown_professional_schedule", "derive"),\n        disableAiAfterSend: true,\n        handoffReasonAfterSend: "unknown_professional_schedule"\n      }));\n    }'''
new = '''    const unknownProfessionalSchedule = detectUnknownProfessionalScheduleRequest(userText);\n    if (unknownProfessionalSchedule.shouldDerive) {\n      state.booking.awaitingCareMode = true;\n      return res.json(await sendManagedReply({\n        appId, conversationId, messageId, userText,\n        reply: "ok[[MSG]]presencial o telemedicina?\\nestamos en Santiago y Antofagasta",\n        kind: "schedule_choose_mode", state, info, channelLabel,\n        resolverDecision: buildResolverQuestionDecision(state, "schedule_choose_mode")\n      }));\n    }'''
assert old in s
s = s.replace(old, new, 1)

marker = '    // --- MelanIA activation: when Antonia detects booking intent ---'
block = '''    // --- Simple booking conversation: AntonIA stays in control ---\n    if (!state.melania?.active && !state.booking?.awaitingSlotChoice && !state.booking?.chosenSlot) {\n      if (state.booking?.awaitingCareMode) {\n        const mode = parseRequestedCareMode(userText);\n        if (!mode) {\n          return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: "presencial o telemedicina?[[MSG]]estamos en Santiago y Antofagasta", kind: "schedule_choose_mode", state, info, channelLabel, resolverDecision: buildResolverQuestionDecision(state, "schedule_choose_mode") }));\n        }\n        state.booking.preferredMode = mode;\n        state.booking.awaitingCareMode = false;\n        if (mode === "presencial") {\n          state.booking.awaitingCityChoice = true;\n          await persistConversationSnapshot(conversationId, state, channelLabel);\n          return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: "ok[[MSG]]Santiago o Antofagasta?", kind: "schedule_choose_city", state, info, channelLabel, resolverDecision: buildResolverQuestionDecision(state, "schedule_choose_city") }));\n        }\n        await persistConversationSnapshot(conversationId, state, channelLabel);\n        return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: "ok[[MSG]]con qué profesional o especialidad buscas hora?", kind: "schedule_choose_professional", state, info, channelLabel, resolverDecision: buildResolverQuestionDecision(state, "schedule_choose_professional") }));\n      }\n      if (state.booking?.awaitingCityChoice) {\n        const city = parseClinicCityChoice(userText);\n        if (!city) return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: "Santiago o Antofagasta?", kind: "schedule_choose_city", state, info, channelLabel, resolverDecision: buildResolverQuestionDecision(state, "schedule_choose_city") }));\n        state.booking.preferredCity = city;\n        state.booking.awaitingCityChoice = false;\n        await persistConversationSnapshot(conversationId, state, channelLabel);\n        return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: "ok[[MSG]]con qué profesional o especialidad buscas hora?", kind: "schedule_choose_professional", state, info, channelLabel, resolverDecision: buildResolverQuestionDecision(state, "schedule_choose_professional") }));\n      }\n      if (isSimpleScheduleRequest(userText) && !parseRequestedCareMode(userText)) {\n        state.booking.awaitingCareMode = true;\n        await persistConversationSnapshot(conversationId, state, channelLabel);\n        return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: "ok[[MSG]]presencial o telemedicina?\\nestamos en Santiago y Antofagasta", kind: "schedule_choose_mode", state, info, channelLabel, resolverDecision: buildResolverQuestionDecision(state, "schedule_choose_mode") }));\n      }\n    }\n\n    // --- FONASAPAD conversational preevaluation ---\n    if (!state.melania?.active && !state.booking?.awaitingSlotChoice && !state.booking?.chosenSlot && isFonasaPadPreevaluationRelevant(state, userText) && !(hasScheduleIntent(userText) || hasExplicitScheduleIntent(userText))) {\n      const preevalAnswer = applyFonasaPadPreevaluationAnswer(state, userText);\n      if (!preevalAnswer.deferToAssistant) {\n        const preevalStep = nextFonasaPadPreevaluationStep(state, userText);\n        if (preevalStep) {\n          if (preevalStep.completed && preevalStep.summary) state.dealDraft.dealValidacionPad = `Preevaluación FONASAPAD completa | ${preevalStep.summary}`;\n          await persistConversationSnapshot(conversationId, state, channelLabel);\n          return res.json(await sendManagedReply({ appId, conversationId, messageId, userText, reply: preevalStep.reply, kind: preevalStep.completed ? "fonasapad_preevaluation_complete" : "fonasapad_preevaluation_question", state, info, channelLabel, resolverDecision: { stage: "fonasapad_preevaluation", nextAction: preevalStep.completed ? "complete" : preevalStep.key, reason: "Conversational FONASAPAD preevaluation" } }));\n        }\n      }\n    }\n    // --- End FONASAPAD preevaluation ---\n\n''' + marker
assert marker in s
s = s.replace(marker, block, 1)

old = '''- si preguntan por la agenda u hora de un profesional que no esté en la lista disponible, no inventes disponibilidad; indica que derivarás con una agente porque no tienes acceso a esa agenda en esta franja horaria y sugiere la agenda web ${MEDINET_AGENDA_WEB_URL}\n- PROHIBIDO inventar sedes, ciudades, cercanía geográfica, teleconsulta, mañana/tarde o disponibilidad. Sólo menciona una sede/ciudad/horario cuando provenga de un resultado real de Medinet o de una fuente de conocimiento verificada'''
new = '''- si piden una hora, tú sigues a cargo: pregunta presencial o telemedicina. Las ubicaciones válidas son Santiago y Antofagasta. Luego consulta MelanIA/Medinet cuando necesites disponibilidad real\n- PROHIBIDO inventar otras sedes, ciudades, cercanía geográfica o disponibilidad. Santiago y Antofagasta sí están autorizadas\n- NO ofrezcas derivar a una agente como salida por defecto. Resuelve tú. Sólo deriva si el paciente pide explícitamente hablar con una persona o existe una falla operativa irrecuperable'''
assert old in s
s = s.replace(old, new, 1)

old = '- si ya tenemos teléfono, previsión, interés y los datos clínicos mínimos, prioriza una derivación clara con una agente en vez de seguir explorando'
new = '- si ya tenemos teléfono, previsión, interés y los datos clínicos mínimos, continúa resolviendo tú; si quiere hora consulta MelanIA/Medinet'
assert old in s
s = s.replace(old, new, 1)

old = '- si la persona quiere avanzar y ya tenemos los datos principales, indica que dejarás su solicitud lista para coordinación con una agente y, como alternativa, comparte la agenda web'
new = '- si la persona quiere avanzar y ya tenemos los datos principales, continúa tú. Si quiere agendar, consulta MelanIA/Medinet y presenta horas reales; usa la agenda web sólo como respaldo si falla la consulta'
assert old in s
s = s.replace(old, new, 1)

old = '''    const scheduleGuard = guardOpenAiSchedulingClaims(reply, state);\n    reply = scheduleGuard.reply;'''
new = '''    if (/\\bagente\\b/i.test(reply) && !userExplicitlyRequestsHuman(userText)) {\n      console.warn("[agent-guard] blocked unsolicited human escalation:", String(reply).slice(0, 240));\n      reply = state?.preevaluation?.active && !state?.preevaluation?.completed ? "sigamos por acá[[MSG]]te voy guiando paso a paso" : "lo vemos por acá[[MSG]]te ayudo yo";\n    }\n    const scheduleGuard = guardOpenAiSchedulingClaims(reply, state);\n    reply = scheduleGuard.reply;'''
assert old in s
s = s.replace(old, new, 1)

p.write_text(s)
