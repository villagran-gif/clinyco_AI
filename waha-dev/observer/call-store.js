import * as db from "./db.js";
import { findOrCreateConversation } from "./customer-matcher.js";

// Extract the real phone number (not the LID). GOWS puts the phone in
// _data.Data.Attrs.caller_pn / callee_pn or in _data.CallCreatorAlt.
// `from` is often a LID (e.g. "233028500611313@lid") which is not usable.
function extractPhoneJid(payload, role) {
  const attrs = payload?._data?.Data?.Attrs || {};
  const pnKey = role === "caller" ? "caller_pn" : "callee_pn";
  const pn = attrs[pnKey];
  if (pn && pn.includes("@s.whatsapp.net")) return pn;

  const alt = payload?._data?.CallCreatorAlt;
  if (role === "caller" && alt && alt.includes("@s.whatsapp.net")) return alt;

  // fall back to the LID-format `from` — still better than nothing
  return role === "caller" ? payload?.from : payload?.to;
}

/**
 * Process a WAHA call webhook event.
 * Supported events: call.received, call.accepted, call.rejected.
 *
 * WAHA GOWS emits all three. WEBJS only emits received/rejected.
 * Note: GOWS only fires on INBOUND calls — outbound calls dialed
 * from the phone app bypass the companion device entirely.
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
      ? extractPhoneJid(payload, "callee")
      : extractPhoneJid(payload, "caller");

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
