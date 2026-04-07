/**
 * melania/flow.js — MelanIA complete booking flow (no AI, numbers only)
 *
 * MelanIA handles the ENTIRE booking flow:
 * 1. Menu: especialidad / profesional / salir
 * 2. Show options with numbers
 * 3. Show slots with numbers
 * 4. Collect missing patient data one by one
 * 5. Confirm and book
 *
 * State lives in state.melania (managed by server.js).
 * Cache (professionals/specialties) passed from server.js.
 */

const AGENDA_WEB_URL = "https://clinyco.medinetapp.com/agendaweb/planned/";

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

function getMissingFields(data) {
  return REQUIRED_FIELDS.filter(f => !(data[f.key] || "").trim());
}

function fail(melaniaState, reply, reason) {
  return {
    reply: reply + `\n\nPuedes agendar en ${AGENDA_WEB_URL}`,
    done: true,
    melaniaState: { ...melaniaState, active: false },
    failReason: reason,
  };
}

/**
 * Start MelanIA flow. Called when Antonia detects booking intent.
 * @param {object} patientData - partial data from Antonia
 * @param {Array} professionals - from fetchProximosCuposAll cache
 * @param {Array} specialties - from fetchSpecialtiesByBranchNoAuth cache
 */
export function startMelaniaFlow(patientData = {}, professionals = [], specialties = []) {
  const melaniaState = {
    active: true,
    step: "menu",
    collectedData: { ...patientData },
    professionals,
    specialties,
    filteredProfessionals: null,
    chosenSlot: null,
    retryCount: 0,
    maxRetries: 1,
    startedAt: new Date().toISOString(),
  };

  const reply = "Soy MelanIA, bot de agenda Clinyco.\n\n" +
    "1. Agendar por especialidad - Elige el area medica y te muestro profesionales disponibles\n" +
    "2. Agendar por profesional - Si ya sabes con quien quieres atenderte\n" +
    "3. Otro o salir\n\n" +
    "Indica el numero.";

  return { reply, melaniaState };
}

/**
 * Process patient message during MelanIA flow.
 */
export function handleMelaniaMessage(melaniaState, userText) {
  if (!melaniaState?.active) {
    return { reply: null, done: true, melaniaState, failReason: "melania_not_active" };
  }

  const text = (userText || "").trim();
  const s = { ...melaniaState, collectedData: { ...melaniaState.collectedData } };

  // ════════════════════════════════════════════════
  //  STEP: menu (1=especialidad, 2=profesional, 3=salir)
  // ════════════════════════════════════════════════
  if (s.step === "menu") {
    if (text === "1") {
      // Group professionals by specialty
      const specMap = {};
      for (const p of s.professionals) {
        const key = p.especialidad || "Otra";
        if (!specMap[key]) specMap[key] = { name: key, id: p.especialidad_id, prox: p.cupos?.[0]?.fecha };
        if (p.cupos?.[0]?.fecha < specMap[key].prox) specMap[key].prox = p.cupos[0].fecha;
      }
      const specList = Object.values(specMap).sort((a, b) => (a.prox || "z").localeCompare(b.prox || "z"));
      s.filteredSpecialties = specList;
      s.step = "choose_specialty";

      const lines = specList.map((sp, i) => `${i + 1}. ${sp.name} (prox: ${sp.prox || "sin cupos"})`);
      return {
        reply: "Especialidades con horas disponibles:\n\n" + lines.join("\n") + "\n\nIndica el numero.",
        done: false, melaniaState: s,
      };
    }

    if (text === "2") {
      s.step = "choose_professional";
      const lines = s.professionals.map((p, i) =>
        `${i + 1}. ${p.nombres} ${p.paterno} - ${p.especialidad} (${p.cupos?.[0]?.fecha || "sin cupos"})`
      );
      return {
        reply: "Profesionales con horas disponibles:\n\n" + lines.join("\n") + "\n\nIndica el numero.",
        done: false, melaniaState: s,
      };
    }

    if (text === "3") {
      return fail(s, "Agendamiento finalizado.", "paciente_eligio_salir");
    }

    // Invalid
    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) {
      return fail(s, "No pude procesar tu respuesta.", "paciente_no_responde_menu");
    }
    return {
      reply: "No entendi tu respuesta. Indica solo el numero:\n\n" +
        "1. Agendar por especialidad\n2. Agendar por profesional\n3. Otro o salir",
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: choose_specialty
  // ════════════════════════════════════════════════
  if (s.step === "choose_specialty") {
    const num = parseInt(text, 10);
    if (num >= 1 && num <= (s.filteredSpecialties?.length || 0)) {
      const chosen = s.filteredSpecialties[num - 1];
      // Filter professionals by this specialty
      const profs = s.professionals.filter(p => p.especialidad_id === chosen.id);
      s.filteredProfessionals = profs;
      s.step = "choose_professional";
      s.retryCount = 0;

      const lines = profs.map((p, i) =>
        `${i + 1}. ${p.nombres} ${p.paterno} (${p.cupos?.[0]?.fecha || "sin cupos"})`
      );
      return {
        reply: `${chosen.name}. Profesionales:\n\n` + lines.join("\n") + "\n\nIndica el numero.",
        done: false, melaniaState: s,
      };
    }

    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) {
      return fail(s, "No pude procesar tu respuesta.", "paciente_no_responde_especialidad");
    }
    return {
      reply: `Indica un numero entre 1 y ${s.filteredSpecialties?.length || 0}.`,
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: choose_professional
  // ════════════════════════════════════════════════
  if (s.step === "choose_professional") {
    const list = s.filteredProfessionals || s.professionals;
    const num = parseInt(text, 10);
    if (num >= 1 && num <= list.length) {
      const chosen = list[num - 1];
      s.chosenProfessional = chosen;
      s.step = "awaiting_slots";
      s.retryCount = 0;

      // Signal to server.js that we need to search slots for this professional
      return {
        reply: `Buscando horas con ${chosen.nombres} ${chosen.paterno}...`,
        done: false,
        melaniaState: s,
        searchQuery: `${chosen.nombres} ${chosen.paterno}`.trim(),
        searchProfessionalId: chosen.id,
      };
    }

    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) {
      return fail(s, "No pude procesar tu respuesta.", "paciente_no_responde_profesional");
    }
    return {
      reply: `Indica un numero entre 1 y ${list.length}.`,
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: choose_slot (slots loaded by server.js)
  // ════════════════════════════════════════════════
  if (s.step === "choose_slot") {
    const slots = s.availableSlots || [];
    const num = parseInt(text, 10);

    if (num >= 1 && num <= slots.length) {
      const chosen = slots[num - 1];
      s.chosenSlot = chosen;
      s.step = "collecting_data";
      s.retryCount = 0;

      // Check what data we already have
      const missing = getMissingFields(s.collectedData);
      if (missing.length === 0) {
        // All data ready — go to confirm
        s.step = "confirming";
        const lines = REQUIRED_FIELDS.map(f => `${f.label}: ${s.collectedData[f.key]}`);
        return {
          reply: `Hora: ${chosen.date || chosen.dataDia} a las ${chosen.time}\n\nDatos:\n` +
            lines.join("\n") + "\n\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar",
          done: false, melaniaState: s,
        };
      }

      // Need data — show what we have and ask first missing
      s.currentField = missing[0].key;
      let msg = `Hora seleccionada: ${chosen.date || chosen.dataDia} a las ${chosen.time}\n\n`;
      msg += "Para agendar necesito tus datos.\n\n";

      const dataLines = REQUIRED_FIELDS.map(f => {
        const val = (s.collectedData[f.key] || "").trim();
        return `${f.label}: ${val || "(falta)"}`;
      });
      msg += dataLines.join("\n");
      msg += `\n\n${missing[0].label}?\n${missing[0].example}`;

      return { reply: msg, done: false, melaniaState: s };
    }

    // Exit option
    if (num === (slots.length + 1)) {
      return fail(s, "Agendamiento finalizado.", "paciente_eligio_salir_slots");
    }

    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) {
      return fail(s, "No pude procesar tu respuesta.", "paciente_no_responde_slot");
    }
    return {
      reply: `Indica un numero entre 1 y ${slots.length} (o ${slots.length + 1} para salir).`,
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: collecting_data (one field at a time)
  // ════════════════════════════════════════════════
  if (s.step === "collecting_data") {
    if (s.currentField && text) {
      s.collectedData[s.currentField] = text;
      s.retryCount = 0;
    }

    const missing = getMissingFields(s.collectedData);
    if (missing.length === 0) {
      s.step = "confirming";
      s.currentField = null;
      const slot = s.chosenSlot;
      const lines = REQUIRED_FIELDS.map(f => `${f.label}: ${s.collectedData[f.key]}`);
      return {
        reply: `Datos completos.\n\nHora: ${slot.date || slot.dataDia} a las ${slot.time}\nProfesional: ${slot.professional || s.chosenProfessional?.nombres + " " + s.chosenProfessional?.paterno}\n\n` +
          lines.join("\n") + "\n\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar",
        done: false, melaniaState: s,
      };
    }

    s.currentField = missing[0].key;
    return {
      reply: `${missing[0].label}?\n${missing[0].example}`,
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: confirming (1=book, 2=correct, 3=cancel)
  // ════════════════════════════════════════════════
  if (s.step === "confirming") {
    if (text === "1") {
      s.step = "booking";
      s.active = false;
      return {
        reply: "Agendando tu hora...",
        done: true, melaniaState: s,
        bookingReady: true,
      };
    }
    if (text === "2") {
      s.step = "correcting";
      const lines = REQUIRED_FIELDS.map((f, i) => `${i + 1}. ${f.label}: ${s.collectedData[f.key]}`);
      return {
        reply: "Que dato quieres corregir?\n\n" + lines.join("\n") + "\n\nIndica el numero.",
        done: false, melaniaState: s,
      };
    }
    if (text === "3") {
      return fail(s, "Agendamiento cancelado.", "paciente_cancelo");
    }

    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) {
      return fail(s, "No pude procesar tu respuesta.", "paciente_no_responde_confirmacion");
    }
    return {
      reply: "Indica solo el numero:\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar",
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: correcting
  // ════════════════════════════════════════════════
  if (s.step === "correcting") {
    const num = parseInt(text, 10);
    if (num >= 1 && num <= REQUIRED_FIELDS.length) {
      const field = REQUIRED_FIELDS[num - 1];
      s.collectedData[field.key] = "";
      s.step = "collecting_data";
      s.currentField = field.key;
      s.retryCount = 0;
      return {
        reply: `${field.label}?\n${field.example}`,
        done: false, melaniaState: s,
      };
    }

    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) {
      s.step = "confirming";
      s.retryCount = 0;
      const slot = s.chosenSlot;
      const lines = REQUIRED_FIELDS.map(f => `${f.label}: ${s.collectedData[f.key]}`);
      return {
        reply: "Datos:\n\n" + lines.join("\n") + "\n\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar",
        done: false, melaniaState: s,
      };
    }
    return {
      reply: `Indica el numero del dato a corregir (1-${REQUIRED_FIELDS.length}).`,
      done: false, melaniaState: s,
    };
  }

  // Unknown step
  return fail(s, "Error interno.", "step_desconocido");
}

/**
 * Load slots into MelanIA state after server.js fetches them.
 */
export function setMelaniaSlots(melaniaState, slots, professional, specialty) {
  const s = { ...melaniaState };
  s.availableSlots = slots;
  s.step = "choose_slot";
  s.retryCount = 0;

  if (!slots || !slots.length) {
    s.active = false;
    return {
      reply: `No hay horas disponibles con ${professional || "ese profesional"}. Puedes revisar en ${AGENDA_WEB_URL}`,
      done: true, melaniaState: s, failReason: "sin_slots",
    };
  }

  const lines = slots.map((sl, i) => `${i + 1}. ${sl.date || sl.dataDia} a las ${sl.time}`);
  lines.push(`${slots.length + 1}. Salir`);

  return {
    reply: `Horas disponibles con ${professional || "profesional"} (${specialty || ""}):\n\n` +
      lines.join("\n") + "\n\nIndica el numero.",
    done: false, melaniaState: s,
  };
}
