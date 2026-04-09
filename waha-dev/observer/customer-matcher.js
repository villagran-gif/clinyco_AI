import * as db from "./db.js";
import { isAgentPhone } from "./agent-phones.js";

/**
 * Normalize a raw phone / chatId prefix.
 *
 * Strict validation to reject:
 *   • WhatsApp LID addresses disguised as phones (>13 digits)
 *   • Malformed Chilean numbers (56 not followed by the mobile 9 prefix
 *     and wrong length)
 *   • Anything shorter than 9 digits
 *
 * Chilean mobile format: +569XXXXXXXX (11 digits total including country
 * code). International E.164 max is 15 digits, but real-world phones rarely
 * exceed 13. Anything over 13 digits in WAHA chatIds is almost always a
 * WhatsApp LID address, not a real phone number.
 */
function normalizePhone(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  // Chilean mobile with country code: 569 + 8 digits = 11 digits
  if (digits.startsWith("569") && digits.length === 11) return `+${digits}`;

  // Chilean mobile without country code: 9 + 8 digits = 9 digits
  if (digits.startsWith("9") && digits.length === 9) return `+56${digits}`;

  // International E.164: between 10 and 13 digits.
  // We reject anything outside this window — longer values in WAHA chatIds
  // are WhatsApp LID addresses, not real phone numbers.
  if (digits.length >= 10 && digits.length <= 13) return `+${digits}`;

  return null;
}

/**
 * Extract the client phone from a WAHA chatId.
 * Only accepts @c.us chatIds (1:1 private chats). Everything else
 * (@g.us groups, @lid, @broadcast, @newsletter, etc.) is rejected.
 */
function extractPhoneFromChatId(chatId) {
  if (!chatId) return null;
  if (!chatId.endsWith("@c.us")) return null;
  const raw = chatId.split("@")[0];
  return normalizePhone(raw);
}

/**
 * Find or create an agent_direct_conversation for a session + client chatId.
 * Auto-matches the client to an existing customer if possible.
 *
 * Returns `null` (silently skipping the message) when:
 *   • The chatId is not a valid @c.us 1:1 chat
 *   • The phone is not parseable (likely a LID address)
 *   • The "client" phone is actually one of our own agents (agent-to-agent)
 */
export async function findOrCreateConversation(sessionName, chatId) {
  const clientPhone = extractPhoneFromChatId(chatId);
  if (!clientPhone) {
    return null;
  }

  // Skip agent-to-agent conversations (one agent messaging another agent's
  // corporate phone shows up as a "client chat" otherwise).
  if (isAgentPhone(clientPhone)) {
    console.log(
      `[customer-matcher] Skipping agent-to-agent chat: ${sessionName} ↔ ${clientPhone}`
    );
    return null;
  }

  const conversationKey = `${sessionName}:${clientPhone}`;

  const existing = await db.findConversation(conversationKey);
  if (existing) return existing;

  // Auto-match: look up customer by phone
  let customerId = null;
  let matchStatus = "unmatched";

  const customer = await db.findCustomerByPhone(clientPhone);
  if (customer) {
    customerId = customer.id;
    matchStatus = "matched";
    console.log(
      `[customer-matcher] Matched ${clientPhone} → customer #${customer.id} (${customer.nombres} ${customer.apellidos})`
    );
  } else {
    console.log(`[customer-matcher] No customer match for ${clientPhone}`);
  }

  const conversation = await db.createConversation({
    conversationKey,
    sessionName,
    clientPhone,
    customerId,
    matchStatus,
  });

  console.log(
    `[customer-matcher] Created conversation #${conversation.id} key=${conversationKey} match=${matchStatus}`
  );

  return conversation;
}

export { normalizePhone, extractPhoneFromChatId };
