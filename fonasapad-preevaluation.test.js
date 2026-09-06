import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFonasaPadPreevaluationAnswer,
  nextFonasaPadPreevaluationStep,
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
