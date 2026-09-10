// chatwoot-adapter/client.js
//
// Cliente OUTBOUND de Chatwoot Cloud (cuenta 162472) para que Antonia responda
// por Chatwoot en vez de Sunshine Conversations. Sin dependencias: fetch nativo
// (Node >= 18). Dry-run aware: con CHATWOOT_ADAPTER_DRY_RUN=true no hace HTTP,
// solo loguea — permite probar el flujo sin entregar mensajes reales.

const DEFAULT_BASE_URL = "https://app.chatwoot.com";
const DEFAULT_ACCOUNT_ID = "162472";

export function isChatwootAdapterEnabled() {
  return process.env.CHATWOOT_ADAPTER_ENABLED === "true";
}

function isDryRun() {
  return process.env.CHATWOOT_ADAPTER_DRY_RUN === "true";
}

function baseUrl() {
  return (process.env.CHATWOOT_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function accountId() {
  return process.env.CHATWOOT_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
}

function token() {
  const t = process.env.CHATWOOT_API_TOKEN;
  if (!t) throw new Error("chatwoot-adapter: falta CHATWOOT_API_TOKEN");
  return t;
}

// Quita el namespace "cw:" que el parser le pone al conversationId para no
// colisionar con los ids (UUID) de Sunshine Conversations.
export function stripConversationNamespace(conversationId) {
  return String(conversationId || "").replace(/^cw:/, "");
}

// Envía un mensaje de texto (outgoing) en una conversación existente de Chatwoot.
// Equivale al sendConversationReply de Sunco, pero contra la API de Chatwoot.
export async function sendChatwootReply({ conversationId, content }) {
  const realId = stripConversationNamespace(conversationId);
  if (!realId) throw new Error("sendChatwootReply: conversationId requerido");
  if (!content) throw new Error("sendChatwootReply: content requerido");

  if (isDryRun()) {
    console.log("[chatwoot-adapter/dry-run] sendChatwootReply", {
      conversationId: realId,
      content: String(content).slice(0, 120),
    });
    return { messageId: `dry_run_${Date.now()}`, dryRun: true };
  }

  const url = `${baseUrl()}/api/v1/accounts/${accountId()}/conversations/${realId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", api_access_token: token() },
    body: JSON.stringify({ content, message_type: "outgoing" }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Chatwoot send failed ${res.status}: ${text.slice(0, 300)}`);
  }
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { messageId: json?.id ?? null };
}


// Envía un archivo como mensaje outgoing usando multipart/form-data.
// Chatwoot espera el archivo bajo attachments[]. No fijar Content-Type manualmente:
// fetch/FormData agrega el boundary correcto.
export async function sendChatwootAttachment({
  conversationId,
  bytes,
  filename = "antonia.ogg",
  mimeType = "audio/ogg",
  content = "",
}) {
  const realId = stripConversationNamespace(conversationId);
  if (!realId) throw new Error("sendChatwootAttachment: conversationId requerido");
  if (!bytes) throw new Error("sendChatwootAttachment: bytes requeridos");

  if (isDryRun()) {
    console.log("[chatwoot-adapter/dry-run] sendChatwootAttachment", {
      conversationId: realId,
      filename,
      mimeType,
    });
    return { messageId: `dry_run_attachment_${Date.now()}`, dryRun: true };
  }

  const form = new FormData();
  form.append("content", String(content || ""));
  form.append("message_type", "outgoing");
  form.append("private", "false");
  form.append("attachments[]", new Blob([bytes], { type: mimeType }), filename);

  const url = `${baseUrl()}/api/v1/accounts/${accountId()}/conversations/${realId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { api_access_token: token() },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Chatwoot attachment send failed ${res.status}: ${text.slice(0, 300)}`);
  }
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { messageId: json?.id ?? null };
}

// Crea una nota privada: visible en Chatwoot para agentes, nunca enviada al contacto.
// No registrar su contenido en logs porque puede contener datos clínicos o personales.
export async function sendChatwootPrivateNote({ conversationId, content }) {
  const realId = stripConversationNamespace(conversationId);
  if (!realId) throw new Error("sendChatwootPrivateNote: conversationId requerido");
  if (!String(content || "").trim()) throw new Error("sendChatwootPrivateNote: content requerido");

  if (isDryRun()) {
    console.log("[chatwoot-adapter/dry-run] sendChatwootPrivateNote", {
      conversationId: realId,
      contentLength: String(content).length,
      private: true,
    });
    return { messageId: `dry_run_private_${Date.now()}`, dryRun: true };
  }

  const url = `${baseUrl()}/api/v1/accounts/${accountId()}/conversations/${realId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", api_access_token: token() },
    body: JSON.stringify({
      content: String(content).trim(),
      message_type: "outgoing",
      private: true,
      content_type: "text",
      content_attributes: { generated_by: "antonia", kind: "live_lead_card" },
    }),
    signal: AbortSignal.timeout(2500),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Chatwoot private note failed ${res.status}`);
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { messageId: json?.id ?? null };
}

// Chatwoot no expone edición de contenido de mensajes en la Application API.
// Para mantener una sola ficha viva creamos primero la nueva nota confirmada y
// eliminamos la anterior. Esta función sólo se usa con IDs guardados por Antonia.
export async function deleteChatwootMessage({ conversationId, messageId }) {
  const realId = stripConversationNamespace(conversationId);
  const realMessageId = String(messageId || "").trim();
  if (!realId || !/^\d+$/.test(realMessageId)) {
    // Los IDs dry-run no se eliminan por API.
    if (isDryRun() && realMessageId.startsWith("dry_run_")) return { deleted: true, dryRun: true };
    throw new Error("deleteChatwootMessage: ids inválidos");
  }

  if (isDryRun()) return { deleted: true, dryRun: true };
  const url = `${baseUrl()}/api/v1/accounts/${accountId()}/conversations/${realId}/messages/${realMessageId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { api_access_token: token() },
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`Chatwoot delete message failed ${res.status}`);
  return { deleted: true };
}
