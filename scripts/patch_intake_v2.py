from pathlib import Path

# -------------------------
# 1) FONASAPAD conversational parser
# -------------------------
p = Path('fonasapad-preevaluation.js')
s = p.read_text()

old = '''function parsePriorSurgery(text) {\n  const key = normalize(text);\n  if (/manga/.test(key)) return "manga";\n  if (/bypass/.test(key)) return "bypass";\n  if (/otra|switch|sadi|banda/.test(key)) return "otra";\n  const yn = parseYesNo(text);\n  if (yn === false) return "ninguna";\n  return null;\n}\n\nfunction parseSmoking(text) {\n  const key = normalize(text);\n  if (/no fumo|no fumador|nunca he fumado|nunca fumo/.test(key)) return "no_fuma";\n  if (/deje|dejé|ex fum|exfum/.test(key)) return `exfumador: ${String(text).trim()}`;\n  if (/fumo|fumador|cigarro|tabaco/.test(key)) return "fuma_actualmente";\n  const yn = parseYesNo(text);\n  if (yn === false) return "no_fuma";\n  if (yn === true) return "fuma_actualmente";\n  return null;\n}'''
new = '''function parsePriorSurgery(text) {\n  const key = normalize(text);\n\n  // Una negación explícita del paciente siempre gana sobre inferencias previas\n  // hechas desde un anuncio o desde el procedimiento consultado.\n  if (/no tengo ninguna (operacion|cirugia)|no me he operado|nunca me he operado|sin cirugia bariatrica|ninguna cirugia bariatrica/.test(key)) return "ninguna";\n  if (/no tengo manga|no tengo una manga/.test(key) && !/(tengo|tuve|me hice|me ise|me opere).*bypass/.test(key)) return "ninguna";\n  if (/no tengo bypass/.test(key) && !/(tengo|tuve|me hice|me ise|me opere).*manga/.test(key)) return "ninguna";\n\n  if (/(ya tengo|tengo una|tuve una|me hice|me ise|me iz[eé]|me opere|me operaron|fui operad).*manga/.test(key)) return "manga";\n  if (/(ya tengo|tengo un|tuve un|me hice|me ise|me iz[eé]|me opere|me operaron|fui operad).*bypass/.test(key)) return "bypass";\n  if (/manga/.test(key) && !/^no\\b/.test(key)) return "manga";\n  if (/bypass/.test(key) && !/^no\\b/.test(key)) return "bypass";\n  if (/otra|switch|sadi|banda/.test(key)) return "otra";\n  const yn = parseYesNo(text);\n  if (yn === false) return "ninguna";\n  return null;\n}\n\nfunction parseSmoking(text) {\n  const key = normalize(text);\n  if (/no fumo|no fumador|nunca he fumado|nunca fumo|para nada|nada de tabaco/.test(key)) return "no_fuma";\n  if (/deje|dejé|ex fum|exfum/.test(key)) return `exfumador: ${String(text).trim()}`;\n\n  // Modismos/fórmulas frecuentes en Chile para consumo ocasional.\n  if (/de vez en cuando|de repente|a veces|ocasional|socialmente|muy poco|cada cierto tiempo|solo.*(carrete|salgo|fiesta)|fin de semana/.test(key)) return "fuma_ocasional";\n\n  if (/fumo|fumador|cigarro|tabaco|pucho/.test(key)) return "fuma_actualmente";\n  const yn = parseYesNo(text);\n  if (yn === false) return "no_fuma";\n  if (yn === true) return "fuma_actualmente";\n  return null;\n}'''
assert old in s
s = s.replace(old, new, 1)

old = '''  if (key === "weight") {\n    if (state?.measurements?.weightKg) return { matched: true, value: state.measurements.weightKg };\n    const m = String(text || "").trim().match(/^(\\d{2,3}(?:[.,]\\d{1,2})?)\\s*(?:kg|kilos?)?$/i);\n    if (m) {\n      const value = Number(m[1].replace(",", "."));\n      if (value >= 30 && value <= 350) {\n        state.measurements.weightKg = value;\n        state.dealDraft.dealPeso = String(value);\n        return { matched: true, value };\n      }\n    }\n    return { matched: false };\n  }'''
new = '''  if (key === "weight") {\n    if (state?.measurements?.weightKg) return { matched: true, value: state.measurements.weightKg };\n    const raw = String(text || "").trim();\n    const m = raw.match(/\\b(\\d{2,3}(?:[.,]\\d{1,2})?)\\s*(?:kg|kilo|kilos)\\b/i)\n      || raw.match(/^\\s*(?:peso\\s*)?(?:como\\s+|aprox(?:imadamente)?\\s+|unos?\\s+)?(\\d{2,3}(?:[.,]\\d{1,2})?)\\b/i);\n    if (m) {\n      const value = Number(m[1].replace(",", "."));\n      if (value >= 30 && value <= 350) {\n        state.measurements.weightKg = value;\n        state.dealDraft.dealPeso = String(value);\n        return { matched: true, value };\n      }\n    }\n    return { matched: false };\n  }'''
assert old in s
s = s.replace(old, new, 1)

old = '''  if (key === "fonasa_tramo") {\n    if (state?.contactDraft?.c_modalidad) return { matched: true, value: state.contactDraft.c_modalidad };\n    return { matched: false };\n  }'''
new = '''  if (key === "fonasa_tramo") {\n    if (state?.contactDraft?.c_modalidad) return { matched: true, value: state.contactDraft.c_modalidad };\n    const normalized = normalize(text);\n    const m = normalized.match(/\\b(?:tramo\\s+)?([abcd])\\b/);\n    if (m) {\n      const tramo = m[1].toUpperCase();\n      state.contactDraft.c_aseguradora = "FONASA";\n      state.contactDraft.c_modalidad = `Tramo ${tramo}`;\n      return { matched: true, value: `Tramo ${tramo}` };\n    }\n    return { matched: false };\n  }'''
assert old in s
s = s.replace(old, new, 1)

# Replace ingestExplicitFacts with a more tolerant version.
start = s.index('function ingestExplicitFacts(state, p, text = "") {')
end = s.index('\n}\n\nexport function hydrateFonasaPadPreevaluationFromHistory', start) + 2
new_func = r'''function ingestExplicitFacts(state, p, text = "") {
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
}'''
s = s[:start] + new_func + s[end:]

# Seed inferred manga only when not explicitly contradicted.
old = '''  const interest = normalize(state?.dealDraft?.dealInteres || "");\n  if (p.track === "revisional" && /conversion.*manga.*bypass|manga.*bypass/.test(interest)) {\n    p.answers.prior_surgery = p.answers.prior_surgery || "manga";\n  }'''
new = '''  const interest = normalize(state?.dealDraft?.dealInteres || "");\n  if (p.track === "revisional" && /conversion.*manga.*bypass|manga.*bypass/.test(interest) && !hasAnswer(p, "prior_surgery")) {\n    p.answers.prior_surgery = "manga";\n  }'''
assert old in s
s = s.replace(old, new, 1)

# Human-readable summary.
marker = 'export function nextFonasaPadPreevaluationStep(state, text = "") {'
summary_helper = r'''
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

'''
assert marker in s
s = s.replace(marker, summary_helper + marker, 1)

old = '''    return {\n      completed: true,\n      reply: "listo[[MSG]]con esto ya tengo tu preevaluación",\n      summary: p.summary,\n    };'''
new = '''    return {\n      completed: true,\n      reply: buildFonasaPadPreevaluationPatientReply(state),\n      summary: p.summary,\n    };'''
assert old in s
s = s.replace(old, new, 1)

p.write_text(s)

# -------------------------
# 2) Global draft extraction: keep partial measurements and canonical Fonasa
# -------------------------
p = Path('extraction/updateDraftsFromText.js')
s = p.read_text()
old = '''import { parseStructuredBlock } from "./parseStructuredBlock.js";'''
new = '''import { parseStructuredBlock } from "./parseStructuredBlock.js";\nimport { calculateBMI, getBMICategory } from "./parseMeasurements.js";'''
assert old in s
s = s.replace(old, new, 1)

old = '''  if (insuranceInfo?.aseguradora) {\n    state.contactDraft.c_aseguradora = insuranceInfo.aseguradora;\n    if (insuranceInfo.aseguradora !== "FONASA" && insuranceInfo.modalidad) {\n      state.contactDraft.c_modalidad = insuranceInfo.modalidad;\n    }\n  }'''
new = '''  if (insuranceInfo?.aseguradora) {\n    // PAD es una modalidad/prestación de Fonasa, no una aseguradora distinta.\n    const canonicalInsurance = insuranceInfo.aseguradora === "PAD Fonasa PAD" ? "FONASA" : insuranceInfo.aseguradora;\n    state.contactDraft.c_aseguradora = canonicalInsurance;\n    if (canonicalInsurance !== "FONASA" && insuranceInfo.modalidad) {\n      state.contactDraft.c_modalidad = insuranceInfo.modalidad;\n    }\n  }'''
assert old in s
s = s.replace(old, new, 1)

old = '''  if (structured.weightKg) state.dealDraft.dealPeso = String(structured.weightKg);\n  if (structured.heightCm) state.dealDraft.dealEstatura = String(structured.heightCm);\n  if (structured.bmi) {\n    state.measurements.weightKg = structured.weightKg;\n    state.measurements.heightM = structured.heightM;\n    state.measurements.heightCm = structured.heightCm;\n    state.measurements.bmi = structured.bmi;\n    state.measurements.bmiCategory = structured.bmiCategory;\n  }'''
new = '''  if (structured.weightKg) {\n    state.dealDraft.dealPeso = String(structured.weightKg);\n    state.measurements.weightKg = structured.weightKg;\n  }\n  if (structured.heightM) {\n    state.measurements.heightM = structured.heightM;\n    state.measurements.heightCm = structured.heightCm || Math.round(structured.heightM * 100);\n    state.dealDraft.dealEstatura = String(state.measurements.heightCm);\n  }\n\n  if (state.measurements.weightKg && state.measurements.heightM) {\n    const bmi = structured.bmi || calculateBMI(state.measurements.weightKg, state.measurements.heightM);\n    state.measurements.bmi = bmi;\n    state.measurements.bmiCategory = structured.bmiCategory || getBMICategory(bmi);\n  }'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)

# -------------------------
# 3) Model config + Chilean-language understanding prompt
# -------------------------
p = Path('server.js')
s = p.read_text()
old = '''  async function createCompletion(messages) {\n    return openai.chat.completions.create({\n      model: OPENAI_MODEL,\n      messages,\n      max_completion_tokens: Math.max(300, Number(process.env.ANTONIA_MAX_COMPLETION_TOKENS || 800)),\n    });\n  }'''
new = '''  async function createCompletion(messages) {\n    const request = {\n      model: OPENAI_MODEL,\n      messages,\n      max_completion_tokens: Math.max(300, Number(process.env.ANTONIA_MAX_COMPLETION_TOKENS || 800)),\n    };\n    if (String(OPENAI_MODEL).startsWith("gpt-5.6")) {\n      request.reasoning_effort = process.env.ANTONIA_REASONING_EFFORT || "none";\n    }\n    return openai.chat.completions.create(request);\n  }'''
assert old in s
s = s.replace(old, new, 1)

marker = '''- si la persona ya dijo lo que necesita y tú puedes orientar, responde primero y pregunta después solo si hace falta\n\n${buildKnowledgePromptContext()}'''
insert = '''- si la persona ya dijo lo que necesita y tú puedes orientar, responde primero y pregunta después solo si hace falta\n\nINTERPRETACIÓN DE ESPAÑOL CHILENO Y MENSAJES NATURALES:\n- entiende modismos pero no los imites artificialmente\n- “de vez en cuando”, “de repente”, “a veces”, “socialmente” = ocasional\n- “guata” o “guatita” = abdomen\n- “me ise una manga” o “me hice una manga” = antecedente de manga gástrica\n- “creo B”, “soy B”, “Fonasa D” = tramo Fonasa cuando el contexto es previsional\n- “sip”, “sipo”, “ya”, “dale” pueden equivaler a sí según la pregunta anterior\n- “nop”, “na”, “para nada” pueden equivaler a no según el contexto\n- si el paciente corrige un dato, la corrección más reciente manda sobre el anuncio, inferencias y respuestas anteriores\n- nunca obligues al paciente a repetir un dato que acaba de expresar en una frase más larga\n\n${buildKnowledgePromptContext()}'''
assert marker in s
s = s.replace(marker, insert, 1)
p.write_text(s)

# -------------------------
# 4) Tests
# -------------------------
p = Path('fonasapad-preevaluation.test.js')
s = p.read_text()
old = '''  hydrateFonasaPadPreevaluationFromHistory,\n} from "./fonasapad-preevaluation.js";'''
new = '''  hydrateFonasaPadPreevaluationFromHistory,\n  buildFonasaPadPreevaluationPatientReply,\n} from "./fonasapad-preevaluation.js";'''
assert old in s
s = s.replace(old, new, 1)

s += r'''

test("acepta peso expresado en una frase natural", () => {
  const s = state("Balón gástrico");
  nextFonasaPadPreevaluationStep(s, "balón");
  const result = applyFonasaPadPreevaluationAnswer(s, "120 kilo la última vez");
  assert.equal(result.matched, true);
  assert.equal(s.measurements.weightKg, 120);
});

test("absorbe peso y manga previa con typo chileno en una sola frase", () => {
  const s = state("Balón gástrico");
  nextFonasaPadPreevaluationStep(s, "balón");
  const result = applyFonasaPadPreevaluationAnswer(s, "89 kilos pero ase 18 meses me ise una manga gástrica");
  assert.equal(result.matched, true);
  assert.equal(s.measurements.weightKg, 89);
  assert.equal(s.preevaluation.answers.prior_surgery, "manga");
  assert.equal(s.preevaluation.answers.prior_year, "hace 18 meses");
  assert.equal(s.preevaluation.track, "revisional");
});

test("negación explícita corrige falsa inferencia de manga", () => {
  const s = state("Conversión de manga a bypass");
  let step = nextFonasaPadPreevaluationStep(s, "conversión");
  assert.equal(step.key, "prior_year");
  applyFonasaPadPreevaluationAnswer(s, "Noo yo no tengo ninguna operación quiero una bariátrica");
  assert.equal(s.preevaluation.answers.prior_surgery, "ninguna");
  assert.equal(s.preevaluation.track, "bariatric");
  assert.equal(s.preevaluation.answers.prior_year, undefined);
  step = nextFonasaPadPreevaluationStep(s, "");
  assert.notEqual(step?.key, "prior_year");
});

test("entiende Creo b como tramo B", () => {
  const s = state("Manga gástrica");
  s.preevaluation.active = true;
  s.preevaluation.track = "bariatric";
  s.preevaluation.awaiting = "fonasa_tramo";
  const result = applyFonasaPadPreevaluationAnswer(s, "Creo b");
  assert.equal(result.matched, true);
  assert.equal(s.contactDraft.c_modalidad, "Tramo B");
});

test("de vez en cuando significa tabaco ocasional", () => {
  const s = state("Manga gástrica");
  s.preevaluation.active = true;
  s.preevaluation.track = "bariatric";
  s.preevaluation.awaiting = "smoking";
  const result = applyFonasaPadPreevaluationAnswer(s, "de vez en cuando");
  assert.equal(result.matched, true);
  assert.equal(s.preevaluation.answers.smoking, "fuma_ocasional");
});

test("resumen de preevaluación se muestra al paciente", () => {
  const s = state("Balón gástrico");
  s.measurements.weightKg = 120;
  s.measurements.heightM = 1.6;
  s.measurements.bmi = 46.9;
  s.preevaluation.track = "balloon";
  s.preevaluation.answers = {
    weight: 120, height: 1.6, age: 40, prior_surgery: "ninguna",
    comorbidities: "Pre diabetes", smoking: "fuma_ocasional",
    insurance: "FONASA", city: "Santiago"
  };
  const reply = buildFonasaPadPreevaluationPatientReply(s);
  assert.match(reply, /peso 120 kg/);
  assert.match(reply, /IMC 46.9/);
  assert.match(reply, /cirugía previa no/);
  assert.match(reply, /tabaco ocasional/);
  assert.match(reply, /ciudad Santiago/);
});
'''
p.write_text(s)

# Dedicated extraction regression tests
Path('extraction/updateDraftsFromText.test.js').write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { updateDraftsFromText } from "./updateDraftsFromText.js";

function state() {
  return {
    contactDraft: { c_aseguradora: null, c_modalidad: null },
    dealDraft: { dealPeso: null, dealEstatura: null, dealInteres: null, dealPipelineId: null, dealValidacionPad: null },
    measurements: { weightKg: null, heightM: null, heightCm: null, bmi: null, bmiCategory: null },
    identity: { saysExistingPatient: false }
  };
}

test("guarda peso parcial aunque talla llegue después", () => {
  const s = state();
  updateDraftsFromText(s, "120 kilo la última vez");
  assert.equal(s.measurements.weightKg, 120);
  updateDraftsFromText(s, "mido 1.60 m");
  assert.equal(s.measurements.heightM, 1.6);
  assert.equal(s.measurements.bmi, 46.9);
});

test("mencionar bono PAD no reemplaza FONASA por una aseguradora ficticia", () => {
  const s = state();
  s.contactDraft.c_aseguradora = "FONASA";
  s.contactDraft.c_modalidad = "Tramo B";
  updateDraftsFromText(s, "Tengo derecho a bono PAD");
  assert.equal(s.contactDraft.c_aseguradora, "FONASA");
  assert.equal(s.contactDraft.c_modalidad, "Tramo B");
});
''')
