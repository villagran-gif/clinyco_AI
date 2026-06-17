// chatwoot-adapter/parse.js
//
// Convierte un webhook `message_created` de Chatwoot Cloud al MISMO objeto
// `info` que produce extractConversationInfo() para Sunshine Conversations, de
// modo que el "cerebro" de Antonia (la ruta /messages) corra sin cambios.
// Pure: sin DB ni env (salvo el fallback de account id). Testeable.
//
// Decisiones de normalización:
// - conversationId se prefija con "cw:" para no colisionar con los ids (UUID)
//   de Sunco en el store de conversaciones. El cliente outbound lo quita.
// - eventType se fija a "conversation:message" (lo que chequea la ruta).
// - message_type incoming -> authorType "user" (paciente, lo procesa Antonia);
//   outgoing -> "business". Si el outgoing es de un agente HUMANO (sender.type
//   "user") marcamos isHumanAgent=true → la ruta hace takeover; si es del bot
//   (agent_bot), isHumanAgent=false → la ruta lo ignora como echo.

export function isChatwootPayload(payload) {
  return (
    !!payload &&
    typeof payload.event === "string" &&
    payload.event === "message_created" &&
    !Array.isArray(payload.events) // Sunco usa `events: [...]`
  );
}

export function parseChatwootInbound(payload) {
  const conv = payload?.conversation || {};
  const sender = payload?.sender || conv.meta?.sender || {};
  const messageType = payload?.message_type || null;

  const authorType = messageType === "incoming" ? "user" : "business";
  // Solo el texto del paciente alimenta a Antonia; los outgoing no aportan userText.
  const userText = messageType === "incoming" ? String(payload?.content ?? "").trim() : "";

  // Tipo de remitente en Chatwoot: "contact" = paciente, "user" = agente humano,
  // "agent_bot" = bot. Un outgoing de un agente HUMANO debe pausar a Antonia
  // (takeover); el echo del propio bot no. Requiere que Antonia envíe vía un
  // AgentBot de Chatwoot (sender.type "agent_bot") — ver README.
  const senderType = String(sender?.type || payload?.sender_type || "").toLowerCase();
  const isHumanAgent = messageType === "outgoing" && senderType === "user";
  // Texto del mensaje sin importar dirección (para que EugenIA observe al agente).
  const businessText = String(payload?.content ?? "").trim();

  const phone = strOrNull(sender.phone_number);
  const name = strOrNull(sender.name);

  return {
    appId: String(payload?.account?.id ?? process.env.CHATWOOT_ACCOUNT_ID ?? "162472"),
    conversationId: conv.id != null ? `cw:${conv.id}` : null,
    userText,
    eventType: "conversation:message",
    authorType,
    senderType,
    isHumanAgent,
    businessText,
    messageId: payload?.id != null ? String(payload.id) : null,
    sourceType: strOrNull(conv.channel || payload?.inbox?.name) || "chatwoot",
    channelDisplayName: phone || name,
    channelExternalId: phone,
    authorDisplayName: name,
    sourceProfileName: name,
    entryPoint: strOrNull(payload?.inbox?.name),
    transport: "chatwoot",
    rawMessage: payload,
    rawConversation: conv,
    rawSource: sender,
  };
}

function strOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}
