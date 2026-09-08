// chatwoot-adapter/parse.js
//
// Normaliza webhooks message_created de Chatwoot para el core de AntonIA.
// Además de texto, conserva adjuntos visuales y el referral de anuncios Meta.
// El referral es CONTEXTO DE ORIGEN: nunca debe tratarse como un dato declarado
// por el paciente (por ejemplo, no inferir su previsión desde el texto del anuncio).

export function isChatwootPayload(payload) {
  return (
    !!payload &&
    typeof payload.event === "string" &&
    payload.event === "message_created" &&
    !Array.isArray(payload.events)
  );
}


/** Ignore transport/service events before state changes, history or AI calls. */
export function chatwootSkipReason(payload) {
  const conv = payload?.conversation || {};
  const current = (Array.isArray(conv.messages) ? conv.messages : [])
    .find(m => payload?.id != null && String(m.id) === String(payload.id)) || {};
  const message = { ...current, ...payload };
  const truthy = v => v === true || v === 1 || v === "true";
  if (truthy(message.private)) return "private_note";
  if (message.message_type === "activity" || message.message_type === 2) return "activity";
  const inboxId = payload?.inbox?.id ?? conv.inbox_id;
  const accountId = payload?.account?.id ?? process.env.CHATWOOT_ACCOUNT_ID;
  // Verified Clinyco Voice inbox. Other accounts are not affected by this ID.
  if (String(accountId) === "162472" && String(inboxId) === "114783") return "voice_inbox";
  const channel = String(conv.channel || payload?.inbox?.channel_type || "").toLowerCase();
  const inboxName = String(payload?.inbox?.name || "").trim();
  if (channel === "channel::voice" || /^voice(?:\s|\(|$)/i.test(inboxName)) return "voice_channel";
  const contentType = String(message.content_type || "").toLowerCase();
  if (["call", "voice_call", "call_transcription"].includes(contentType)) return "call_event";
  const attrs = message.content_attributes || {};
  if (attrs.call_id != null || attrs.call != null) return "call_event";
  const senderType = String(payload?.sender?.type || conv.meta?.sender?.type || payload?.sender_type || "").toLowerCase();
  if (["agentbot", "agent_bot", "bot"].includes(senderType)) return "bot_message";
  const content = String(message.content || "").trim();
  // Narrow legacy fallbacks: do not match a patient's normal sentence about a call.
  if (/^(?:missed call|call ended|incoming call|outgoing call|llamada perdida|llamada finalizada)[.!]?$/i.test(content))
    return "call_status";
  if (/^(?:🤖\s*)?transcripci[oó]n de la llamada\b/i.test(content)) return "call_transcription";
  return null;
}

export function parseChatwootInbound(payload) {
  const skipReason = chatwootSkipReason(payload);
  const conv = payload?.conversation || {};
  const sender = payload?.sender || conv.meta?.sender || {};
  const messageType = payload?.message_type || null;

  const authorType = messageType === "incoming" ? "user" : "business";
  const senderType = String(sender?.type || payload?.sender_type || "").toLowerCase();
  const isHumanAgent = messageType === "outgoing" && senderType === "user";
  const businessText = String(payload?.content ?? "").trim();

  const referralContext = extractReferralContext(payload);
  const attachments = collectAttachments(payload, conv);
  const attachmentImageUrls = attachments
    .filter(isImageAttachment)
    .map(attachmentUrl)
    .filter(Boolean);
  const referralImageUrl =
    referralContext?.mediaType === "image" ? httpUrlOrNull(referralContext.imageUrl) : null;
  const imageUrls = uniqueUrls([
    ...attachmentImageUrls,
    referralImageUrl,
  ]).slice(0, 3);

  const hasUserImageAttachment = messageType === "incoming" && attachmentImageUrls.length > 0;
  const hasVisualInput = messageType === "incoming" && imageUrls.length > 0;

  let userText = messageType === "incoming" ? String(payload?.content ?? "").trim() : "";
  if (!userText && hasUserImageAttachment) {
    userText = "Te envío una imagen.";
  }

  const phone = strOrNull(sender.phone_number);
  const name = strOrNull(sender.name);

  return {
    appId: String(payload?.account?.id ?? process.env.CHATWOOT_ACCOUNT_ID ?? "162472"),
    conversationId: conv.id != null ? `cw:${conv.id}` : null,
    userText,
    eventType: skipReason ? "conversation:ignored" : "conversation:message",
    skipReason,
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
    attachments,
    imageUrls,
    hasUserImageAttachment,
    hasVisualInput,
    referralContext,
    rawMessage: payload,
    rawConversation: conv,
    rawSource: sender,
  };
}

function extractReferralContext(payload) {
  const referral = payload?.content_attributes?.referral;
  if (!referral || typeof referral !== "object" || Array.isArray(referral)) return null;

  const result = {
    headline: strOrNull(referral.headline),
    body: strOrNull(referral.body),
    sourceType: strOrNull(referral.source_type),
    sourceId: strOrNull(referral.source_id),
    sourceUrl: strOrNull(referral.source_url),
    mediaType: strOrNull(referral.media_type)?.toLowerCase() || null,
    imageUrl: httpUrlOrNull(referral.image_url),
  };

  return Object.values(result).some(Boolean) ? result : null;
}

function collectAttachments(payload, conv) {
  const currentId = payload?.id != null ? String(payload.id) : null;
  const conversationMessages = Array.isArray(conv?.messages) ? conv.messages : [];
  const matchingMessage = currentId
    ? conversationMessages.find((m) => String(m?.id ?? "") === currentId)
    : null;

  const candidates = [
    ...(Array.isArray(payload?.attachments) ? payload.attachments : []),
    ...(Array.isArray(matchingMessage?.attachments) ? matchingMessage.attachments : []),
  ];

  const seen = new Set();
  return candidates.filter((attachment) => {
    if (!attachment || typeof attachment !== "object") return false;
    const key = attachmentUrl(attachment) || String(attachment.id || JSON.stringify(attachment));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attachmentUrl(attachment) {
  return httpUrlOrNull(
    attachment?.data_url ||
    attachment?.file_url ||
    attachment?.url ||
    attachment?.thumb_url
  );
}

function isImageAttachment(attachment) {
  const url = attachmentUrl(attachment) || "";
  const marker = [
    attachment?.file_type,
    attachment?.content_type,
    attachment?.mime_type,
    attachment?.extension,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    marker.includes("image") ||
    /\b(png|jpe?g|webp|gif|bmp)\b/i.test(marker) ||
    /\.(png|jpe?g|webp|gif|bmp)(?:\?|$)/i.test(url)
  );
}

function uniqueUrls(values) {
  return [...new Set(values.map(httpUrlOrNull).filter(Boolean))];
}

function httpUrlOrNull(value) {
  const s = strOrNull(value);
  if (!s || !/^https?:\/\//i.test(s)) return null;
  return s;
}

function strOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}
