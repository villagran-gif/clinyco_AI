import { normalizeKey } from "../utils/text.js";

export function isNoisySupportUser(user = {}) {
  const name = normalizeKey(user?.name || "");
  if (!name) return false;
  if (name.startsWith("SINGLE WHATSAPP NOTIFICATION")) return true;
  if (name.startsWith("PAGINA ") || name.startsWith("PAGINA:")) return true;
  if (name.startsWith("DR ") || name.startsWith("DRA ") || name.startsWith("DOCTOR ") || name.startsWith("DOCTORA ")) return true;
  return false;
}

export function isNoisyTicket(ticket = {}) {
  const subject = normalizeKey(ticket?.subject || "");
  if (!subject) return false;
  if (subject.startsWith("SENDING SINGLE WHATSAPP MESSAGE")) return true;
  return false;
}

export function cleanSupportPayload(payload = {}) {
  const users = Array.isArray(payload.users) ? payload.users.filter((u) => !isNoisySupportUser(u)) : [];
  const tickets = Array.isArray(payload.tickets) ? payload.tickets.filter((t) => !isNoisyTicket(t)) : [];
  return {
    ...payload,
    users,
    tickets,
    usersCount: users.length,
    ticketsCount: tickets.length,
    found: users.length > 0 || tickets.length > 0
  };
}

export function supportFieldLooksGeneric(value) {
  const key = normalizeKey(value);
  if (!key) return true;
  if (key.startsWith("CONVERSACION CON ")) return true;
  if (key.startsWith("CONVERSATION WITH ")) return true;
  if (key.startsWith("LLAMADA PERDIDA")) return true;
  return false;
}
