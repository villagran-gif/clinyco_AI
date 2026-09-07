import test from "node:test";
import assert from "node:assert/strict";
import {
  isChileAfterHours,
  getAfterHoursShiftKey,
  registerAfterHoursInbound,
  parseCallbackPreference,
  shouldCloseAfterHours,
  markAfterHoursClosed,
  setCallbackPreference,
  buildAfterHoursClosureReply,
  buildAfterHoursPreferenceReply,
} from "./after-hours.js";

function state() {
  return { system: {} };
}

test("21:00 Chile activa horario nocturno", () => {
  const d = new Date("2026-09-07T00:00:00Z"); // 21:00 Chile aprox en DST
  assert.equal(isChileAfterHours(d), true);
});

test("00:30 sigue perteneciendo al turno nocturno anterior", () => {
  const d = new Date("2026-09-07T03:30:00Z");
  assert.equal(isChileAfterHours(d), true);
  assert.equal(getAfterHoursShiftKey(d), "2026-09-06");
});

test("registra turnos y cierra al quinto intercambio", () => {
  const s = state();
  const d = new Date("2026-09-07T01:00:00Z");
  for (let i = 0; i < 4; i += 1) registerAfterHoursInbound(s, d);
  assert.equal(shouldCloseAfterHours(s), false);
  registerAfterHoursInbound(s, d);
  assert.equal(shouldCloseAfterHours(s), true);
});

test("preevaluación completa fuerza cierre nocturno", () => {
  const s = state();
  const d = new Date("2026-09-07T01:00:00Z");
  registerAfterHoursInbound(s, d);
  assert.equal(shouldCloseAfterHours(s, { preevaluationCompleted: true }), true);
});

test("entiende am y pm", () => {
  assert.equal(parseCallbackPreference("en la mañana"), "am");
  assert.equal(parseCallbackPreference("pm por favor"), "pm");
  assert.equal(parseCallbackPreference("después de almuerzo"), "pm");
});

test("cierre usa exactamente Carolin y teléfono solicitado", () => {
  const reply = buildAfterHoursClosureReply();
  assert.match(reply, /Carolin/);
  assert.doesNotMatch(reply, /Carolina/);
  assert.match(reply, /\+56973763009/);
});

test("guarda preferencia después del cierre", () => {
  const s = state();
  const d = new Date("2026-09-07T01:00:00Z");
  registerAfterHoursInbound(s, d);
  markAfterHoursClosed(s, d);
  setCallbackPreference(s, "am");
  assert.equal(s.system.afterHours.callbackPreference, "am");
  assert.match(buildAfterHoursPreferenceReply("am"), /mañana en la mañana/);
});


test("cierre nocturno mantiene typo humano y contacto separado", () => {
  const reply = buildAfterHoursClosureReply();
  assert.match(reply, /escribem am o pm/);
  assert.match(reply, /Carolin\n\+56973763009\nsaludos/);
});
