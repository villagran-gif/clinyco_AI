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
  if (/manga/.test(key)) return "manga";
  if (/bypass/.test(key)) return "bypass";
  if (/otra|switch|sadi|banda/.test(key)) return "otra";
  const yn = parseYesNo(text);
  if (yn === false) return "ninguna";
  return null;
}

function parseSmoking(text) {
  const key = normalize(text);
  if (/no fumo|no fumador|nunca he fumado|nunca fumo/.test(key)) return "no_fuma";
  if (/deje|dejé|ex fum|exfum/.test(key)) return `exfumador: ${String(text).trim()}`;
  if (/fumo|fumador|cigarro|tabaco/.test(key)) return "fuma_actualmente";
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
    const m = String(text || "").trim().match(/^(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kilos?)?$/i);
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

export function applyFonasaPadPreevaluationAnswer(state, text = "") {
  const p = ensureState(state);
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

  const interest = normalize(state?.dealDraft?.dealInteres || "");
  if (p.track === "revisional" && /conversion.*manga.*bypass|manga.*bypass/.test(interest)) {
    p.answers.prior_surgery = p.answers.prior_surgery || "manga";
  }
}

function nextRevisional(state, p) {
  if (!hasAnswer(p, "prior_surgery")) return prompt("prior_surgery", "te operaste antes de manga bypass u otra bariátrica?");
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
      reply: "listo[[MSG]]con esto ya tengo tu preevaluación",
      summary: p.summary,
    };
  }

  p.awaiting = next.key;
  p.lastPrompt = next.reply;
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
