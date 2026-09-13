import test from "node:test";
import assert from "node:assert/strict";
import { buildPrivateLeadNote, buildPrivateLeadSnapshot, maybeSyncPrivateLeadNote } from "../chatwoot-adapter/private-lead-note.js";
import { chatwootSkipReason, parseChatwootInbound } from "../chatwoot-adapter/parse.js";

process.env.CHATWOOT_ADAPTER_DRY_RUN = "true";

function state(overrides = {}) {
  return {
    contactDraft: { c_nombres: "Lorena", c_apellidos: "Ríos Echiburú", c_aseguradora: "FONASA", c_modalidad: "Tramo D", c_comuna: "SANTIAGO" },
    dealDraft: { dealInteres: "Conversión de manga a bypass", dealPeso: "84", dealEstatura: "165" },
    measurements: { weightKg: 84, heightM: 1.65, heightCm: 165, bmi: 30.9 },
    preevaluation: { awaiting: "age", answers: { prior_surgery: "manga", prior_year: 2013, revision_reason: "reganancia de peso", studies: "endoscopia hace dos años" } },
    identity: { sourceProfileName: "#Lorena Ríos Echiburú 💃🏼" },
    system: {},
    ...overrides,
  };
}

test("construye una ficha consolidada con datos bariátricos útiles", () => {
  const built = buildPrivateLeadNote(state());
  assert.ok(built);
  assert.match(built.content, /FICHA VIVA — ANTONIA/);
  assert.match(built.content, /Lorena Ríos Echiburú/);
  assert.match(built.content, /84 kg/);
  assert.match(built.content, /1,65 m/);
  assert.match(built.content, /Manga gástrica/);
  assert.match(built.content, /2013/);
  assert.doesNotMatch(built.content, /NO VOLVER A PREGUNTAR|Actualizada automáticamente|Confirmar correcciones/);
  assert.ok(built.snapshot.meaningfulKeys.includes('weight'));
  assert.equal(built.content.split('\n').filter(line => line.includes('Peso:')).length, 1);
});

test("no acepta como nombre una frase capturada por error", () => {
  const s = state({
    contactDraft: { c_nombres: "Lorena Quiero", c_apellidos: "Consultar" },
    identity: { sourceProfileName: "#Lorena Ríos Echiburú 💃🏼" },
  });
  const snapshot = buildPrivateLeadSnapshot(s);
  assert.equal(snapshot.data.name, null);
  assert.equal(snapshot.data.profile_name, "Lorena Ríos Echiburú");
});

test("no crea ficha sin ningún dato útil", () => {
  assert.equal(buildPrivateLeadNote({ contactDraft: {}, dealDraft: {}, measurements: {}, preevaluation: { answers: {} }, identity: {}, system: {} }), null);
});

test("sincroniza una vez y deduplica mientras los datos no cambian", async () => {
  const s = state();
  const first = await maybeSyncPrivateLeadNote({ conversationId: "cw:999001", channel: "Channel::Whatsapp", state: s });
  assert.equal(first.synced, true);
  assert.ok(s.system.privateLeadNoteFingerprint);
  assert.ok(s.system.privateLeadNoteMessageId);
  const second = await maybeSyncPrivateLeadNote({ conversationId: "cw:999001", channel: "Channel::Whatsapp", state: s });
  assert.equal(second.skipped, "unchanged");
});

test("un dato corregido genera una nueva ficha consolidada", async () => {
  const s = state();
  await maybeSyncPrivateLeadNote({ conversationId: "cw:999002", channel: "Channel::Whatsapp", state: s });
  const before = s.system.privateLeadNoteFingerprint;
  s.measurements.weightKg = 80;
  s.dealDraft.dealPeso = "80";
  const result = await maybeSyncPrivateLeadNote({ conversationId: "cw:999002", channel: "Channel::Whatsapp", state: s });
  assert.equal(result.synced, true);
  assert.notEqual(s.system.privateLeadNoteFingerprint, before);
});

test("una nota privada de Antonia se ignora antes de takeover o IA", () => {
  const payload = {
    id: 777,
    event: "message_created",
    private: true,
    message_type: "outgoing",
    content: "📋 FICHA VIVA — ANTONIA",
    sender: { type: "user", name: "Antonia" },
    account: { id: 162472 },
    conversation: { id: 11142, channel: "Channel::Whatsapp", messages: [] },
  };
  assert.equal(chatwootSkipReason(payload), "private_note");
  const parsed = parseChatwootInbound(payload);
  assert.equal(parsed.eventType, "conversation:ignored");
});
