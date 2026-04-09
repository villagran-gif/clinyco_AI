import * as db from "./db.js";
import { isAgentPhone } from "./agent-phones.js";
import { resolveLid } from "./lid-resolver.js";

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
 * @lid chats (they represent real clients).
 *
 * For phone-based chats we normalize straight to "+56..." and can match
 * directly against customers.whatsapp_phone.
 *
 * For LID chats we additionally keep the raw LID digits so the matcher
 * can feed them to the WAHA Lids API (GET /api/{session}/lids/{lid}) and
 * turn the LID into a real phone number.
 *
 * Returns:
 *   { kind: 'phone', value: '+56912345678' }            — for @c.us chats
 *   { kind: 'lid',   value: 'lid:123456789',
 *     lidDigits: '123456789' }                           — for @lid chats
 *   null                                                — for groups,
 *                                                         broadcasts, etc.
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
    return { kind: "lid", value: `lid:${digits}`, lidDigits: digits };
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
 * Matching strategy (LID chats):
 *   1. Ask WAHA's Lids API (GET /api/{session}/lids/{lid}) for the real
 *      phone number of the contact. If resolved, downgrade to a phone chat
 *      so the conversation_key collapses with any existing @c.us chat for
 *      the same client and we can look up customers.whatsapp_phone directly.
 *   2. If WAHA doesn't know the mapping (agent doesn't have the contact
 *      saved), fall back to parsing a Chilean RUT from pushName.
 *
 * Matching strategy (phone chats):
 *   • lookup customers.whatsapp_phone directly.
 *
 * The third argument is the contact pushName as reported by WAHA, used
 * only for the RUT fallback.
 *
 * Returns `null` when:
 *   • The chatId is not a valid @c.us / @lid 1:1 chat
 *   • The phone is not parseable
 *   • The chat is agent-to-agent (detected for phone-based chats only)
 */
export async function findOrCreateConversation(sessionName, chatId, { pushName } = {}) {
  let client = parseClientId(chatId);
  if (!client) {
    return null;
  }

  // If the chat is a LID, first try to resolve it to a real phone via
  // WAHA's Lids API. A successful resolve lets us unify this conversation
  // with any existing @c.us conversation for the same contact, and join
  // directly with customers.whatsapp_phone (same namespace as SunCo).
  if (client.kind === "lid") {
    const resolvedDigits = await resolveLid(sessionName, client.lidDigits);
    if (resolvedDigits) {
      const resolvedPhone = normalizePhone(resolvedDigits);
      if (resolvedPhone) {
        console.log(
          `[customer-matcher] LID ${client.value} resolved via WAHA Lids API → ${resolvedPhone}`
        );
        client = { kind: "phone", value: resolvedPhone };
      } else {
        console.warn(
          `[customer-matcher] LID ${client.value} resolved to ${resolvedDigits} but normalizePhone rejected it`
        );
      }
    }
  }

  // Agent-to-agent filter applies only to phone-based chats. Agents save
  // each other's numbers, so their chats stay @c.us; @lid only appears
  // when at least one side doesn't have the other saved. After the resolve
  // step above a former LID chat may also hit this filter.
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
    // WAHA didn't know the LID→phone mapping; fall back to RUT in pushName.
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
