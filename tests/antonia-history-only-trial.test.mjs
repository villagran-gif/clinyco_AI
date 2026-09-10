import test from "node:test";
import assert from "node:assert/strict";
import { buildTrial, readCompleteHistory } from "../scripts/antonia-history-only-trial.mjs";

test("replay excludes notes and future turns, keeps consecutive messages and corrections", () => {
  const messages = [
    { id: 1, message_type: 0, content: "Peso 95" },
    { id: 2, message_type: 0, content: "Mido 1.73; llegué a 68 después de mi manga" },
    { id: 3, message_type: 1, private: true, content: "⚖️ Peso: 68 kg", content_attributes: { kind: "live_lead_card" } },
    { id: 4, message_type: 1, content: "📋 FICHA VIVA — ANTONIA\nPeso: 68" },
    { id: 5, message_type: 0, content: "Mi peso actual es 95" },
    { id: 6, message_type: 1, content: "tienes fonasa isapre o particular?" },
    { id: 7, message_type: 0, content: "Fonasa" },
  ];
  const trial = buildTrial(messages.reverse(), 5);
  assert.deepEqual(trial.messages.slice(1).map(m => m.content), [messages[6].content, messages[5].content, "Mi peso actual es 95"]);
  assert.equal(trial.observedNextReply, "tienes fonasa isapre o particular?");
  assert.throws(() => buildTrial(messages, 3), /public incoming/);
});

test("reads every page and fails rather than silently truncating on repeated pages", async () => {
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    assert.equal(url.hostname, "app.chatwoot.com");
    return { ok: true, json: async () => ({ payload: calls === 1 ? [{ id: 9 }] : calls === 2 ? [{ id: 1 }] : [] }) };
  };
  assert.equal((await readCompleteHistory({ token: "test", conversationId: "11175", fetchImpl })).length, 2);
  assert.equal(calls, 3);
  await assert.rejects(readCompleteHistory({ token: "test", conversationId: "11175", fetchImpl: async () => ({ ok: true, json: async () => ({ payload: [{ id: 9 }] }) }) }), /stalled/);
});
