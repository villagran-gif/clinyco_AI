const CURRENT_YEAR = 2026;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?.,!;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureState(state) {
  if (!state.preevaluation || typeof state.preevaluation !== "object") {
    state.preevaluation = {};
  }
  const p = state.preevaluation;
  p.active ??= false;
  p.completed ??= false;
  p.track ??= null;
  p.awaiting ??= null;
  p.startedAt ??= null;
  p.completedAt ??= null;
  p.answers ??= {};
  p.summary ??= null;
  p.lastPrompt ??= null;
  p.historyHydratedVersion ??= 0;
  p.historyHydratedAt ??= null;
  p.askedKeys ??= {};
  return p;
}

function detectTrack(state, text = "") {
  const raw = `${state?.dealDraft?.dealInteres || ""} ${text}`;
  const key = normalize(raw);

  if (/conversion|revisional|cirugia previa|reflujo.*manga|hernia.*manga/.test(key)) return "revisional";
  if (/abdominoplast|abdomen flacido|guatita delantal|delantal abdominal/.test(key)) return "abdomen";
  if (/balon|allurion|orbera|medsil/.test(key)) return "balloon";
  if (/manga|bypass|bariatr/.test(key)) return "bariatric";
  return null;
}

export function isFonasaPadPreevaluationRelevant(state, text = "") {
  if (state?.preevaluation?.active && !state?.preevaluation?.completed) return true;
  return Boolean(detectTrack(state, text));
}

function isQuestion(text) {
  const raw = String(text || "").trim();
  const key = normalize(raw);
  if (!raw) return false;
  if (/[?¿]/.test(raw)) return true;
  return /^(cuanto|cuanto vale|valor|precio|donde|como|porque|por que|puedo|pueden|hay|tienen|tienes|sirve|cubre|cobertura)\b/.test(key);
}

function parseAge(text) {
  const m = String(text || "").match(/\b(1[89]|[2-7]\d|8[0-5])\b/);
  return m ? Number(m[1]) : null;
}

function parseYear(text) {
  const m = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1980 && y <= CURRENT_YEAR ? y : null;
}

function parseYesNo(text) {
  const key = normalize(text);
  if (/^(si|sí|s|sip|sipo|claro|correcto|1)\b/.test(key)) return true;
  if (/^(no|nop|2)\b/.test(key)) return false;
  return null;
}

function parsePriorSurgery(text) {
  const key = normalize(text);

  // Una negación explícita del paciente siempre gana sobre inferencias previas
  // hechas desde un anuncio o desde el procedimiento consultado.
  if (/no tengo ninguna (operacion|cirugia)|no me he operado|nunca me he operado|sin cirugia bariatrica|ninguna cirugia bariatrica/.test(key)) return "ninguna";
  if (/no tengo manga|no tengo una manga/.test(key) && !/(tengo|tuve|me hice|me ise|me opere).*bypass/.test(key)) return "ninguna";
  if (/no tengo bypass/.test(key) && !/(tengo|tuve|me hice|me ise|me opere).*manga/.test(key)) return "ninguna";

  if (/(ya tengo|tengo una|tuve una|me hice|me ise|me iz[eé]|me opere|me operaron|fui operad).*manga/.test(key)) return "manga";
  if (/(ya tengo|tengo un|tuve un|me hice|me ise|me iz[eé]|me opere|me operaron|fui operad).*bypass/.test(key)) return "bypass";
  if (/manga/.test(key) && !/^no\b/.test(key)) return "manga";
  if (/bypass/.test(key) && !/^no\b/.test(key)) return "bypass";
  if (/otra|switch|sadi|banda/.test(key)) return "otra";
  const yn = parseYesNo(text);
  if (yn === false) return "ninguna";
  return null;
}

function parseSmoking(text) {
  const key = normalize(text);
  if (/no fumo|no fumador|nunca he fumado|nunca fumo|para nada|nada de tabaco/.test(key)) return "no_fuma";
  if (/deje|dejé|ex fum|exfum/.test(key)) return `exfumador: ${String(text).trim()}`;

  // Modismos/fórmulas frecuentes en Chile para consumo ocasional.
  if (/de vez en cuando|de repente|a veces|ocasional|socialmente|muy poco|cada cierto tiempo|solo.*(carrete|salgo|fiesta)|fin de semana/.test(key)) return "fuma_ocasional";

  if (/fumo|fumador|cigarro|tabaco|pucho/.test(key)) return "fuma_actualmente";
  const yn = parseYesNo(text);
  if (yn === false) return "no_fuma";
  if (yn === true) return "fuma_actualmente";
  return null;
}

function meaningful(text) {
  const value = String(text || "").trim();
  return value.length >= 2 ? value : null;
}

function answerExpected(p, state, text) {
  const key = p.awaiting;
  if (!key) return { matched: false };

  if (key === "weight") {
    if (state?.measurements?.weightKg) return { matched: true, value: state.measurements.weightKg };
    const raw = String(text || "").trim();
    const m = raw.match(/\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kilo|kilos)\b/i)
      || raw.match(/^\s*(?:peso\s*)?(?:como\s+|aprox(?:imadamente)?\s+|unos?\s+)?(\d{2,3}(?:[.,]\d{1,2})?)\b/i);
    if (m) {
      const value = Number(m[1].replace(",", "."));
      if (value >= 30 && value <= 350) {
        state.measurements.weightKg = value;
        state.dealDraft.dealPeso = String(value);
        return { matched: true, value };
      }
    }
    return { matched: false };
  }
  if (key === "height") {
    if (state?.measurements?.heightM) return { matched: true, value: state.measurements.heightM };
    const m = String(text || "").trim().match(/^(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:cm|m|mt|mts|metros?)?$/i);
    if (m) {
      let value = Number(m[1].replace(",", "."));
      if (value >= 100 && value <= 220) value = value / 100;
      if (value >= 1.2 && value <= 2.2) {
        state.measurements.heightM = value;
        state.measurements.heightCm = Math.round(value * 100);
        state.dealDraft.dealEstatura = String(state.measurements.heightCm);
        if (state.measurements.weightKg) state.measurements.bmi = Math.round((state.measurements.weightKg / (value * value)) * 10) / 10;
        return { matched: true, value };
      }
    }
    return { matched: false };
  }
  if (key === "insurance") {
    if (state?.contactDraft?.c_aseguradora) return { matched: true, value: state.contactDraft.c_aseguradora };
    return { matched: false };
  }
  if (key === "fonasa_tramo") {
    if (state?.contactDraft?.c_modalidad) return { matched: true, value: state.contactDraft.c_modalidad };
    const normalized = normalize(text);
    const m = normalized.match(/\b(?:tramo\s+)?([abcd])\b/);
    if (m) {
      const tramo = m[1].toUpperCase();
      state.contactDraft.c_aseguradora = "FONASA";
      state.contactDraft.c_modalidad = `Tramo ${tramo}`;
      return { matched: true, value: `Tramo ${tramo}` };
    }
    return { matched: false };
  }

  if (key === "age") {
    const value = parseAge(text);
    return value ? { matched: true, value } : { matched: false };
  }
  if (key === "prior_surgery") {
    const value = parsePriorSurgery(text);
    return value ? { matched: true, value } : { matched: false };
  }
  if (key === "prior_year") {
    const value = parseYear(text);
    return value ? { matched: true, value } : { matched: false };
  }
  if (key === "smoking") {
    const value = parseSmoking(text);
    return value ? { matched: true, value } : { matched: false };
  }

  if (["revision_reason", "studies", "comorbidities", "safety", "city", "abdomen_fold", "postpartum", "breastfeeding", "oncology", "skin_disease"].includes(key)) {
    const value = meaningful(text);
    return value ? { matched: true, value } : { matched: false };
  }

  return { matched: false };
}


function inferQuestionKey(text = "") {
  const key = normalize(text);
  if (!key) return null;
  if (/cuanto pesas/.test(key)) return "weight";
  if (/cuanto mides|estatura/.test(key)) return "height";
  if (/que edad tienes|cual es tu edad/.test(key)) return "age";
  if (/(te has operado|te operaste|cirugia bariatrica previa).*(manga|bypass|bariatr)/.test(key)) return "prior_surgery";
  if (/(de que ano|hace cuanto).*(manga|cirugia)|cuando fue.*(manga|cirugia)/.test(key)) return "prior_year";
  if (/(reflujo.*reganancia.*ambos|reflujo.*peso.*ambos|que te molesta mas)/.test(key)) return "revision_reason";
  if (/endoscopia|estudio reciente|estudios disponibles/.test(key)) return "studies";
  if (/enfermedad asociada|diabetes.*presion.*apnea|antecedente importante/.test(key)) return "comorbidities";
  if (/fumas actualmente|fumas hoy|tabaco/.test(key)) return "smoking";
  if (/embarazo.*enfermedad.*descompensada|embarazo actual/.test(key)) return "safety";
  if (/fonasa.*isapre.*particular|prevision/.test(key)) return "insurance";
  if (/tramo fonasa/.test(key)) return "fonasa_tramo";
  if (/en que ciudad|de que ciudad|donde vives/.test(key)) return "city";
  if (/pliegue abdominal/.test(key)) return "abdomen_fold";
  if (/parto.*6 meses|postparto/.test(key)) return "postpartum";
  if (/amamantando|lactancia/.test(key)) return "breastfeeding";
  if (/oncologica activa|cancer activo/.test(key)) return "oncology";
  if (/piel del abdomen/.test(key)) return "skin_disease";
  return null;
}

function parseAnswerForKey(p, state, key, text) {
  const previous = p.awaiting;
  p.awaiting = key;
  const result = answerExpected(p, state, text);
  p.awaiting = previous;
  return result;
}

function ingestExplicitFacts(state, p, text = "") {
  const raw = String(text || "").trim();
  const key = normalize(raw);
  if (!key) return;

  // Correcciones explícitas: el dato dicho por el paciente manda sobre el anuncio.
  const explicitlyNoPrior = /no tengo ninguna (operacion|cirugia)|no me he operado|nunca me he operado|sin cirugia bariatrica|ninguna cirugia bariatrica/.test(key)
    || (/no tengo manga|no tengo una manga/.test(key) && !/(tengo|tuve|me hice|me ise|me opere).*bypass/.test(key));

  if (explicitlyNoPrior) {
    p.answers.prior_surgery = "ninguna";
    delete p.answers.prior_year;
    delete p.answers.revision_reason;
    if (["prior_surgery", "prior_year", "revision_reason"].includes(p.awaiting)) p.awaiting = null;

    const interest = normalize(state?.dealDraft?.dealInteres || "");
    if (/balon|allurion|orbera|medsil/.test(interest)) p.track = "balloon";
    else if (/abdominoplast|guatita delantal|abdomen/.test(interest)) p.track = "abdomen";
    else p.track = "bariatric";
  } else {
    const prior = parsePriorSurgery(raw);
    if (prior && prior !== "ninguna" && /ya tengo|tengo una|tengo un|tuve|me hice|me ise|me iz|me opere|me operaron|fui operad|hace|ase/.test(key)) {
      p.answers.prior_surgery = prior;
      p.track = "revisional";
      p.completed = false;
      if (p.awaiting === "prior_surgery") p.awaiting = null;
    }
  }

  const year = parseYear(raw);
  if (year && (/(manga|bypass|cirugia|operad)/.test(key) || (p.track === "revisional" && /\b(fue|ano|en el)\b/.test(key)))) {
    p.answers.prior_year = year;
  } else {
    const relative = key.match(/\b(?:hace|ase)\s+(\d{1,2})\s+(mes|meses|ano|anos)\b/);
    if (relative && p.answers.prior_surgery && p.answers.prior_surgery !== "ninguna") {
      p.answers.prior_year = `hace ${relative[1]} ${relative[2]}`;
    }
  }

  if (/reflujo|reganancia|recupere.*peso|recuper.*peso|subi.*peso|aumente.*peso/.test(key) && p.answers.prior_surgery !== "ninguna") {
    p.answers.revision_reason = raw;
  }

  // Peso explícito puede venir junto con otros datos: "89 kilos pero me hice una manga".
  const weight = raw.match(/\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kilo|kilos)\b/i);
  if (weight) {
    const value = Number(weight[1].replace(",", "."));
    if (value >= 30 && value <= 350) {
      state.measurements.weightKg = value;
      state.dealDraft.dealPeso = String(value);
      p.answers.weight = value;
      if (p.awaiting === "weight") p.awaiting = null;
    }
  }

  if (/tengo\s+\d{2}\s+anos|tengo\s+\d{2}\s+años|edad\s*[:=]?\s*\d{2}/i.test(raw)) {
    const age = parseAge(raw);
    if (age) p.answers.age = age;
  }

  const smoking = parseSmoking(raw);
  if (smoking && /fumo|fumador|tabaco|cigarro|pucho|de vez en cuando|de repente|a veces|ocasional|socialmente|carrete/.test(key)) {
    p.answers.smoking = smoking;
  }

  // Si el paciente agrega otro antecedente después de que AntonIA ya avanzó,
  // lo anexamos en vez de perderlo.
  if (/diabetes|prediabetes|pre diabetes|hipertension|presion alta|colesterol|apnea|tiroides|resistencia a la insulina/.test(key)) {
    const previous = String(p.answers.comorbidities || "").trim();
    if (!previous) p.answers.comorbidities = raw;
    else if (!normalize(previous).includes(key)) p.answers.comorbidities = `${previous}; ${raw}`;
  }

  if (/endoscopia|phmetria|manometria|scanner|tac|estudio/.test(key) && /(tengo|no tengo|ninguno|ninguna|reciente|hecho|realizado)/.test(key)) {
    p.answers.studies = raw;
  }
}

export function hydrateFonasaPadPreevaluationFromHistory(state, history = []) {
  const p = ensureState(state);
  if (!p.track) p.track = detectTrack(state, "");
  maybeSeedFromKnownState(state, p);

  const items = Array.isArray(history) ? [...history] : [];
  items.sort((a, b) => {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });

  let previousAssistant = null;
  for (const item of items) {
    const role = String(item?.role || "").toLowerCase();
    const content = String(item?.content || "").trim();
    if (!content) continue;

    if (role === "assistant") {
      previousAssistant = content;
      continue;
    }
    if (role !== "user") continue;

    ingestExplicitFacts(state, p, content);

    if (previousAssistant) {
      const questionKey = inferQuestionKey(previousAssistant);
      if (questionKey) {
        const parsed = parseAnswerForKey(p, state, questionKey, content);
        if (parsed.matched) p.answers[questionKey] = parsed.value;
        p.askedKeys[questionKey] = Math.max(1, Number(p.askedKeys[questionKey] || 0));
      }
    }
    previousAssistant = null;
  }

  // Si el dato que estábamos esperando ya apareció antes, no lo volvemos a preguntar.
  if (p.awaiting && hasAnswer(p, p.awaiting)) p.awaiting = null;

  p.historyHydratedVersion = 2;
  p.historyHydratedAt = new Date().toISOString();
  return { ...p.answers };
}

export function applyFonasaPadPreevaluationAnswer(state, text = "") {
  const p = ensureState(state);
  const awaitedBefore = p.awaiting;
  ingestExplicitFacts(state, p, text);
  if (awaitedBefore && !p.awaiting && hasAnswer(p, awaitedBefore)) {
    return { matched: true, deferToAssistant: false, value: p.answers[awaitedBefore] };
  }
  if (!p.active || p.completed || !p.awaiting) {
    return { matched: false, deferToAssistant: false };
  }

  const result = answerExpected(p, state, text);
  if (result.matched) {
    p.answers[p.awaiting] = result.value;
    p.awaiting = null;
    return { matched: true, deferToAssistant: false };
  }

  return {
    matched: false,
    deferToAssistant: isQuestion(text),
  };
}

function prompt(key, reply) {
  return { key, reply };
}

function getTrack(state, text) {
  const p = ensureState(state);
  if (!p.track) p.track = detectTrack(state, text);
  return p.track;
}

function hasAnswer(p, key) {
  const value = p.answers?.[key];
  return value !== undefined && value !== null && value !== "";
}

function maybeSeedFromKnownState(state, p) {
  if (state?.measurements?.weightKg) p.answers.weight = state.measurements.weightKg;
  if (state?.measurements?.heightM) p.answers.height = state.measurements.heightM;
  if (state?.contactDraft?.c_aseguradora) p.answers.insurance = state.contactDraft.c_aseguradora;
  if (state?.contactDraft?.c_modalidad) p.answers.fonasa_tramo = state.contactDraft.c_modalidad;

  // El anuncio o interés de conversión NO demuestra que el paciente ya tenga manga.
  // Ese antecedente debe confirmarlo el propio paciente.
  const interest = normalize(state?.dealDraft?.dealInteres || "");
  void interest;
}

function nextRevisional(state, p) {
  if (!hasAnswer(p, "prior_surgery")) return prompt("prior_surgery", "ya tienes una manga?");
  if (p.answers.prior_surgery !== "ninguna" && !hasAnswer(p, "prior_year")) {
    return prompt("prior_year", p.answers.prior_surgery === "manga" ? "de qué año es tu manga?" : "de qué año fue esa cirugía?");
  }
  if (!hasAnswer(p, "revision_reason")) return prompt("revision_reason", "hoy qué te molesta más[[MSG]]reflujo peso o ambos?");
  if (!hasAnswer(p, "studies")) return prompt("studies", "tienes endoscopia u otro estudio reciente?");
  if (!hasAnswer(p, "weight")) return prompt("weight", "cuánto pesas?");
  if (!hasAnswer(p, "height")) return prompt("height", "y cuánto mides?");
  if (!hasAnswer(p, "age")) return prompt("age", "qué edad tienes?");
  if (!hasAnswer(p, "comorbidities")) return prompt("comorbidities", "tienes alguna enfermedad asociada?[[MSG]]diabetes presión alta apnea etc");
  if (!hasAnswer(p, "smoking")) return prompt("smoking", "fumas actualmente?");
  if (!hasAnswer(p, "safety")) return prompt("safety", "hay embarazo actual o alguna enfermedad importante descompensada?");
  if (!hasAnswer(p, "insurance")) return prompt("insurance", "tienes fonasa isapre o particular?");
  if (!hasAnswer(p, "city")) return prompt("city", "en qué ciudad estás?");
  return null;
}

function nextBariatric(state, p) {
  if (!hasAnswer(p, "weight")) return prompt("weight", "cuánto pesas?");
  if (!hasAnswer(p, "height")) return prompt("height", "y cuánto mides?");
  if (!hasAnswer(p, "age")) return prompt("age", "qué edad tienes?");
  if (!hasAnswer(p, "prior_surgery")) return prompt("prior_surgery", "te has operado antes de manga bypass u otra bariátrica?");
  if (p.answers.prior_surgery && p.answers.prior_surgery !== "ninguna") {
    p.track = "revisional";
    return nextRevisional(state, p);
  }
  if (!hasAnswer(p, "comorbidities")) return prompt("comorbidities", "tienes alguna enfermedad asociada?[[MSG]]diabetes presión alta apnea etc");
  if (!hasAnswer(p, "smoking")) return prompt("smoking", "fumas actualmente?");
  if (!hasAnswer(p, "safety")) return prompt("safety", "hay embarazo actual o alguna enfermedad importante descompensada?");
  if (!hasAnswer(p, "insurance")) return prompt("insurance", "tienes fonasa isapre o particular?");
  if (String(p.answers.insurance || "").toUpperCase().includes("FONASA") && !state?.system?.padNonEligibilityLead && !hasAnswer(p, "fonasa_tramo")) {
    return prompt("fonasa_tramo", "qué tramo Fonasa tienes A B C o D?");
  }
  if (!hasAnswer(p, "city")) return prompt("city", "en qué ciudad estás?");
  return null;
}

function nextBalloon(state, p) {
  if (!hasAnswer(p, "weight")) return prompt("weight", "cuánto pesas?");
  if (!hasAnswer(p, "height")) return prompt("height", "y cuánto mides?");
  if (!hasAnswer(p, "age")) return prompt("age", "qué edad tienes?");
  if (!hasAnswer(p, "prior_surgery")) return prompt("prior_surgery", "te has operado antes de manga bypass u otra bariátrica?");
  if (!hasAnswer(p, "comorbidities")) return prompt("comorbidities", "tienes alguna enfermedad importante diagnosticada?");
  if (!hasAnswer(p, "smoking")) return prompt("smoking", "fumas actualmente?");
  if (!hasAnswer(p, "insurance")) return prompt("insurance", "tienes fonasa isapre o particular?");
  if (!hasAnswer(p, "city")) return prompt("city", "en qué ciudad estás?");
  return null;
}

function nextAbdomen(state, p) {
  if (!hasAnswer(p, "weight")) return prompt("weight", "cuánto pesas?");
  if (!hasAnswer(p, "height")) return prompt("height", "y cuánto mides?");
  if (!hasAnswer(p, "age")) return prompt("age", "qué edad tienes?");
  if (!hasAnswer(p, "abdomen_fold")) return prompt("abdomen_fold", "el pliegue abdominal cuelga más de 5 cm bajo la ingle?");
  if (!hasAnswer(p, "postpartum")) return prompt("postpartum", "tuviste un parto hace menos de 6 meses?");
  if (!hasAnswer(p, "breastfeeding")) return prompt("breastfeeding", "estás amamantando actualmente?");
  if (!hasAnswer(p, "oncology")) return prompt("oncology", "tienes alguna enfermedad oncológica activa?");
  if (!hasAnswer(p, "skin_disease")) return prompt("skin_disease", "tienes alguna enfermedad activa en la piel del abdomen?");
  if (!hasAnswer(p, "smoking")) return prompt("smoking", "fumas actualmente?");
  if (!hasAnswer(p, "insurance")) return prompt("insurance", "tienes fonasa isapre o particular?");
  if (String(p.answers.insurance || "").toUpperCase().includes("FONASA") && !state?.system?.padNonEligibilityLead && !hasAnswer(p, "fonasa_tramo")) {
    return prompt("fonasa_tramo", "qué tramo Fonasa tienes A B C o D?");
  }
  if (!hasAnswer(p, "city")) return prompt("city", "en qué ciudad estás?");
  return null;
}

export function buildFonasaPadPreevaluationSummary(state) {
  const p = ensureState(state);
  const a = p.answers || {};
  const rows = [];
  rows.push(`tipo=${p.track || "sin_definir"}`);
  if (state?.dealDraft?.dealInteres) rows.push(`interes=${state.dealDraft.dealInteres}`);
  if (a.weight) rows.push(`peso=${a.weight}`);
  if (a.height) rows.push(`estatura=${a.height}`);
  if (state?.measurements?.bmi) rows.push(`imc=${state.measurements.bmi}`);
  if (a.age) rows.push(`edad=${a.age}`);
  if (a.prior_surgery) rows.push(`cirugia_previa=${a.prior_surgery}`);
  if (a.prior_year) rows.push(`anio_cirugia=${a.prior_year}`);
  if (a.revision_reason) rows.push(`motivo=${a.revision_reason}`);
  if (a.studies) rows.push(`estudios=${a.studies}`);
  if (a.comorbidities) rows.push(`antecedentes=${a.comorbidities}`);
  if (a.smoking) rows.push(`tabaco=${a.smoking}`);
  if (a.safety) rows.push(`seguridad=${a.safety}`);
  if (a.insurance) rows.push(`prevision=${a.insurance}`);
  if (a.fonasa_tramo) rows.push(`tramo=${a.fonasa_tramo}`);
  if (a.city) rows.push(`ciudad=${a.city}`);
  if (a.abdomen_fold) rows.push(`pliegue_abdominal=${a.abdomen_fold}`);
  if (a.postpartum) rows.push(`postparto=${a.postpartum}`);
  if (a.breastfeeding) rows.push(`lactancia=${a.breastfeeding}`);
  if (a.oncology) rows.push(`oncologia=${a.oncology}`);
  if (a.skin_disease) rows.push(`piel=${a.skin_disease}`);
  return rows.join(" | ");
}


function humanSmoking(value) {
  if (value === "no_fuma") return "no";
  if (value === "fuma_ocasional") return "ocasional";
  if (value === "fuma_actualmente") return "sí";
  return String(value || "");
}

function humanPrior(value) {
  if (value === "ninguna") return "no";
  return String(value || "");
}

export function buildFonasaPadPreevaluationPatientReply(state) {
  const p = ensureState(state);
  const a = p.answers || {};
  const lines = ["tu preevaluación"];

  if (state?.dealDraft?.dealInteres) lines.push(`procedimiento ${state.dealDraft.dealInteres}`);
  if (a.weight) lines.push(`peso ${a.weight} kg`);
  if (a.height) lines.push(`estatura ${Number(a.height).toFixed(2)} m`);
  if (state?.measurements?.bmi) lines.push(`IMC ${state.measurements.bmi}`);
  if (a.age) lines.push(`edad ${a.age}`);
  if (a.prior_surgery) lines.push(`cirugía previa ${humanPrior(a.prior_surgery)}`);
  if (a.prior_year) lines.push(typeof a.prior_year === "number" ? `cirugía ${a.prior_year}` : `cirugía ${a.prior_year}`);
  if (a.revision_reason) lines.push(`motivo ${a.revision_reason}`);
  if (a.studies) lines.push(`estudios ${a.studies}`);
  if (a.comorbidities) lines.push(`antecedentes ${a.comorbidities}`);
  if (a.smoking) lines.push(`tabaco ${humanSmoking(a.smoking)}`);
  if (a.safety) lines.push(`seguridad ${a.safety}`);
  if (a.insurance) lines.push(`previsión ${a.insurance}`);
  if (a.fonasa_tramo) lines.push(`tramo ${String(a.fonasa_tramo).replace(/^Tramo\s+/i, "")}`);
  if (a.city) lines.push(`ciudad ${a.city}`);
  if (a.abdomen_fold) lines.push(`pliegue abdominal ${a.abdomen_fold}`);
  if (a.postpartum) lines.push(`postparto ${a.postpartum}`);
  if (a.breastfeeding) lines.push(`lactancia ${a.breastfeeding}`);
  if (a.oncology) lines.push(`oncología ${a.oncology}`);
  if (a.skin_disease) lines.push(`piel ${a.skin_disease}`);

  return `listo[[MSG]]${lines.join("\n")}`;
}

export function nextFonasaPadPreevaluationStep(state, text = "") {
  const p = ensureState(state);
  if (p.completed) return null;

  const track = getTrack(state, text);
  if (!track) return null;
  if (!p.active) {
    p.active = true;
    p.startedAt = new Date().toISOString();
  }

  maybeSeedFromKnownState(state, p);

  let next = null;
  if (p.track === "revisional") next = nextRevisional(state, p);
  else if (p.track === "abdomen") next = nextAbdomen(state, p);
  else if (p.track === "balloon") next = nextBalloon(state, p);
  else next = nextBariatric(state, p);

  if (!next) {
    p.completed = true;
    p.completedAt = new Date().toISOString();
    p.awaiting = null;
    p.summary = buildFonasaPadPreevaluationSummary(state);
    return {
      completed: true,
      reply: buildFonasaPadPreevaluationPatientReply(state),
      summary: p.summary,
    };
  }

  p.awaiting = next.key;
  p.lastPrompt = next.reply;
  p.askedKeys[next.key] = Number(p.askedKeys[next.key] || 0) + 1;
  return {
    completed: false,
    key: next.key,
    reply: next.reply,
  };
}

export function shouldDeferPreevaluationForQuestion(state, text = "") {
  const p = ensureState(state);
  return Boolean(p.active && !p.completed && p.awaiting && isQuestion(text));
}
