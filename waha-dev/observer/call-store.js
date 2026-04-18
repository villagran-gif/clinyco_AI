import * as db from "./db.js";
import { findOrCreateConversation } from "./customer-matcher.js";

/**
 * Process a WAHA call webhook event.
 * Supported events: call.received, call.accepted, call.rejected.
 *
 * WAHA NOWEB engine emits all three. WEBJS only emits received/rejected.
 *
 * Payload fields (NOWEB):
 *   id          — call_id (stable across events)
 *   from        — chatId of the remote party (e.g. "56912345678@c.us")
 *   timestamp   — unix seconds
 *   isVideo     — boolean
 *   fromMe      — boolean (true = outbound, agent called client)
 */
export async function handleCallEvent(event, payload, sessionName) {
  const callId = payload.id || payload._data?.id;
  if (!callId) {
    console.warn(`[call-store] No call_id in ${event} payload`);
    return null;
  }

  const ts = payload.timestamp
    ? new Date(payload.timestamp * 1000)
    : new Date();

  if (event === "call.received") {
    const fromMe = payload.fromMe ?? false;
    const direction = fromMe ? "agent_to_client" : "client_to_agent";
    const clientChatId = fromMe
      ? (payload.to || payload.chatId)
      : (payload.from || payload.chatId);

    if (!clientChatId) {
      console.warn(`[call-store] No client chatId in call.received`);
      return null;
    }
    if (clientChatId.includes("@g.us")) {
      console.log(`[call-store] Skipping group call ${callId}`);
      return null;
    }

    const conversation = await findOrCreateConversation(sessionName, clientChatId).catch(() => null);

    return db.upsertCallReceived({
      callId,
      conversationId: conversation?.id || null,
      sessionName,
      clientPhone: conversation?.client_phone || clientChatId.replace(/@.*$/, ""),
      direction,
      isVideo: !!payload.isVideo,
      receivedAt: ts,
      hourOfDay: ts.getHours(),
      dayOfWeek: ts.getDay(),
      rawJson: payload,
    });
  }

  if (event === "call.accepted") {
    return db.updateCallAccepted(callId, ts);
  }

  if (event === "call.rejected") {
    // byClient = rejection came from the remote (non-agent) side
    const byClient = !(payload.fromMe ?? false);
    return db.updateCallRejected(callId, ts, byClient);
  }

  if (event === "call.ended" || event === "call.end") {
    return db.updateCallEnded(callId, ts);
  }

  return null;
}
