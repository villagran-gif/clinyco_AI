import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFromAntofagasta,
  isAttendedInSantiago,
  isWithinShift,
  evaluateLead
} from "../lead-alerts/eligibility.js";
import {
  chatwootConversationUrl,
  buildMariaPazAlert,
  buildSummary
} from "../lead-alerts/messages.js";
import { toChatId } from "../lead-alerts/waha-client.js";

// Referencias de tiempo (Chile = UTC-4 en junio):
const inShift = new Date("2026-06-05T01:00:00Z");  // jue 2026-06-04 21:00 CLT
const outShift = new Date("2026-06-04T18:00:00Z");  // jue 2026-06-04 14:00 CLT

test("isFromAntofagasta / isAttendedInSantiago normalizan acentos y mayúsculas", () => {
  assert.equal(isFromAntofagasta("Antofagasta"), true);
  assert.equal(isFromAntofagasta("ANTOFAGASTA centro"), true);
  assert.equal(isFromAntofagasta("Santiago"), false);
  assert.equal(isAttendedInSantiago("santiago"), true);
  assert.equal(isAttendedInSantiago("Providencia, Santiago"), true);
  assert.equal(isAttendedInSantiago("Concepción"), false);
});

test("isWithinShift respeta hora de inicio y días", () => {
  assert.equal(isWithinShift(inShift, { startHour: 17 }), true);
  assert.equal(isWithinShift(outShift, { startHour: 17 }), false);
  // jueves => weekday 4
  assert.equal(isWithinShift(inShift, { startHour: 17, weekdays: [4] }), true);
  assert.equal(isWithinShift(inShift, { startHour: 17, weekdays: [1] }), false);
});

test("evaluateLead: caso feliz es elegible", () => {
  const r = evaluateLead(
    { handoffConfirmed: true, alreadyNotified: false, ciudad: "Viña del Mar", ciudadAtencion: "Santiago" },
    { now: inShift, shift: { startHour: 17 } }
  );
  assert.equal(r.eligible, true);
  assert.deepEqual(r.reasons, []);
});

test("evaluateLead: Antofagasta se filtra", () => {
  const r = evaluateLead(
    { handoffConfirmed: true, ciudad: "Antofagasta", ciudadAtencion: "Santiago" },
    { now: inShift, shift: { startHour: 17 } }
  );
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("es_antofagasta"));
});

test("evaluateLead: filtro duro — datos desconocidos no son elegibles", () => {
  const r = evaluateLead(
    { handoffConfirmed: true, ciudad: null, ciudadAtencion: null },
    { now: inShift, shift: { startHour: 17 } }
  );
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("residencia_desconocida"));
  assert.ok(r.reasons.includes("ciudad_atencion_desconocida"));
});

test("evaluateLead: fuera de turno no es elegible", () => {
  const r = evaluateLead(
    { handoffConfirmed: true, ciudad: "Maipú", ciudadAtencion: "Santiago" },
    { now: outShift, shift: { startHour: 17 } }
  );
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("fuera_de_turno"));
});

test("chatwootConversationUrl sólo para conversaciones cw:", () => {
  assert.equal(
    chatwootConversationUrl("cw:1219", { accountId: "162472" }),
    "https://app.chatwoot.com/app/accounts/162472/conversations/1219"
  );
  assert.equal(chatwootConversationUrl("66b4fb1c5d86820fafb79f66"), null);
});

test("toChatId normaliza E.164 a <digitos>@c.us", () => {
  assert.equal(toChatId("+56944547790"), "56944547790@c.us");
  assert.equal(toChatId("56944547790"), "56944547790@c.us");
  assert.equal(toChatId(""), null);
});

test("buildMariaPazAlert incluye nombre, resumen y link", () => {
  const lead = {
    nombre: "Ana Belén",
    procedimiento: "Balón gástrico",
    prevision: "FONASA",
    modalidad: "Tramo C",
    imc: 31.6,
    telefono: "+56998512166",
    score: 60,
    scoreCategory: "tibio"
  };
  const txt = buildMariaPazAlert(lead, {
    url: "https://app.chatwoot.com/app/accounts/162472/conversations/1219"
  });
  assert.ok(txt.includes("Ana Belén"));
  assert.ok(txt.includes("Balón gástrico"));
  assert.ok(txt.includes("conversations/1219"));
  assert.ok(buildSummary(lead).includes("FONASA Tramo C"));
});
