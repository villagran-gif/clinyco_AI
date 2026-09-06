import test from "node:test";
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
