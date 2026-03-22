/**
 * Medinet REST API client — replaces Playwright browser automation.
 *
 * Auth:
 *   /api-public/*  → "Authorization: Token <MEDINET_API_TOKEN>"
 *   /api/*          → same token (confirmed by admin)
 *
 * Key endpoints used:
 *   Professionals  GET  /api/profesional/activos-list/
 *   Professionals  GET  /api/profesional/list/                              (full detail)
 *   Search by name GET  /api/profesional/get-por-nombre/
 *   By specialty   GET  /api/profesional/get_por_especialidad/{id}/
 *   By branch      GET  /api/profesional/filter-profesional-sucursal/{id}/
 *   Slots          GET  /api/agenda/citas/cupos-disponibles/{ubi}/{esp}/{prof}/{desde}/{hasta}/{tipocita}/
 *   Next slots     GET  /api/agenda/citas/proximos-cupos-chatbot/{ubi}/{esp}/
 *   Check avail.   GET  /api/agenda/citas/professional-is-available/{prof}/{agenda_type}/{date}/{duration}/
 *   Specialties    GET  /api/especialidad/list/
 *   Appt types     GET  /api/agenda/tipocita/get-por-profesional/{prof}/
 *   Book           POST /api-public/schedule/appointment/add-overschedule/
 *   All appts      GET  /api-public/schedule/appointment/all-appointments/{from}/{to}/
 *   Appt detail    GET  /api-public/schedule/appointment/{id}/
 *   Cancel/Confirm PUT  /api-public/schedule/appointment/update-appointment-state/{id}/
 *   Delete oversch DELETE /api-public/schedule/appointment/{id}/delete-overschedule/
 */

const BASE_URL = "https://clinyco.medinetapp.com";

function getToken() {
  const token = process.env.MEDINET_API_TOKEN;
  if (!token) throw new Error("MEDINET_API_TOKEN no está configurado");
  return token;
}

function headers() {
  return {
    Authorization: `Token ${getToken()}`,
    "Content-Type": "application/json",
  };
}

async function apiFetch(path, { method = "GET", body = null, timeout = 15000 } = {}) {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const options = {
      method,
      headers: headers(),
      signal: controller.signal,
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Medinet API ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await res.json();
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Professionals ──────────────────────────────────────────────

/** List all active professionals (lightweight: id, nombres, paterno, display) */
export async function fetchActiveProfessionals() {
  return apiFetch("/api/profesional/activos-list/");
}

/** Full professional list with specialties, appointment types, etc. */
export async function fetchProfessionalsFull() {
  return apiFetch("/api/profesional/list/");
}

/** Search professional by name query */
export async function searchProfessionalByName(query) {
  return apiFetch(`/api/profesional/get-por-nombre/?search=${encodeURIComponent(query)}`);
}

/** Get professionals by specialty ID */
export async function fetchProfessionalsBySpecialty(especialidadId) {
  return apiFetch(`/api/profesional/get_por_especialidad/${especialidadId}/`);
}

/** Get professionals by branch/location ID */
export async function fetchProfessionalsByBranch(ubicacionId) {
  return apiFetch(`/api/profesional/filter-profesional-sucursal/${ubicacionId}/`);
}

// ─── Specialties ────────────────────────────────────────────────

/** List all specialties */
export async function fetchSpecialties() {
  return apiFetch("/api/especialidad/list/");
}

/** Get specialties available at a branch */
export async function fetchSpecialtiesByBranch(ubicacionId) {
  return apiFetch(`/api/especialidad/get_por_ubicacion/${ubicacionId}/`);
}

/** Get specialties for a professional at a branch */
export async function fetchSpecialtiesForProfessional(ubicacionId, profesionalId) {
  return apiFetch(`/api/especialidad/get_por_profesional/${ubicacionId}/${profesionalId}/`);
}

// ─── Appointment types ──────────────────────────────────────────

/** Get appointment types for a professional */
export async function fetchAppointmentTypes(profesionalId) {
  return apiFetch(`/api/agenda/tipocita/get-por-profesional/${profesionalId}/`);
}

// ─── Availability / Slots ───────────────────────────────────────

/**
 * Get available slots for a professional in a date range.
 * @param {number} ubicacionId    Branch / location ID
 * @param {number} especialidadId Specialty ID
 * @param {number} profesionalId  Professional ID
 * @param {string} fechaDesde     "YYYY-MM-DD"
 * @param {string} fechaHasta     "YYYY-MM-DD"
 * @param {number} tipocitaId     Appointment type ID
 */
export async function fetchAvailableSlots(ubicacionId, especialidadId, profesionalId, fechaDesde, fechaHasta, tipocitaId) {
  return apiFetch(
    `/api/agenda/citas/cupos-disponibles/${ubicacionId}/${especialidadId}/${profesionalId}/${fechaDesde}/${fechaHasta}/${tipocitaId}/`,
    { timeout: 20000 }
  );
}

/**
 * Get next available slots for a specialty at a branch (chatbot-optimized).
 * @param {number} ubicacionId    Branch / location ID
 * @param {number} especialidadId Specialty ID
 */
export async function fetchNextSlotsChatbot(ubicacionId, especialidadId) {
  return apiFetch(
    `/api/agenda/citas/proximos-cupos-chatbot/${ubicacionId}/${especialidadId}/`,
    { timeout: 20000 }
  );
}

/**
 * Check if a professional is available at a specific date/time.
 * @param {number} profesionalId
 * @param {number} agendaType     Agenda type ID
 * @param {string} dateFrom       "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"
 * @param {number} duration       Duration in minutes
 * @returns {{ is_available: boolean }}
 */
export async function checkProfessionalAvailable(profesionalId, agendaType, dateFrom, duration) {
  return apiFetch(
    `/api/agenda/citas/professional-is-available/${profesionalId}/${agendaType}/${dateFrom}/${duration}/`
  );
}

/**
 * Get schedule for a specific day.
 */
export async function fetchScheduleByDay(dateQuery, scheduleTypeId, resourceId, isResource, branchId, specialtyId) {
  return apiFetch(
    `/api/agenda/citas/get-schedule-by-day/${dateQuery}/${scheduleTypeId}/${resourceId}/${isResource}/${branchId}/${specialtyId}/`,
    { timeout: 20000 }
  );
}

// ─── Booking ────────────────────────────────────────────────────

/**
 * Book an appointment (overschedule).
 * @param {Object} data
 * @param {number} data.profesional_id
 * @param {string} data.date            "YYYY-MM-DD"
 * @param {string} data.hour            "HH:MM"
 * @param {number} data.duration        minutes
 * @param {number} data.schedule_type_id
 * @param {number} data.branch_id
 * @param {string} [data.patient_name]
 * @param {string} [data.patient_email]
 * @param {string} [data.patient_phone]
 * @param {string} [data.patient_rut]
 * @param {string} [data.patient_insurance]
 * @returns {Object} booking result
 */
export async function bookAppointment(data) {
  return apiFetch("/api-public/schedule/appointment/add-overschedule/", {
    method: "POST",
    body: data,
    timeout: 20000,
  });
}

// ─── Appointments (query / manage) ─────────────────────────────

/**
 * Get all appointments in a date range.
 * @param {string} startDate "YYYY-MM-DD"
 * @param {string} endDate   "YYYY-MM-DD"
 */
export async function fetchAllAppointments(startDate, endDate) {
  return apiFetch(
    `/api-public/schedule/appointment/all-appointments/${startDate}/${endDate}/`,
    { timeout: 20000 }
  );
}

/**
 * Get appointments for a specific patient in a date range.
 */
export async function fetchAppointmentsByPatient(startDate, endDate) {
  return apiFetch(
    `/api-public/schedule/appointment/appointments-by-patient/${startDate}/${endDate}/`,
    { timeout: 20000 }
  );
}

/** Get appointment detail by ID */
export async function fetchAppointmentDetail(appointmentId) {
  return apiFetch(`/api-public/schedule/appointment/${appointmentId}/`);
}

/**
 * Confirm or cancel an appointment.
 * @param {number} appointmentId
 * @param {"Confirm"|"Cancel"} action
 */
export async function updateAppointmentState(appointmentId, action) {
  return apiFetch(`/api-public/schedule/appointment/update-appointment-state/${appointmentId}/`, {
    method: "PUT",
    body: { action },
  });
}

/** Delete an overschedule appointment */
export async function deleteOverschedule(appointmentId) {
  return apiFetch(`/api-public/schedule/appointment/${appointmentId}/delete-overschedule/`, {
    method: "DELETE",
  });
}

// ─── High-level helpers (used by server.js) ─────────────────────

const MAX_SLOTS = 3;

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function isoToDisplayDate(value = "") {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Search for a professional by name/query using the API, returning the best match
 * from the full professionals list + cache.
 */
export async function findProfessional(query) {
  const normalized = normalizeText(query);
  if (!normalized) return null;

  // Try name-search endpoint first
  try {
    const results = await searchProfessionalByName(query);
    if (Array.isArray(results) && results.length > 0) {
      return results[0];
    }
  } catch {
    // fallback to full list
  }

  // Fallback: fetch all active and match locally
  const professionals = await fetchActiveProfessionals();
  if (!Array.isArray(professionals) || !professionals.length) return null;

  let bestMatch = null;
  let bestPriority = 99;

  for (const prof of professionals) {
    const display = normalizeText(prof.display || `${prof.nombres || ""} ${prof.paterno || ""}`);
    const tokens = display.split(/\s+/).filter(Boolean);

    let priority = 99;
    if (display === normalized) priority = 1;
    else if (display.startsWith(normalized)) priority = 3;
    else if (display.includes(normalized)) priority = 4;
    else if (tokens.some((t) => t === normalized)) priority = 6;
    else if (tokens.some((t) => t.startsWith(normalized) || normalized.startsWith(t))) priority = 8;
    else {
      const reqTokens = normalized.split(/\s+/).filter(Boolean);
      if (reqTokens.length >= 2 && reqTokens.every((rt) => tokens.some((nt) => nt.includes(rt) || rt.includes(nt)))) {
        priority = 2;
      }
    }

    if (priority < bestPriority) {
      bestPriority = priority;
      bestMatch = prof;
    }
  }

  return bestPriority < 99 ? bestMatch : null;
}

/**
 * Build the professionals cache from API (replaces Playwright cacheAllProfessionals).
 * Returns array of professionals in the same shape the old cache used.
 */
export async function buildProfessionalsCache() {
  const fullList = await fetchProfessionalsFull();
  if (!Array.isArray(fullList)) return [];

  return fullList.map((prof) => {
    const name = `${prof.nombres || ""} ${prof.paterno || ""}`.replace(/\s+/g, " ").trim();
    const specialties = (prof.sucursal_especialidades || [])
      .map((se) => se.especialidad?.nombre || "")
      .filter(Boolean);
    const tipoCita = (prof.tipos_cita || []);

    return {
      id: String(prof.id || ""),
      name,
      specialty: specialties[0] || "",
      specialtyId: String((prof.sucursal_especialidades || [])[0]?.especialidad?.id || ""),
      tipocita: String(tipoCita[0]?.id || ""),
      duracion: String(tipoCita[0]?.duracion || ""),
      alert_text: "",
      avatarUrl: "",
      // Extra API fields not available via Playwright
      ubicacionId: String((prof.sucursal_especialidades || [])[0]?.ubicacion?.id || ""),
      allSpecialties: specialties,
      allTiposCita: tipoCita.map((tc) => ({ id: tc.id, nombre: tc.nombre, duracion: tc.duracion })),
      esActivo: prof.es_activo !== false,
    };
  });
}

/**
 * Search available slots for a professional via API.
 * Returns the same shape as old Playwright-based runMedinetAntonia().
 */
export async function searchAvailableSlots({ professionalId, ubicacionId, especialidadId, tipocitaId, daysAhead = 14 }) {
  const today = new Date();
  const fromDate = today.toISOString().slice(0, 10);
  const toDate = new Date(today.getTime() + daysAhead * 86400000).toISOString().slice(0, 10);

  const rawSlots = await fetchAvailableSlots(
    ubicacionId, especialidadId, professionalId, fromDate, toDate, tipocitaId
  );

  if (!Array.isArray(rawSlots) && typeof rawSlots !== "object") return [];

  // Normalize API response into our slot format
  const slots = [];
  const entries = Array.isArray(rawSlots) ? rawSlots : rawSlots?.results || rawSlots?.slots || [];

  for (const entry of entries) {
    if (slots.length >= MAX_SLOTS) break;

    const date = entry.fecha || entry.date || entry.dia || "";
    const time = entry.hora || entry.hour || entry.time || "";
    if (!date || !time) continue;

    slots.push({
      date: isoToDisplayDate(date) || date,
      time,
      dataDia: date,
      professional: entry.profesional || entry.professional || "",
      professionalId: String(entry.profesional_id || professionalId),
      specialty: entry.especialidad || entry.specialty || "",
    });
  }

  return slots;
}

/**
 * Book an appointment via API (replaces Playwright bookSlot).
 * Returns { success, message, patient_reply }.
 */
export async function bookAppointmentForPatient({ slot, patientData, branchId, scheduleTypeId = 1 }) {
  const bookingPayload = {
    profesional_id: Number(slot.professionalId),
    date: slot.dataDia,
    hour: slot.time,
    duration: Number(slot.duration || 30),
    schedule_type_id: scheduleTypeId,
    branch_id: Number(branchId),
  };

  // Add optional patient fields if the API supports them
  if (patientData?.nombres) bookingPayload.patient_name = `${patientData.nombres} ${patientData.apPaterno || ""} ${patientData.apMaterno || ""}`.trim();
  if (patientData?.email) bookingPayload.patient_email = patientData.email;
  if (patientData?.fono) bookingPayload.patient_phone = patientData.fono;
  if (patientData?.prevision) bookingPayload.patient_insurance = patientData.prevision;

  try {
    const result = await bookAppointment(bookingPayload);

    return {
      source: "antonia_booking_via_api",
      success: true,
      message: "Reserva realizada con éxito",
      appointmentId: result?.id || result?.appointment_id || null,
      patient_reply: "Tu cita ha sido agendada con éxito. Revisa tu email para la confirmación. ¡Gracias!",
      raw: result,
    };
  } catch (error) {
    return {
      source: "antonia_booking_via_api",
      success: false,
      message: error.message,
      patient_reply: `Hubo un problema al confirmar la reserva: ${error.message}. Por favor intenta directamente en https://clinyco.medinetapp.com/agendaweb/planned/`,
    };
  }
}
