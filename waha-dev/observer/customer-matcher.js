import * as db from "./db.js";
import { isAgentPhone } from "./agent-phones.js";

// ============================================================================
// Phone normalization (@c.us chats)
// ============================================================================

/**
 * Normalize a raw phone / chatId prefix for @c.us chats.
 *
 * Strict validation to reject:
 *   • WhatsApp LID addresses disguised as phones (>13 digits)
 *   • Malformed Chilean numbers
 *   • Anything shorter than 9 digits
 *
 * Chilean mobile format: +569XXXXXXXX (11 digits total including country
 * code). International E.164 max is 15 digits, but real-world phones rarely
 * exceed 13.
 */
function normalizePhone(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("569") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("9") && digits.length === 9) return `+56${digits}`;
  if (digits.length >= 10 && digits.length <= 13) return `+${digits}`;

  return null;
}

// ============================================================================
// Chilean RUT parser (mirrors extraction/identity-normalizers.js)
// ============================================================================

function computeRutVerifierDigit(bodyDigits) {
  const digits = String(bodyDigits || "").replace(/\D/g, "");
  if (!digits) return null;

  let factor = 2;
  let total = 0;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    total += Number(digits[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const remainder = 11 - (total % 11);
  if (remainder === 11) return "0";
  if (remainder === 10) return "K";
  return String(remainder);
}

function validateRut(value) {
  const raw = String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (raw.length < 8 || raw.length > 9) return false;

  const body = raw.slice(0, -1);
  const dv = raw.slice(-1);
  if (!/^\d{7,8}$/.test(body)) return false;

  return computeRutVerifierDigit(body) === dv;
}

function normalizeRut(value) {
  const raw = String(value || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (!validateRut(raw)) return null;
  return `${raw.slice(0, -1)}-${raw.slice(-1)}`;
}

/**
 * Extract and validate a Chilean RUT from free text such as a WhatsApp
 * contact pushName "gabriela 26.507.289-5".
 *
 * Returns the canonical "XXXXXXXX-X" form (uppercase DV, no dots) that
 * matches how `customers.rut` is stored, or null if no valid RUT is found.
 */
export function extractRut(text) {
  const source = String(text || "").toUpperCase();
  const matches = source.match(/\b\d{1,2}[.]?\d{3}[.]?\d{3}[-\s.]?[\dK]\b/g) || [];
  for (const candidate of matches) {
    const normalized = normalizeRut(candidate);
    if (normalized) return normalized;
  }
  return null;
}

// ============================================================================
// Client identifier parsing (@c.us + @lid)
// ============================================================================

/**
 * Parse a WAHA chatId into a stable client identifier.
 *
 * WhatsApp now assigns many contacts a @lid (Local ID) instead of @c.us
 * for privacy reasons. Both are legitimate 1:1 chats — we must NOT drop
 * @lid chats (they represent real clients). Instead we namespace them.
 *
 * Returns:
 *   { kind: 'phone', value: '+56912345678' }  — for a valid @c.us chat
 *   { kind: 'lid',   value: 'lid:123456789' } — for a @lid chat
 *   null                                       — for groups, broadcasts,
 *                                                 malformed ids, etc.
 */
export function parseClientId(chatId) {
  if (!chatId) return null;

  if (chatId.endsWith("@c.us")) {
    const raw = chatId.split("@")[0];
    const phone = normalizePhone(raw);
    if (!phone) return null;
    return { kind: "phone", value: phone };
  }

  if (chatId.endsWith("@lid")) {
    // LID format: "123456789@lid" or "123456789:12@lid" (device suffix)
    const raw = chatId.split("@")[0].split(":")[0];
    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;
    return { kind: "lid", value: `lid:${digits}` };
  }

  return null;
}

// Back-compat helper kept because other modules still import it.
function extractPhoneFromChatId(chatId) {
  const parsed = parseClientId(chatId);
  return parsed?.kind === "phone" ? parsed.value : null;
}

// ============================================================================
// Conversation resolution
// ============================================================================

/**
 * Find or create an agent_direct_conversation for a session + client chatId.
 *
 * Accepts both @c.us (phone) and @lid (WhatsApp privacy ID) chats.
 *
 * Matching strategy:
 *   • @c.us → lookup customers.whatsapp_phone
 *   • @lid  → parse Chilean RUT from pushName (e.g. "alexis 15.430.738-9"),
 *             lookup customers.rut
 *
 * The third argument is the contact pushName as reported by WAHA, used
 * only for RUT extraction on LID chats.
 *
 * Returns `null` when:
 *   • The chatId is not a valid @c.us / @lid 1:1 chat
 *   • The phone is not parseable
 *   • The chat is agent-to-agent (detected for phone-based chats only)
 */
export async function findOrCreateConversation(sessionName, chatId, { pushName } = {}) {
  const client = parseClientId(chatId);
  if (!client) {
    return null;
  }

  // Agent-to-agent filter applies only to phone-based chats. Agents save
  // each other's numbers, so their chats stay @c.us; @lid only appears
  // when at least one side doesn't have the other saved.
  if (client.kind === "phone" && isAgentPhone(client.value)) {
    console.log(
      `[customer-matcher] Skipping agent-to-agent chat: ${sessionName} ↔ ${client.value}`
    );
    return null;
  }

  const conversationKey = `${sessionName}:${client.value}`;

  const existing = await db.findConversation(conversationKey);
  if (existing) return existing;

  // Auto-match
  let customerId = null;
  let matchStatus = "unmatched";
  let customer = null;

  if (client.kind === "phone") {
    customer = await db.findCustomerByPhone(client.value);
  } else if (client.kind === "lid") {
    // LIDs have no phone; parse RUT from pushName instead.
    const rut = extractRut(pushName);
    if (rut) {
      customer = await db.findCustomerByRut(rut);
      if (customer) {
        console.log(
          `[customer-matcher] LID ${client.value} matched by RUT ${rut} (pushName="${pushName}")`
        );
      }
    }
  }

  if (customer) {
    customerId = customer.id;
    matchStatus = "matched";
    console.log(
      `[customer-matcher] Matched ${client.value} → customer #${customer.id} (${customer.nombres} ${customer.apellidos})`
    );
  } else {
    console.log(
      `[customer-matcher] No customer match for ${client.value} (pushName="${pushName || ""}")`
    );
  }

  const conversation = await db.createConversation({
    conversationKey,
    sessionName,
    clientPhone: client.value, // "+569..." or "lid:..."
    customerId,
    matchStatus,
  });

  console.log(
    `[customer-matcher] Created conversation #${conversation.id} key=${conversationKey} match=${matchStatus}`
  );

  return conversation;
}

export { normalizePhone, extractPhoneFromChatId };
