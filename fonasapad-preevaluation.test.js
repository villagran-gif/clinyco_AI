import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFonasaPadPreevaluationAnswer,
  nextFonasaPadPreevaluationStep,
  hydrateFonasaPadPreevaluationFromHistory,
  buildFonasaPadPreevaluationPatientReply,
} from "./fonasapad-preevaluation.js";

function state(interest = null) {
  return {
    contactDraft: { c_aseguradora: null, c_modalidad: null },
    dealDraft: { dealInteres: interest },
    measurements: { weightKg: null, heightM: null, bmi: null },
    system: { padNonEligibilityLead: false },
    preevaluation: {
      active: false,
      completed: false,
      track: null,
      awaiting: null,
      answers: {},
    },
  };
}

test("conversión confirma primero si realmente existe una manga previa", () => {
  const s = state("Conversión de manga a bypass");
  const step = nextFonasaPadPreevaluationStep(s, "me interesa conversión de manga a bypass");
  assert.equal(s.preevaluation.track, "revisional");
  assert.equal(s.preevaluation.answers.prior_surgery, undefined);
  assert.equal(step.key, "prior_surgery");
  assert.match(step.reply, /ya tienes una manga/i);
});

test("flujo revisional avanza confirmación → año → motivo → estudios", () => {
  const s = state("Conversión de manga a bypass");
  let step = nextFonasaPadPreevaluationStep(s, "conversión");
  assert.equal(step.key, "prior_surgery");
  assert.equal(applyFonasaPadPreevaluationAnswer(s, "sí tengo una manga").matched, true);
  step = nextFonasaPadPreevaluationStep(s, "sí tengo una manga");
  assert.equal(step.key, "prior_year");
  assert.equal(applyFonasaPadPreevaluationAnswer(s, "2018").matched, true);
  step = nextFonasaPadPreevaluationStep(s, "2018");
  assert.equal(step.key, "revision_reason");
  assert.equal(applyFonasaPadPreevaluationAnswer(s, "reflujo y reganancia").matched, true);
  step = nextFonasaPadPreevaluationStep(s, "reflujo y reganancia");
  assert.equal(step.key, "studies");
});

test("datos ya conocidos se saltan", () => {
  const s = state("Manga gástrica");
  s.measurements.weightKg = 92;
  s.measurements.heightM = 1.68;
  s.contactDraft.c_aseguradora = "FONASA";
  s.contactDraft.c_modalidad = "Tramo D";
  const step = nextFonasaPadPreevaluationStep(s, "manga");
  assert.equal(step.key, "age");
});

test("primera cirugía pregunta peso antes que previsión", () => {
  const s = state("Bypass gástrico");
  const step = nextFonasaPadPreevaluationStep(s, "quiero bypass");
  assert.equal(step.key, "weight");
});

test("pregunta intercalada no se consume como respuesta clínica", () => {
  const s = state("Manga gástrica");
  nextFonasaPadPreevaluationStep(s, "manga");
  const result = applyFonasaPadPreevaluationAnswer(s, "cuánto cuesta?");
  assert.equal(result.matched, false);
  assert.equal(result.deferToAssistant, true);
  assert.equal(s.preevaluation.awaiting, "weight");
});


test("rehidrata manga 2012 y motivo ya respondidos antes de un deploy", () => {
  const s = state("Conversión de manga a bypass");
  s.measurements.weightKg = 83;
  s.measurements.heightM = 1.58;
  s.contactDraft.c_aseguradora = "FONASA";
  s.contactDraft.c_modalidad = "Tramo D";
  s.preevaluation.active = true;
  s.preevaluation.track = "revisional";
  s.preevaluation.answers.prior_surgery = "manga";
  s.preevaluation.awaiting = "prior_year";

  const history = [
    { role: "user", content: "Ya tengo una manga", created_at: "2026-09-06T22:56:21Z" },
    { role: "assistant", content: "quieres conversion de manga a bypass por reflujo reganancia o ambos?", created_at: "2026-09-06T22:56:27Z" },
    { role: "user", content: "Ambos", created_at: "2026-09-06T22:57:42Z" },
    { role: "assistant", content: "hace cuánto fue la manga?", created_at: "2026-09-06T22:57:53Z" },
    { role: "user", content: "En el 2012", created_at: "2026-09-06T22:59:34Z" },
  ];

  hydrateFonasaPadPreevaluationFromHistory(s, history);
  assert.equal(s.preevaluation.answers.prior_surgery, "manga");
  assert.equal(s.preevaluation.answers.prior_year, 2012);
  assert.equal(s.preevaluation.answers.revision_reason, "Ambos");
  assert.equal(s.preevaluation.awaiting, null);

  const next = nextFonasaPadPreevaluationStep(s, "");
  assert.notEqual(next?.key, "prior_surgery");
  assert.notEqual(next?.key, "prior_year");
  assert.notEqual(next?.key, "revision_reason");
});

test("extrae varios hechos explícitos aunque espere otro campo", () => {
  const s = state("Conversión de manga a bypass");
  s.preevaluation.active = true;
  s.preevaluation.track = "revisional";
  s.preevaluation.awaiting = "age";
  applyFonasaPadPreevaluationAnswer(s, "me operé de manga en 2015 y tengo reflujo y reganancia");
  assert.equal(s.preevaluation.answers.prior_surgery, "manga");
  assert.equal(s.preevaluation.answers.prior_year, 2015);
  assert.match(String(s.preevaluation.answers.revision_reason), /reflujo/i);
});


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
  s.preevaluation.active = true;
  s.preevaluation.track = "revisional";
  s.preevaluation.answers.prior_surgery = "manga";
  s.preevaluation.awaiting = "prior_year";
  let step = { key: "prior_year" };
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
