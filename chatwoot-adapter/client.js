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
