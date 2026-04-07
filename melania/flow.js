/**
 * melania/flow.js — MelanIA booking flow (stateless, no AI)
 *
 * MelanIA is a classic bot. No AI, no text interpretation.
 * Asks one field at a time. Numbers only for choices.
 * Returns { reply, done, failReason? } on each step.
 *
 * State lives in state.melania (managed by server.js).
 */

const AGENDA_WEB_URL = "https://clinyco.medinetapp.com/agendaweb/planned/";

// Fields required for booking, in order
const REQUIRED_FIELDS = [
  { key: "rut", label: "RUT", example: "Ej: 12.345.678-9" },
  { key: "nombres", label: "Nombre completo", example: "Ej: Pablo Enrique" },
  { key: "apPaterno", label: "Apellido paterno", example: "Ej: Villagran" },
  { key: "apMaterno", label: "Apellido materno", example: "Ej: Van Steenderen" },
  { key: "email", label: "Correo electronico", example: "Ej: correo@gmail.com" },
  { key: "fono", label: "Telefono celular", example: "Ej: 912345678" },
  { key: "nacimiento", label: "Fecha de nacimiento", example: "Formato: DD/MM/AAAA" },
  { key: "prevision", label: "Prevision de salud", example: "Ej: Fonasa, Banmedica, Consalud, Cruz Blanca, Particular" },
  { key: "direccion", label: "Direccion", example: "Ej: Av. Zucovic 5440" },
];

/**
 * Initialize MelanIA state on a conversation.
 * Called when Antonia hands off to MelanIA.
 *
 * @param {object} patientData - partial data from Antonia { rut, nombres, apPaterno, ... }
 * @returns {object} melania state to store in state.melania
 */
export function initMelaniaState(patientData = {}) {
  return {
    active: true,
    step: "collecting_data",
    collectedData: { ...patientData },
    currentField: null,
    retryCount: 0,
    maxRetries: 1,
    startedAt: new Date().toISOString(),
  };
}

/**
 * Get list of missing fields.
 */
function getMissingFields(collectedData) {
  return REQUIRED_FIELDS.filter(f => {
    const val = (collectedData[f.key] || "").trim();
    return !val;
  });
}

/**
 * Build the initial message showing what data we have and what we need.
 */
function buildDataSummaryMessage(collectedData) {
  const lines = REQUIRED_FIELDS.map(f => {
    const val = (collectedData[f.key] || "").trim();
    return `${f.label}: ${val || "(falta)"}`;
  });

  const missing = getMissingFields(collectedData);

  if (missing.length === 0) {
    return null; // all data complete
  }

  let msg = "Soy MelanIA, bot de agenda Clinyco.\n\nPara agendar necesito estos datos:\n\n";
  msg += lines.join("\n");
  msg += "\n\n";

  if (missing.length === REQUIRED_FIELDS.length) {
    msg += "Te preguntare uno por uno.";
  } else {
    msg += `Tengo ${REQUIRED_FIELDS.length - missing.length} datos. Faltan ${missing.length}.`;
  }

  return msg;
}

/**
 * Process a message from the patient during MelanIA flow.
 *
 * @param {object} melaniaState - state.melania
 * @param {string} userText - what the patient sent
 * @returns {{ reply: string, done: boolean, melaniaState: object, failReason?: string, bookingReady?: boolean }}
 */
export function handleMelaniaMessage(melaniaState, userText) {
  if (!melaniaState || !melaniaState.active) {
    return { reply: null, done: true, melaniaState, failReason: "melania_not_active" };
  }

  const text = (userText || "").trim();
  const state = { ...melaniaState, collectedData: { ...melaniaState.collectedData } };

  // ── Step: collecting_data ──
  if (state.step === "collecting_data") {
    // If we're asking for a specific field, store the answer
    if (state.currentField && text) {
      state.collectedData[state.currentField] = text;
      state.retryCount = 0;
    }

    // Find next missing field
    const missing = getMissingFields(state.collectedData);

    if (missing.length === 0) {
      // All data collected — show summary and ask for confirmation
      state.step = "confirming";
      state.currentField = null;

      const lines = REQUIRED_FIELDS.map(f => `${f.label}: ${state.collectedData[f.key]}`);
      const reply = "Datos completos. Confirma que estan correctos:\n\n" +
        lines.join("\n") +
        "\n\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar";

      return { reply, done: false, melaniaState: state };
    }

    // Ask for next missing field
    const nextField = missing[0];
    state.currentField = nextField.key;

    const reply = `${nextField.label}?\n${nextField.example}`;
    return { reply, done: false, melaniaState: state };
  }

  // ── Step: confirming ──
  if (state.step === "confirming") {
    if (text === "1") {
      // Confirmed — ready to book
      state.step = "booking";
      state.active = false;
      return {
        reply: "Agendando tu hora...",
        done: true,
        melaniaState: state,
        bookingReady: true,
      };
    }

    if (text === "2") {
      // Correct a field — show numbered list
      state.step = "correcting";
      const lines = REQUIRED_FIELDS.map((f, i) => `${i + 1}. ${f.label}: ${state.collectedData[f.key]}`);
      const reply = "Que dato quieres corregir?\n\n" + lines.join("\n") + "\n\nIndica el numero.";
      return { reply, done: false, melaniaState: state };
    }

    if (text === "3") {
      // Cancel
      state.active = false;
      return {
        reply: `Agendamiento cancelado. Puedes agendar en ${AGENDA_WEB_URL}`,
        done: true,
        melaniaState: state,
        failReason: "paciente_cancelo",
      };
    }

    // Invalid response
    state.retryCount = (state.retryCount || 0) + 1;
    if (state.retryCount > state.maxRetries) {
      state.active = false;
      return {
        reply: `No pude procesar tu respuesta. Puedes agendar en ${AGENDA_WEB_URL}`,
        done: true,
        melaniaState: state,
        failReason: "paciente_no_responde_confirmacion",
      };
    }

    return {
      reply: "Indica solo el numero:\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar",
      done: false,
      melaniaState: state,
    };
  }

  // ── Step: correcting ──
  if (state.step === "correcting") {
    const num = parseInt(text, 10);
    if (num >= 1 && num <= REQUIRED_FIELDS.length) {
      const field = REQUIRED_FIELDS[num - 1];
      state.collectedData[field.key] = ""; // clear the field
      state.step = "collecting_data";
      state.currentField = field.key;
      state.retryCount = 0;

      const reply = `${field.label}?\n${field.example}`;
      return { reply, done: false, melaniaState: state };
    }

    // Invalid
    state.retryCount = (state.retryCount || 0) + 1;
    if (state.retryCount > state.maxRetries) {
      state.step = "confirming";
      state.retryCount = 0;
      const lines = REQUIRED_FIELDS.map(f => `${f.label}: ${state.collectedData[f.key]}`);
      return {
        reply: "Datos actuales:\n\n" + lines.join("\n") + "\n\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar",
        done: false,
        melaniaState: state,
      };
    }

    return {
      reply: `Indica el numero del dato a corregir (1-${REQUIRED_FIELDS.length}).`,
      done: false,
      melaniaState: state,
    };
  }

  // Unknown step — reset
  state.active = false;
  return {
    reply: `Error interno. Puedes agendar en ${AGENDA_WEB_URL}`,
    done: true,
    melaniaState: state,
    failReason: "step_desconocido",
  };
}

/**
 * Build the first message MelanIA sends when taking over.
 *
 * @param {object} patientData - partial data from Antonia
 * @returns {{ reply: string, melaniaState: object }}
 */
export function startMelaniaFlow(patientData = {}) {
  const melaniaState = initMelaniaState(patientData);
  const summary = buildDataSummaryMessage(melaniaState.collectedData);

  if (!summary) {
    // All data already complete — go straight to confirmation
    melaniaState.step = "confirming";
    const lines = REQUIRED_FIELDS.map(f => `${f.label}: ${melaniaState.collectedData[f.key]}`);
    const reply = "Soy MelanIA, bot de agenda Clinyco.\n\nTengo todos tus datos:\n\n" +
      lines.join("\n") +
      "\n\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar";

    return { reply, melaniaState };
  }

  // Find first missing field to ask
  const missing = getMissingFields(melaniaState.collectedData);
  melaniaState.currentField = missing[0].key;

  const reply = summary + "\n\n" + `${missing[0].label}?\n${missing[0].example}`;

  return { reply, melaniaState };
}
