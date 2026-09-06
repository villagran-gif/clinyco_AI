from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)

# ---------- conversation-resolver.js ----------
p = Path("conversation-resolver.js")
r = p.read_text(encoding="utf-8")

r = replace_once(
    r,
    '''const BMI_REQUIRED_PROCEDURES = [
  "BALON GASTRICO",
  "CIRUGIA BARIATRICA"
];''',
    '''const BMI_REQUIRED_PROCEDURES = [
  "BALON GASTRICO",
  "CIRUGIA BARIATRICA",
  "CONVERSION DE MANGA A BYPASS"
];''',
    "BMI_REQUIRED_PROCEDURES",
)

r = replace_once(
    r,
    '''  if (key.includes("BALON")) return "Balón gástrico";
  if (key.includes("BARIATR") || key.includes("MANGA") || key.includes("BYPASS")) return "Cirugía bariátrica";''',
    '''  if (key.includes("BALON")) return "Balón gástrico";
  if ((key.includes("CONVERSION") || key.includes("REVISIONAL")) && key.includes("MANGA") && key.includes("BYPASS")) {
    return "Conversión de manga a bypass";
  }
  if (key.includes("BARIATR") || key.includes("MANGA") || key.includes("BYPASS")) return "Cirugía bariátrica";''',
    "normalizeProcedure conversion",
)

r = replace_once(
    r,
    '''function inferNextAction({ caseType, knownData }) {
  if (caseType === "E") return "derive";
  if (!knownData.c_rut && !knownData.c_email && !knownData.c_tel1) return "ask_identity";
  if (caseType === "A") return "continue";
  return "complete_missing";
}''',
    '''function inferNextAction({ caseType, knownData }) {
  if (caseType === "E") return "derive";
  if (caseType === "A") return "continue";
  // Para orientación general no convertir la falta de email/RUT en la prioridad.
  // La identidad se pide más adelante si realmente hace falta para agenda/seguimiento.
  return "complete_missing";
}''',
    "inferNextAction",
)

r = replace_once(
    r,
    '''  if (!data.c_rut && !data.c_email && !data.c_tel1) missing.push("identity_min");
  if (!data.dealInteres) missing.push("dealInteres");
  if (!data.c_aseguradora) missing.push("c_aseguradora");
  if (data.c_aseguradora === "FONASA" && !data.c_modalidad) missing.push("c_modalidad");

  if (requiresBMI(data.dealInteres)) {
    if (!data.dealPeso) missing.push("dealPeso");
    if (!data.dealEstatura) missing.push("dealEstatura");
  }
''',
    '''  if (!data.dealInteres) missing.push("dealInteres");
  if (!data.c_aseguradora) missing.push("c_aseguradora");
  if (data.c_aseguradora === "FONASA" && !data.c_modalidad) missing.push("c_modalidad");

  if (requiresBMI(data.dealInteres)) {
    if (!data.dealPeso) missing.push("dealPeso");
    if (!data.dealEstatura) missing.push("dealEstatura");
  }

  // Identidad al final. Nunca debe desplazar una orientación clínica/comercial útil.
  if (!data.c_rut && !data.c_email && !data.c_tel1) missing.push("identity_min");
''',
    "getMissingFields order",
)

p.write_text(r, encoding="utf-8")

# ---------- server.js ----------
p = Path("server.js")
s = p.read_text(encoding="utf-8")

s = replace_once(
    s,
    '''  const isWeightHeightRelevant = ["BALON GASTRICO", "CIRUGIA BARIATRICA"].includes(interes);''',
    '''  const isWeightHeightRelevant = ["BALON GASTRICO", "CIRUGIA BARIATRICA", "CONVERSION DE MANGA A BYPASS"].includes(interes);''',
    "isMeasurementQuestionNeeded",
)

s = replace_once(
    s,
    '''    const hasMissingFields = Array.isArray(decision.missingFields) && decision.missingFields.length > 0;
    const canAskIdentity =
      Array.isArray(decision.missingFields) &&
      decision.missingFields.includes("identity_min") &&
      Boolean(state?.identity?.saysExistingPatient);
    const canAskMeasurements =
      Array.isArray(decision.missingFields) &&
      decision.missingFields.some((field) => ["dealPeso", "dealEstatura"].includes(field));
    const isStrongResolverTurn =
      decision.caseType === "A" ||
      canAskIdentity ||
      canAskMeasurements;''',
    '''    const hasMissingFields = Array.isArray(decision.missingFields) && decision.missingFields.length > 0;
    const firstMissing = Array.isArray(decision.missingFields) ? decision.missingFields[0] : null;
    const canAskIdentity =
      firstMissing === "identity_min" &&
      Boolean(state?.identity?.saysExistingPatient);
    const canAskMeasurements = ["dealPeso", "dealEstatura"].includes(firstMissing);
    const isStrongResolverTurn =
      decision.caseType === "A" ||
      canAskIdentity ||
      canAskMeasurements;''',
    "shouldUseResolverQuestion priority",
)

s = replace_once(
    s,
    '''- no pidas RUT, correo o teléfono al inicio si todavía puedes orientar primero
- si el usuario ya entregó peso y estatura confirmados, usa el IMC disponible en el historial''',
    '''- no pidas RUT, correo o teléfono al inicio si todavía puedes orientar primero
- si viene por conversión de manga a bypass, primero entiende si el problema es reflujo, reganancia o ambos; NO pidas correo/RUT antes de esa orientación
- si el usuario ya entregó peso y estatura confirmados, usa el IMC disponible en el historial''',
    "prompt no identity before conversion orientation",
)

s = replace_once(
    s,
    '''      max_completion_tokens: Math.max(200, Number(process.env.ANTONIA_MAX_COMPLETION_TOKENS || 400)),''',
    '''      max_completion_tokens: Math.max(300, Number(process.env.ANTONIA_MAX_COMPLETION_TOKENS || 800)),''',
    "completion token budget",
)

s = replace_once(
    s,
    '''  const reply = response.choices?.[0]?.message?.content?.trim() || "Gracias por escribirnos.";
  return formatReplyForWhatsApp(reply);''',
    '''  let reply = response.choices?.[0]?.message?.content?.trim() || "";
  if (!reply) {
    const finishReason = response.choices?.[0]?.finish_reason || null;
    console.warn("[openai-empty] respuesta vacía; reintentando", safeJson({ finishReason, model: OPENAI_MODEL }));
    try {
      const retry = await createCompletion([
        ...baseMessages,
        {
          role: "system",
          content: "Responde ahora. Máximo 2 burbujas muy cortas separadas con [[MSG]]. Nunca cierres la conversación si el paciente hizo una pregunta."
        }
      ]);
      reply = retry.choices?.[0]?.message?.content?.trim() || "";
    } catch (retryError) {
      console.warn("[openai-empty] retry failed:", retryError.message);
    }
  }
  if (!reply) reply = "claro[[MSG]]qué te gustaría saber?";
  return formatReplyForWhatsApp(reply);''',
    "empty OpenAI retry",
)

s = replace_once(
    s,
    '''    // Measurement confirmation flow first.
    if (state.measurements.pendingConfirmation) {''',
    '''    // Measurement confirmation flow first.
    // Guardamos el IMC previo para saber si este turno acaba de completarlo/cambiarlo.
    const bmiBeforeTurn = state.measurements.bmi;
    if (state.measurements.pendingConfirmation) {''',
    "bmiBeforeTurn",
)

s = replace_once(
    s,
    '''      }
      // --- End bare-number fix ---

      const bmiSourceText = [userText, structuredLeadToMeasurementText(parseStructuredLeadText(userText))].filter(Boolean).join("\\n");''',
    '''      }

      // Los números sueltos (ej: "100" y luego "1.60") no pasan por buildBMIContext
      // en el mismo mensaje. Recalcular explícitamente cuando ya tenemos ambos datos.
      if (state.measurements.weightKg && state.measurements.heightM) {
        const recalculatedBmi = calculateBMI(state.measurements.weightKg, state.measurements.heightM);
        if (recalculatedBmi) {
          state.measurements.bmi = recalculatedBmi;
          state.measurements.bmiCategory = getBMICategory(recalculatedBmi);
        }
      }
      // --- End bare-number fix ---

      const bmiSourceText = [userText, structuredLeadToMeasurementText(parseStructuredLeadText(userText))].filter(Boolean).join("\\n");''',
    "bare number BMI recalculation",
)

s = replace_once(
    s,
    '''    }

    const unknownProfessionalSchedule = detectUnknownProfessionalScheduleRequest(userText);''',
    '''    }

    // Si este turno acaba de completar/cambiar el IMC, informarlo de inmediato.
    // No depender de OpenAI para un cálculo determinístico.
    if (state.measurements.bmi && state.measurements.bmi !== bmiBeforeTurn) {
      const bmiReply = `tu IMC es ${state.measurements.bmi}[[MSG]]quieres que te cuente las opciones?`;
      return res.json(await sendManagedReply({
        appId,
        conversationId,
        messageId,
        userText,
        reply: bmiReply,
        kind: "bmi_calculated",
        state,
        info,
        channelLabel,
        resolverDecision: {
          stage: "bmi_calculated",
          nextAction: "continue",
          reason: "BMI calculated from confirmed weight and height",
          bmi: state.measurements.bmi,
          bmiCategory: state.measurements.bmiCategory
        }
      }));
    }

    const unknownProfessionalSchedule = detectUnknownProfessionalScheduleRequest(userText);''',
    "deterministic BMI reply",
)

p.write_text(s, encoding="utf-8")
