const DEFAULT_TIMEZONE = "America/Santiago";
const DEFAULT_START_HOUR = 21;
const DEFAULT_END_HOUR = 8;
const DEFAULT_MAX_INBOUND_TURNS = 5;
const CONTACT_NAME = "Carolin";
const CONTACT_PHONE = "+56973763009";

function localParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
  };
}

function previousCalendarDate({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function isChileAfterHours(date = new Date(), {
  timeZone = DEFAULT_TIMEZONE,
  startHour = DEFAULT_START_HOUR,
  endHour = DEFAULT_END_HOUR,
} = {}) {
  const { hour } = localParts(date, timeZone);
  return hour >= startHour || hour < endHour;
}

export function getAfterHoursShiftKey(date = new Date(), {
  timeZone = DEFAULT_TIMEZONE,
  startHour = DEFAULT_START_HOUR,
  endHour = DEFAULT_END_HOUR,
} = {}) {
  const parts = localParts(date, timeZone);
  const today = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (parts.hour < endHour) return previousCalendarDate(parts);
  if (parts.hour >= startHour) return today;
  return null;
}

export function ensureAfterHoursState(state, date = new Date(), options = {}) {
  state.system ||= {};
  const active = isChileAfterHours(date, options);
  const shiftKey = active ? getAfterHoursShiftKey(date, options) : null;

  if (!state.system.afterHours || typeof state.system.afterHours !== "object") {
    state.system.afterHours = {
      shiftKey: null,
      inboundTurns: 0,
      closed: false,
      closedAt: null,
      callbackPreference: null,
    };
  }

  const ah = state.system.afterHours;
  if (active && ah.shiftKey !== shiftKey) {
    ah.shiftKey = shiftKey;
    ah.inboundTurns = 0;
    ah.closed = false;
    ah.closedAt = null;
    ah.callbackPreference = null;
  }

  if (!active) {
    ah.shiftKey = null;
    ah.inboundTurns = 0;
    ah.closed = false;
    ah.closedAt = null;
  }

  return { active, shiftKey, state: ah };
}

export function registerAfterHoursInbound(state, date = new Date(), options = {}) {
  const current = ensureAfterHoursState(state, date, options);
  if (current.active) current.state.inboundTurns = Number(current.state.inboundTurns || 0) + 1;
  return current;
}

export function parseCallbackPreference(text = "") {
  const key = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?.,!;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/\b(am|manana|en la manana|temprano|antes de almuerzo)\b/.test(key)) return "am";
  if (/\b(pm|tarde|en la tarde|despues de almuerzo)\b/.test(key)) return "pm";
  return null;
}

export function shouldCloseAfterHours(state, {
  preevaluationCompleted = false,
  scheduleIntent = false,
  maxInboundTurns = DEFAULT_MAX_INBOUND_TURNS,
} = {}) {
  const ah = state?.system?.afterHours;
  if (!ah || ah.closed) return false;
  if (preevaluationCompleted) return true;
  if (scheduleIntent) return true;
  return Number(ah.inboundTurns || 0) >= maxInboundTurns;
}

export function markAfterHoursClosed(state, date = new Date()) {
  const current = ensureAfterHoursState(state, date);
  if (!current.active) return false;
  current.state.closed = true;
  current.state.closedAt = date.toISOString();
  return true;
}

export function setCallbackPreference(state, preference) {
  state.system ||= {};
  state.system.afterHours ||= {};
  state.system.afterHours.callbackPreference = preference;
}

export function buildAfterHoursClosureReply() {
  return [
    "por la hora\nmañana continuamos\nescribem am o pm",
    `${CONTACT_NAME}\n${CONTACT_PHONE}\nsaludos`,
  ].join("[[MSG]]");
}

export function buildAfterHoursPreferenceReply(preference) {
  const label = preference === "pm" ? "en la tarde" : "en la mañana";
  return [
    "perfecto",
    `mañana ${label}`,
    `${CONTACT_NAME}\n${CONTACT_PHONE}`,
    "saludos",
  ].join("[[MSG]]");
}

export const AFTER_HOURS_CONTACT = {
  name: CONTACT_NAME,
  phone: CONTACT_PHONE,
};
