// lead-alerts/eligibility.js
//
// Lógica PURA de elegibilidad para la alerta a María Paz. Sin DB ni red: testeable.
//
// Decisión del producto: "Antonia pregunta ciudad + filtrar duro". Se notifica SOLO si:
//  - el lead confirmó el handoff (quiere ser contactado) y no fue notificado antes,
//  - NO es de Antofagasta (residencia conocida y distinta de Antofagasta),
//  - se atiende/opera en Santiago (ciudad de atención conocida == Santiago),
//  - estamos dentro del turno de Gabriela (≥ hora de inicio, en los días configurados).
//
// Filtro duro => dato desconocido (null) NO es elegible: preferimos no sobre-notificar.

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

export function isFromAntofagasta(ciudad) {
  return norm(ciudad).includes("ANTOFAGASTA");
}

export function isAttendedInSantiago(ciudadAtencion) {
  return norm(ciudadAtencion).includes("SANTIAGO");
}

// Hora y día de la semana en la zona horaria de Chile (maneja DST vía Intl).
export function getZonedParts(now, timeZone = "America/Santiago") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hour12: false
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  let hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (Number.isNaN(hour)) hour = null;
  if (hour === 24) hour = 0; // Intl puede devolver "24" a medianoche
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: map[wd] ?? null, hour };
}

// shift = { startHour=17, endHour=24, weekdays=[0..6] | null(=todos) }
export function isWithinShift(now, shift = {}, timeZone = "America/Santiago") {
  const { weekday, hour } = getZonedParts(now, timeZone);
  if (hour === null) return false;
  const startHour = Number.isFinite(shift.startHour) ? shift.startHour : 17;
  const endHour = Number.isFinite(shift.endHour) ? shift.endHour : 24; // exclusivo
  const weekdays = Array.isArray(shift.weekdays) && shift.weekdays.length ? shift.weekdays : null;
  if (weekdays && !weekdays.includes(weekday)) return false;
  return hour >= startHour && hour < endHour;
}

// lead = { handoffConfirmed, alreadyNotified, ciudad, ciudadAtencion }
// opts = { now=Date, timeZone, shift }
export function evaluateLead(lead = {}, opts = {}) {
  const now = opts.now || new Date();
  const timeZone = opts.timeZone || "America/Santiago";
  const shift = opts.shift || {};
  const reasons = [];

  if (!lead.handoffConfirmed) reasons.push("sin_handoff_confirmado");
  if (lead.alreadyNotified) reasons.push("ya_notificado");

  if (!lead.ciudad) reasons.push("residencia_desconocida");
  else if (isFromAntofagasta(lead.ciudad)) reasons.push("es_antofagasta");

  if (!lead.ciudadAtencion) reasons.push("ciudad_atencion_desconocida");
  else if (!isAttendedInSantiago(lead.ciudadAtencion)) reasons.push("no_opera_en_santiago");

  if (!isWithinShift(now, shift, timeZone)) reasons.push("fuera_de_turno");

  return { eligible: reasons.length === 0, reasons };
}
