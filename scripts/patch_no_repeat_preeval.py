from pathlib import Path

# 1) fonasapad-preevaluation.js
p = Path('fonasapad-preevaluation.js')
s = p.read_text()

old = '''  p.summary ??= null;\n  p.lastPrompt ??= null;\n  return p;'''
new = '''  p.summary ??= null;\n  p.lastPrompt ??= null;\n  p.historyHydratedVersion ??= 0;\n  p.historyHydratedAt ??= null;\n  p.askedKeys ??= {};\n  return p;'''
assert old in s
s = s.replace(old, new, 1)

marker = '''export function applyFonasaPadPreevaluationAnswer(state, text = "") {'''
helpers = r'''
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

  // Sólo tratamos como cirugía PREVIA frases que realmente expresan antecedente,
  // no un simple interés comercial como "me interesa manga".
  if (/(ya tengo|me hice|me opere|me operaron|fui operad|tengo una|tuve una|cirugia previa).*manga/.test(key) || /manga.*\b(19\d{2}|20\d{2})\b/.test(key)) {
    p.answers.prior_surgery = "manga";
  } else if (/(ya tengo|me hice|me opere|me operaron|fui operad|tengo un|tuve un|cirugia previa).*bypass/.test(key) || /bypass.*\b(19\d{2}|20\d{2})\b/.test(key)) {
    p.answers.prior_surgery = "bypass";
  }

  const year = parseYear(raw);
  if (year && (/(manga|bypass|cirugia|operad)/.test(key) || (p.track === "revisional" && /\b(fue|ano|en el)\b/.test(key)))) {
    p.answers.prior_year = year;
  }

  if (/reflujo|reganancia|recupere.*peso|recuper.*peso|subi.*peso|aumente.*peso/.test(key)) {
    p.answers.revision_reason = raw;
  }

  if (/tengo\s+\d{2}\s+anos|tengo\s+\d{2}\s+años|edad\s*[:=]?\s*\d{2}/i.test(raw)) {
    const age = parseAge(raw);
    if (age) p.answers.age = age;
  }

  if (/no fumo|fumo|fumador|tabaco|cigarro/.test(key)) {
    const smoking = parseSmoking(raw);
    if (smoking) p.answers.smoking = smoking;
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

'''
assert marker in s
s = s.replace(marker, helpers + marker, 1)

old = '''export function applyFonasaPadPreevaluationAnswer(state, text = "") {\n  const p = ensureState(state);\n  if (!p.active || p.completed || !p.awaiting) {'''
new = '''export function applyFonasaPadPreevaluationAnswer(state, text = "") {\n  const p = ensureState(state);\n  ingestExplicitFacts(state, p, text);\n  if (!p.active || p.completed || !p.awaiting) {'''
assert old in s
s = s.replace(old, new, 1)

old = '''  p.awaiting = next.key;\n  p.lastPrompt = next.reply;\n  return {'''
new = '''  p.awaiting = next.key;\n  p.lastPrompt = next.reply;\n  p.askedKeys[next.key] = Number(p.askedKeys[next.key] || 0) + 1;\n  return {'''
assert old in s
s = s.replace(old, new, 1)

p.write_text(s)

# 2) state schema
p = Path('memory/state-schema.js')
s = p.read_text()
old = '''      answers: {},\n      summary: null,\n      lastPrompt: null'''
new = '''      answers: {},\n      summary: null,\n      lastPrompt: null,\n      historyHydratedVersion: 0,\n      historyHydratedAt: null,\n      askedKeys: {}'''
assert old in s
s = s.replace(old, new, 1)

old = '''      ...(persistedState.preevaluation || {}),\n      answers: { ...baseState.preevaluation.answers, ...(persistedState.preevaluation?.answers || {}) }'''
new = '''      ...(persistedState.preevaluation || {}),\n      answers: { ...baseState.preevaluation.answers, ...(persistedState.preevaluation?.answers || {}) },\n      askedKeys: { ...baseState.preevaluation.askedKeys, ...(persistedState.preevaluation?.askedKeys || {}) }'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)

# 3) server integration
p = Path('server.js')
s = p.read_text()
old = '''  applyFonasaPadPreevaluationAnswer,\n  isFonasaPadPreevaluationRelevant,\n  nextFonasaPadPreevaluationStep,'''
new = '''  applyFonasaPadPreevaluationAnswer,\n  hydrateFonasaPadPreevaluationFromHistory,\n  isFonasaPadPreevaluationRelevant,\n  nextFonasaPadPreevaluationStep,'''
assert old in s
s = s.replace(old, new, 1)

old = '''    // --- FONASAPAD conversational preevaluation ---\n    if (!state.melania?.active && !state.booking?.awaitingSlotChoice && !state.booking?.chosenSlot && isFonasaPadPreevaluationRelevant(state, userText) && !(hasScheduleIntent(userText) || hasExplicitScheduleIntent(userText))) {\n      const preevalAnswer = applyFonasaPadPreevaluationAnswer(state, userText);'''
new = '''    // --- FONASAPAD conversational preevaluation ---\n    if (!state.melania?.active && !state.booking?.awaitingSlotChoice && !state.booking?.chosenSlot && isFonasaPadPreevaluationRelevant(state, userText) && !(hasScheduleIntent(userText) || hasExplicitScheduleIntent(userText))) {\n      // Un deploy/restart no puede hacer que AntonIA olvide hechos ya dichos.\n      // Rehidratamos una vez por versión desde mensajes persistidos, sin mandar\n      // todo ese historial al modelo ni aumentar el costo de OpenAI.\n      if (Number(state.preevaluation?.historyHydratedVersion || 0) < 2) {\n        try {\n          const preevalHistory = dbEnabled()\n            ? await getRecentConversationMessages(conversationId, 60)\n            : getHistory(conversationId);\n          hydrateFonasaPadPreevaluationFromHistory(state, preevalHistory);\n          await persistConversationSnapshot(conversationId, state, channelLabel);\n          console.log(`[fonasapad] history hydrated conversation=${conversationId} messages=${preevalHistory.length}`);\n        } catch (historyErr) {\n          console.warn(`[fonasapad] history hydration failed conversation=${conversationId}:`, historyErr.message);\n          hydrateFonasaPadPreevaluationFromHistory(state, getHistory(conversationId));\n        }\n      }\n      const preevalAnswer = applyFonasaPadPreevaluationAnswer(state, userText);'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)

# 4) tests
p = Path('fonasapad-preevaluation.test.js')
s = p.read_text()
old = '''  nextFonasaPadPreevaluationStep,\n} from "./fonasapad-preevaluation.js";'''
new = '''  nextFonasaPadPreevaluationStep,\n  hydrateFonasaPadPreevaluationFromHistory,\n} from "./fonasapad-preevaluation.js";'''
assert old in s
s = s.replace(old, new, 1)

s += r'''

test("rehidrata manga 2012 y motivo ya respondidos antes de un deploy", () => {
  const state = makeState("Conversión de manga a bypass");
  state.measurements.weightKg = 83;
  state.measurements.heightM = 1.58;
  state.contactDraft.c_aseguradora = "FONASA";
  state.contactDraft.c_modalidad = "Tramo D";
  state.preevaluation.active = true;
  state.preevaluation.track = "revisional";
  state.preevaluation.awaiting = "prior_year";

  const history = [
    { role: "user", content: "Ya tengo una manga", created_at: "2026-09-06T22:56:21Z" },
    { role: "assistant", content: "quieres conversion de manga a bypass por reflujo reganancia o ambos?", created_at: "2026-09-06T22:56:27Z" },
    { role: "user", content: "Ambos", created_at: "2026-09-06T22:57:42Z" },
    { role: "assistant", content: "hace cuánto fue la manga?", created_at: "2026-09-06T22:57:53Z" },
    { role: "user", content: "En el 2012", created_at: "2026-09-06T22:59:34Z" },
  ];

  hydrateFonasaPadPreevaluationFromHistory(state, history);
  assert.equal(state.preevaluation.answers.prior_surgery, "manga");
  assert.equal(state.preevaluation.answers.prior_year, 2012);
  assert.equal(state.preevaluation.answers.revision_reason, "Ambos");
  assert.equal(state.preevaluation.awaiting, null);

  const next = nextFonasaPadPreevaluationStep(state, "");
  assert.notEqual(next?.key, "prior_surgery");
  assert.notEqual(next?.key, "prior_year");
  assert.notEqual(next?.key, "revision_reason");
});

test("extrae varios hechos explícitos aunque espere otro campo", () => {
  const state = makeState("Conversión de manga a bypass");
  state.preevaluation.active = true;
  state.preevaluation.track = "revisional";
  state.preevaluation.awaiting = "age";
  applyFonasaPadPreevaluationAnswer(state, "me operé de manga en 2015 y tengo reflujo y reganancia");
  assert.equal(state.preevaluation.answers.prior_surgery, "manga");
  assert.equal(state.preevaluation.answers.prior_year, 2015);
  assert.match(String(state.preevaluation.answers.revision_reason), /reflujo/i);
});
'''
p.write_text(s)
