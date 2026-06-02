import { test } from "node:test";
import assert from "node:assert/strict";
import { isChatwootPayload, parseChatwootInbound } from "../chatwoot-adapter/parse.js";
import { stripConversationNamespace } from "../chatwoot-adapter/client.js";

const incoming = {
  event: "message_created",
  message_type: "incoming",
  id: 9001,
  content: "Hola, quiero agendar",
  account: { id: 162472 },
  sender: { id: 55, name: "Juana Pérez", phone_number: "+56912345678" },
  conversation: { id: 1038, channel: "Channel::Whatsapp", inbox_id: 107690 },
  inbox: { id: 107690, name: "WhatsApp Soporte" },
};

test("isChatwootPayload detecta message_created y descarta Sunco", () => {
  assert.equal(isChatwootPayload(incoming), true);
  assert.equal(isChatwootPayload({ events: [{}], app: { id: "x" } }), false); // Sunco
  assert.equal(isChatwootPayload({ event: "conversation_updated" }), false);
  assert.equal(isChatwootPayload(null), false);
});

test("parseChatwootInbound normaliza un incoming al shape de Antonia", () => {
  const info = parseChatwootInbound(incoming);
  assert.equal(info.eventType, "conversation:message");
  assert.equal(info.authorType, "user");
  assert.equal(info.conversationId, "cw:1038");
  assert.equal(info.userText, "Hola, quiero agendar");
  assert.equal(info.transport, "chatwoot");
  assert.equal(info.channelDisplayName, "+56912345678");
  assert.equal(info.sourceProfileName, "Juana Pérez");
  assert.equal(info.appId, "162472");
  assert.equal(info.messageId, "9001");
});

test("outgoing (agente/bot) → authorType business y sin userText", () => {
  const info = parseChatwootInbound({ ...incoming, message_type: "outgoing", content: "respuesta" });
  assert.equal(info.authorType, "business");
  assert.equal(info.userText, "");
});

test("cae a conversation.meta.sender si no hay sender top-level", () => {
  const info = parseChatwootInbound({
    event: "message_created",
    message_type: "incoming",
    content: "x",
    conversation: { id: 7, meta: { sender: { phone_number: "+569" } } },
  });
  assert.equal(info.channelDisplayName, "+569");
  assert.equal(info.conversationId, "cw:7");
});

test("stripConversationNamespace quita el prefijo cw:", () => {
  assert.equal(stripConversationNamespace("cw:1038"), "1038");
  assert.equal(stripConversationNamespace("1038"), "1038");
});
