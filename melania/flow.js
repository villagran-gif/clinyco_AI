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
 * Every menu has "0. Volver" to go back to previous step.
 * State lives in state.melania (managed by server.js).
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
  { key: "prevision", label: "Prevision de salud", example: "LISTA", isList: true, options: [
    "Fonasa Tramo A", "Fonasa Tramo B", "Fonasa Tramo C", "Fonasa Tramo D",
    "Banmedica", "Consalud", "Colmena", "Cruz Blanca", "Cruz del Norte", "Particular"
  ] },
  { key: "direccion", label: "Direccion", example: "Ej: Av. Zucovic 5440" },
  { key: "comuna", label: "Comuna", example: "Ej: Antofagasta, Santiago, Calama" },
];

function getMissingFields(data) {
  return REQUIRED_FIELDS.filter(f => !(data[f.key] || "").trim());
}

function buildFieldPrompt(field, suffix = "") {
  if (field.isList && field.options) {
    const lines = field.options.map((opt, i) => `${i + 1}. ${opt}`);
    return `${field.label}?\n\n` + lines.join("\n") + "\n\nIndica el numero." + suffix;
  }
  return `${field.label}?\n${field.example}` + suffix;
}

function parseFieldAnswer(field, text) {
  if (field.isList && field.options) {
    const num = parseInt(text, 10);
    if (num >= 1 && num <= field.options.length) {
      return field.options[num - 1];
    }
    return null; // invalid number
  }
  return text;
}

function fail(melaniaState, reply, reason) {
  return {
    reply: reply + `\n\nPuedes agendar en ${AGENDA_WEB_URL}`,
    done: true,
    melaniaState: { ...melaniaState, active: false },
    failReason: reason,
  };
}

const MENU_TEXT = "Soy MelanIA, bot de agenda Clinyco.\n\n" +
  "1. Agendar por especialidad - Elige el area medica y te muestro profesionales disponibles\n" +
  "2. Agendar por profesional - Si ya sabes con quien quieres atenderte\n" +
  "3. Otro o salir\n\n" +
  "Indica el numero.";

/**
 * Start MelanIA flow.
 */
export function startMelaniaFlow(patientData = {}, professionals = [], specialties = []) {
  const melaniaState = {
    active: true,
    step: "menu",
    collectedData: { ...patientData },
    professionals,
    specialties,
    filteredProfessionals: null,
    filteredSpecialties: null,
    availableSlots: null,
    chosenSlot: null,
    chosenProfessional: null,
    retryCount: 0,
    maxRetries: 2,
    startedAt: new Date().toISOString(),
  };

  return { reply: MENU_TEXT, melaniaState };
}

function goToMenu(s) {
  s.step = "menu";
  s.retryCount = 0;
  s.filteredProfessionals = null;
  s.filteredSpecialties = null;
  s.availableSlots = null;
  s.chosenSlot = null;
  s.chosenProfessional = null;
  return { reply: MENU_TEXT, done: false, melaniaState: s };
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
      const specMap = {};
      for (const p of s.professionals) {
        const key = p.especialidad || "Otra";
        if (!specMap[key]) specMap[key] = { name: key, id: p.especialidad_id, prox: p.cupos?.[0]?.fecha };
        if (p.cupos?.[0]?.fecha < specMap[key].prox) specMap[key].prox = p.cupos[0].fecha;
      }
      const specList = Object.values(specMap).sort((a, b) => (a.prox || "z").localeCompare(b.prox || "z"));
      s.filteredSpecialties = specList;
      s.step = "choose_specialty";
      s.retryCount = 0;

      const lines = specList.map((sp, i) => `${i + 1}. ${sp.name}`);
      lines.push("0. Volver al menu");
      return {
        reply: "Especialidades con horas disponibles:\n\n" + lines.join("\n") + "\n\nIndica el numero.",
        done: false, melaniaState: s,
      };
    }

    if (text === "2") {
      s.step = "choose_professional";
      s.retryCount = 0;
      const lines = s.professionals.map((p, i) =>
        `${i + 1}. ${p.nombres} ${p.paterno} - ${p.especialidad}`
      );
      lines.push("0. Volver al menu");
      return {
        reply: "Profesionales con horas disponibles:\n\n" + lines.join("\n") + "\n\nIndica el numero.",
        done: false, melaniaState: s,
      };
    }

    if (text === "3") {
      return fail(s, "Agendamiento finalizado.", "paciente_eligio_salir");
    }

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
    if (text === "0") return goToMenu(s);

    const num = parseInt(text, 10);
    if (num >= 1 && num <= (s.filteredSpecialties?.length || 0)) {
      const chosen = s.filteredSpecialties[num - 1];
      const profs = s.professionals.filter(p => p.especialidad_id === chosen.id);
      s.filteredProfessionals = profs;
      s.step = "choose_professional";
      s.retryCount = 0;

      const lines = profs.map((p, i) =>
        `${i + 1}. ${p.nombres} ${p.paterno}`
      );
      lines.push("0. Volver a especialidades");
      return {
        reply: `${chosen.name}. Profesionales:\n\n` + lines.join("\n") + "\n\nIndica el numero.",
        done: false, melaniaState: s,
      };
    }

    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) return goToMenu(s);
    return {
      reply: `Indica un numero entre 1 y ${s.filteredSpecialties?.length || 0}, o 0 para volver.`,
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: choose_professional
  // ════════════════════════════════════════════════
  if (s.step === "choose_professional") {
    if (text === "0") return goToMenu(s);

    const list = s.filteredProfessionals || s.professionals;
    const num = parseInt(text, 10);
    if (num >= 1 && num <= list.length) {
      const chosen = list[num - 1];
      s.chosenProfessional = chosen;
      s.step = "awaiting_slots";
      s.retryCount = 0;

      return {
        reply: `Buscando horas con ${chosen.nombres} ${chosen.paterno}...`,
        done: false,
        melaniaState: s,
        searchQuery: `${chosen.nombres} ${chosen.paterno}`.trim(),
        searchProfessionalId: chosen.id,
      };
    }

    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) return goToMenu(s);
    return {
      reply: `Indica un numero entre 1 y ${list.length}, o 0 para volver.`,
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: choose_slot
  // ════════════════════════════════════════════════
  if (s.step === "choose_slot") {
    if (text === "0") return goToMenu(s);

    const slots = s.availableSlots || [];
    const num = parseInt(text, 10);

    if (num >= 1 && num <= slots.length) {
      const chosen = slots[num - 1];
      s.chosenSlot = chosen;
      s.step = "collecting_data";
      s.retryCount = 0;

      const missing = getMissingFields(s.collectedData);
      if (missing.length === 0) {
        s.step = "confirming";
        const lines = REQUIRED_FIELDS.map(f => `${f.label}: ${s.collectedData[f.key]}`);
        return {
          reply: `Hora: ${chosen.date || chosen.dataDia} a las ${chosen.time}\n\nDatos:\n` +
            lines.join("\n") + "\n\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar\n0. Volver al menu",
          done: false, melaniaState: s,
        };
      }

      s.currentField = missing[0].key;
      let msg = `Hora seleccionada: ${chosen.date || chosen.dataDia} a las ${chosen.time}\n\n`;
      msg += "Para agendar necesito tus datos.\n\n";
      const dataLines = REQUIRED_FIELDS.map(f => {
        const val = (s.collectedData[f.key] || "").trim();
        return `${f.label}: ${val || "(falta)"}`;
      });
      msg += dataLines.join("\n");
      msg += "\n\n" + buildFieldPrompt(missing[0]);
      return { reply: msg, done: false, melaniaState: s };
    }

    // Salir option (last number + 1)
    if (num === (slots.length + 1)) {
      return goToMenu(s);
    }

    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) return goToMenu(s);
    return {
      reply: `Indica un numero entre 1 y ${slots.length}, ${slots.length + 1} para otra busqueda, o 0 para volver al menu.`,
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: collecting_data
  // ════════════════════════════════════════════════
  if (s.step === "collecting_data") {
    if (text === "0") return goToMenu(s);

    // Detect multi-line pasted data blocks (e.g. "RUT: 12.345.678-9\nNombre: Juan\n...")
    if (text.includes("\n") && /(?:rut|nombre|apellido|correo|telefono|fecha|prevision|direccion|comuna)\s*:/i.test(text)) {
      const lines = text.split("\n");
      for (const line of lines) {
        const match = line.match(/^\s*(.+?)\s*:\s*(.+)\s*$/);
        if (match) {
          const label = match[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          const value = match[2].trim();
          if (/rut/i.test(label) && !s.collectedData.rut) s.collectedData.rut = value;
          else if (/nombre\s*completo|nombres/i.test(label) && !s.collectedData.nombres) s.collectedData.nombres = value;
          else if (/apellido\s*paterno/i.test(label) && !s.collectedData.apPaterno) s.collectedData.apPaterno = value;
          else if (/apellido\s*materno/i.test(label) && !s.collectedData.apMaterno) s.collectedData.apMaterno = value;
          else if (/correo|email/i.test(label) && !s.collectedData.email) s.collectedData.email = value;
          else if (/telefono|celular|fono/i.test(label) && !s.collectedData.fono) s.collectedData.fono = value;
          else if (/fecha.*nacimiento|nacimiento/i.test(label) && !s.collectedData.nacimiento) s.collectedData.nacimiento = value;
          else if (/prevision|aseguradora/i.test(label) && !s.collectedData.prevision) s.collectedData.prevision = value;
          else if (/direccion/i.test(label) && !s.collectedData.direccion) s.collectedData.direccion = value;
          else if (/comuna|ciudad/i.test(label) && !s.collectedData.comuna) s.collectedData.comuna = value;
        }
      }
      s.retryCount = 0;
      // Fall through to check missing fields below
    } else if (s.currentField && text) {
      const currentFieldDef = REQUIRED_FIELDS.find(f => f.key === s.currentField);
      const parsed = currentFieldDef ? parseFieldAnswer(currentFieldDef, text) : text;
      if (parsed === null) {
        // Invalid answer for list field
        s.retryCount = (s.retryCount || 0) + 1;
        if (s.retryCount > s.maxRetries) return goToMenu(s);
        return {
          reply: buildFieldPrompt(currentFieldDef, "\n\n(0 para volver al menu)"),
          done: false, melaniaState: s,
        };
      }
      s.collectedData[s.currentField] = parsed;
      s.retryCount = 0;
    }

    const missing = getMissingFields(s.collectedData);
    if (missing.length === 0) {
      s.step = "confirming";
      s.currentField = null;
      const slot = s.chosenSlot;
      const profName = slot?.professional || `${s.chosenProfessional?.nombres || ""} ${s.chosenProfessional?.paterno || ""}`.trim();
      const lines = REQUIRED_FIELDS.map(f => `${f.label}: ${s.collectedData[f.key]}`);
      return {
        reply: `Datos completos.\n\nHora: ${slot.date || slot.dataDia} a las ${slot.time}\nProfesional: ${profName}\n\n` +
          lines.join("\n") + "\n\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar\n0. Volver al menu",
        done: false, melaniaState: s,
      };
    }

    s.currentField = missing[0].key;
    return {
      reply: buildFieldPrompt(missing[0], "\n\n(0 para volver al menu)"),
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: confirming
  // ════════════════════════════════════════════════
  if (s.step === "confirming") {
    if (text === "0") return goToMenu(s);

    if (text === "1") {
      s.step = "booking";
      s.active = false;
      return { reply: "Agendando tu hora...", done: true, melaniaState: s, bookingReady: true };
    }
    if (text === "2") {
      s.step = "correcting";
      s.retryCount = 0;
      const lines = REQUIRED_FIELDS.map((f, i) => `${i + 1}. ${f.label}: ${s.collectedData[f.key]}`);
      lines.push("0. Volver al menu");
      return {
        reply: "Que dato quieres corregir?\n\n" + lines.join("\n") + "\n\nIndica el numero.",
        done: false, melaniaState: s,
      };
    }
    if (text === "3") {
      return fail(s, "Agendamiento cancelado.", "paciente_cancelo");
    }

    s.retryCount = (s.retryCount || 0) + 1;
    if (s.retryCount > s.maxRetries) return goToMenu(s);
    return {
      reply: "Indica solo el numero:\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar\n0. Volver al menu",
      done: false, melaniaState: s,
    };
  }

  // ════════════════════════════════════════════════
  //  STEP: correcting
  // ════════════════════════════════════════════════
  if (s.step === "correcting") {
    if (text === "0") return goToMenu(s);

    const num = parseInt(text, 10);
    if (num >= 1 && num <= REQUIRED_FIELDS.length) {
      const field = REQUIRED_FIELDS[num - 1];
      s.collectedData[field.key] = "";
      s.step = "collecting_data";
      s.currentField = field.key;
      s.retryCount = 0;
      return {
        reply: buildFieldPrompt(field, "\n\n(0 para volver al menu)"),
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
        reply: "Datos:\n\n" + lines.join("\n") + "\n\n1. Confirmar y agendar\n2. Corregir un dato\n3. Cancelar\n0. Volver al menu",
        done: false, melaniaState: s,
      };
    }
    return {
      reply: `Indica el numero del dato a corregir (1-${REQUIRED_FIELDS.length}), o 0 para volver.`,
      done: false, melaniaState: s,
    };
  }

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
    // No slots — go back to menu instead of exiting
    s.step = "menu";
    return {
      reply: `No hay horas disponibles con ${professional || "ese profesional"}.\n\n` + MENU_TEXT,
      done: false, melaniaState: s,
    };
  }

  const lines = slots.map((sl, i) => `${i + 1}. ${sl.date || sl.dataDia} a las ${sl.time}`);
  lines.push(`${slots.length + 1}. Otra busqueda`);
  lines.push("0. Volver al menu");

  return {
    reply: `Horas disponibles con ${professional || "profesional"} (${specialty || ""}):\n\n` +
      lines.join("\n") + "\n\nIndica el numero.",
    done: false, melaniaState: s,
  };
}
