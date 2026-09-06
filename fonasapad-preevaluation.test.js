import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFonasaPadPreevaluationAnswer,
  nextFonasaPadPreevaluationStep,
  hydrateFonasaPadPreevaluationFromHistory,
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

test("conversión reconoce manga previa y pregunta año primero", () => {
  const s = state("Conversión de manga a bypass");
  const step = nextFonasaPadPreevaluationStep(s, "me interesa conversión de manga a bypass");
  assert.equal(s.preevaluation.track, "revisional");
  assert.equal(s.preevaluation.answers.prior_surgery, "manga");
  assert.equal(step.key, "prior_year");
  assert.match(step.reply, /año.*manga/i);
});

test("flujo revisional avanza año → motivo → estudios", () => {
  const s = state("Conversión de manga a bypass");
  let step = nextFonasaPadPreevaluationStep(s, "conversión");
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
