import * as db from "./db.js";

/**
 * Normalize phone: remove @c.us/@s.whatsapp.net suffixes,
 * keep only digits, add +56 prefix for Chilean numbers.
 * Copied from extraction/identity-normalizers.js
 */
function normalizePhone(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("56") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("9") && digits.length === 9) return `+56${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return value.startsWith("+") ? value : `+${digits}`;
  return null;
}

/**
 * Detect WhatsApp LID (Local Identifier) — an internal opaque ID
 * that replaced phone numbers in some webhook payloads.
 * LIDs: 15-digit numbers not starting with valid country codes.
 */
function isLid(chatId) {
  if (!chatId) return false;
  if (chatId.includes("@lid")) return true;
  const digits = chatId.replace(/\D/g, "");
  return digits.length === 15 && !digits.startsWith("56");
}

/**
 * Extract the client phone from a WAHA chatId.
 * chatId format: "56912345678@c.us" or "56912345678@s.whatsapp.net"
 * Returns null for LID-format chatIds to prevent DB pollution.
 */
function extractPhoneFromChatId(chatId) {
  if (!chatId) return null;
  if (isLid(chatId)) {
    console.warn(`[customer-matcher] Detected LID chatId, skipping: ${chatId}`);
    return null;
  }
  const raw = chatId.split("@")[0];
  return normalizePhone(raw);
}

/**
 * Find or create an agent_direct_conversation for a session + client phone.
 * Auto-matches the client to an existing customer if possible.
 */
export async function findOrCreateConversation(sessionName, chatId) {
  const clientPhone = extractPhoneFromChatId(chatId);
  if (!clientPhone) {
    console.warn("[customer-matcher] Could not extract phone from chatId:", chatId);
    return null;
  }

  const conversationKey = `${sessionName}:${clientPhone}`;

  // Check if conversation already exists
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

  // Create new conversation
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

export { normalizePhone, extractPhoneFromChatId, isLid };
