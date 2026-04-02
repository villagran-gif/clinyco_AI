const HELP_COMMAND = "AYUDA EUGENIA";

export function isEugeniaHelpCommand(text) {
  return String(text || "").trim().toUpperCase() === HELP_COMMAND;
}

export function buildEugeniaHelpPromptNote({ sheetUrl, sheetTab = "faq_por_resolver" }) {
  const locationLine = sheetUrl
    ? `Tu consulta quedará registrada para revisión en la pestaña "${sheetTab}" del sheet consolidado:\n${sheetUrl}`
    : `Tu consulta quedará registrada para revisión en la pestaña "${sheetTab}" del sheet consolidado del equipo.`;

  return [
    "--- EugenIA (nota interna) ---",
    "Te ayudo.",
    "",
    locationLine,
    "",
    "Proceso:",
    "1. En tu siguiente nota privada escríbeme la duda, error o aprendizaje.",
    `2. Yo la registraré en "${sheetTab}".`,
    "3. Luego el equipo revisa ese registro.",
    "4. Si aplica, se transforma en una nueva pregunta frecuente o en una mejora para Antonia.",
    "5. No se publica directo en la FAQ final sin revisión humana.",
    "",
    "En tu siguiente mensaje puedes escribir cualquiera de estos formatos:",
    "",
    "Duda puntual:",
    "El paciente preguntó por crédito Fonasa y Antonia lo confundió con PAD. ¿Cómo debió responder?",
    "",
    "Aprendizaje:",
    "Antonia debe aprender a distinguir crédito, préstamo y cobertura Fonasa.",
    "",
    "Idealmente incluye:",
    "- qué preguntó el paciente",
    "- qué respondió mal o qué faltó",
    "- cómo debió responder"
  ].join("\n");
}

export function buildEugeniaHelpAckNote({ sheetUrl, sheetTab = "faq_por_resolver", synced = true }) {
  if (!synced) {
    return [
      "--- EugenIA (nota interna) ---",
      "Recibí tu consulta, pero no pude registrarla automáticamente en el sheet consolidado.",
      sheetUrl ? `Revisa esta pestaña para seguimiento manual: ${sheetUrl}` : null,
      "La mantendré disponible para revisión del equipo."
    ].filter(Boolean).join("\n");
  }

  return [
    "--- EugenIA (nota interna) ---",
    `Gracias. Tu consulta quedó registrada para revisión en "${sheetTab}".`,
    sheetUrl ? sheetUrl : null,
    "No se publicará directo en la FAQ final sin revisión humana."
  ].filter(Boolean).join("\n");
}

export { HELP_COMMAND };
