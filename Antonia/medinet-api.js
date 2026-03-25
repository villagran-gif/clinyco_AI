/**
 * Medinet REST API client — replaces Playwright browser automation.
 *
 * Auth (two layers):
 *   /api-public/*  → "Authorization: Token <MEDINET_API_TOKEN>"
 *   /api/*          → Cookie session OR API-Key header (needs MEDINET_API_KEY)
 *                     Token auth is tried first; if 401/403, falls back.
 *
 * Real response shapes (from clinyco.medinetapp.com):
 *
 * Professional (activos-list):
 *   { id: 57, nombres: "Camila", paterno: "Alcayaga Toro", display: "Camila Alcayaga Toro" }
 *
 * Professional (list/ — full):
 *   { id, nombres, paterno, materno, tipo, email, es_activo, permite_agendaweb,
 *     tipos_cita: [{ id, nombre, duracion, color, tipoagenda: [{id}], sucursales: [1,2,39] }],
 *     sucursal_especialidades: [{ id, ubicacion: {id, etiqueta}, especialidad: {id, nombre} }],
 *     tipos_agenda: [{ id, nombre, es_ambulatoria }] }
 *
 * Professional (get_por_especialidad/{esp_id}/{ubi_id}/):
 *   [{ id, nombres, paterno, tipos_cita: [{id, nombre, duracion, tipoagenda}] }]
 *
 * Specialty (list/):
 *   { id: 5, nombre: "Nutrición" }
 *
 * Endpoints used:
 *   GET  /api/profesional/activos-list/                                    → [{id,nombres,paterno,display}]
 *   GET  /api/profesional/list/                                            → [{...full detail}]
 *   GET  /api/profesional/get_por_especialidad/{esp_id}/{ubi_id}/          → [{id,nombres,paterno,tipos_cita}]
 *   GET  /api/especialidad/list/                                           → [{id,nombre}]
 *   GET  /api/especialidad/get_por_ubicacion/{ubi_id}/                     → [{id,nombre}]
 *   GET  /api/agenda/citas/cupos-disponibles/{ubi}/{esp}/{prof}/{from}/{to}/{tipocita}/
 *   GET  /api/agenda/citas/proximos-cupos-chatbot/{ubi}/{esp}/
 *   GET  /api/agenda/citas/professional-is-available/{prof}/{type}/{date}/{dur}/
 *   GET  /api/agenda/citas/add-chatbot/                                    → POST chatbot booking
 *   GET  /api/agenda/tipocita/get-por-profesional/{prof}/
 *   GET  /api/transversal/sucursal/list/                                   → branch list
 *   GET  /api/transversal/prevision/                                       → insurance list
 *   GET  /api/pacientes/existe-run/                                        → check patient by RUT
 *   GET  /api/agenda/citas/get-check-cupos/{ubi}/?identifier={rut}          → check cupos (NO AUTH)
 *   POST /api/agenda/citas/agendaweb-add/                                  → book via agendaweb (NO AUTH, form-urlencoded)
 *   POST /api-public/schedule/appointment/add-overschedule/                → book (public API)
 *   GET  /api-public/schedule/appointment/all-appointments/{from}/{to}/
 *   GET  /api-public/schedule/appointment/{id}/
 *   PUT  /api-public/schedule/appointment/update-appointment-state/{id}/
 *   DEL  /api-public/schedule/appointment/{id}/delete-overschedule/
 */

const BASE_URL = "https://clinyco.medinetapp.com";

// ─── Auth ───────────────────────────────────────────────────────

function getToken() {
  const token = process.env.MEDINET_API_TOKEN;
  if (!token) throw new Error("MEDINET_API_TOKEN no está configurado");
  return token;
}

function getApiKey() {
  return process.env.MEDINET_API_KEY || "";
}

function getSessionCookie() {
  return process.env.MEDINET_SESSION_COOKIE || "";
}

/**
 * Build auth headers.
 * /api-public/* always uses Token.
 * /api/* tries: API-Key header, then session cookie, then Token (some DRF setups accept it).
 */
function buildHeaders(path) {
  const h = { "Content-Type": "application/json" };

  if (path.startsWith("/api-public/")) {
    h.Authorization = `Token ${getToken()}`;
    return h;
  }

  // /api/* endpoints — try available auth methods
  const apiKey = getApiKey();
  if (apiKey) {
    h["Api-Key"] = apiKey;
    return h;
  }

  const cookie = getSessionCookie();
  if (cookie) {
    h.Cookie = cookie;
    return h;
  }

  // Fallback: try Token auth (works if DRF TokenAuthentication is global)
  h.Authorization = `Token ${getToken()}`;
  return h;
}

async function apiFetch(path, { method = "GET", body = null, timeout = 15000 } = {}) {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const options = {
      method,
      headers: buildHeaders(path),
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

/**
 * Fetch without authentication — for /api/ endpoints that are publicly accessible.
 * Proven to work via curl without any token (get-check-cupos, cupos-disponibles, agendaweb-add, etc.).
 */
async function noAuthFetch(path, { method = "GET", headers = {}, body = null, timeout = 15000 } = {}) {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const options = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body) options.body = body;

    const res = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await res.json() : await res.text();

    if (!res.ok) {
      const msg = typeof data === "object" ? JSON.stringify(data) : String(data).slice(0, 300);
      throw new Error(`Medinet ${method} ${path} → ${res.status}: ${msg}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Professionals ──────────────────────────────────────────────

/**
 * List all active professionals.
 * Response: [{ id, nombres, paterno, display }]   (83 items)
 */
export async function fetchActiveProfessionals() {
  return apiFetch("/api/profesional/activos-list/");
}

/**
 * Full professional list with tipos_cita, sucursal_especialidades, etc.
 * Response: [{ id, nombres, paterno, materno, tipo, es_activo, permite_agendaweb,
 *   tipos_cita: [{ id, nombre, duracion, color, tipoagenda, sucursales }],
 *   sucursal_especialidades: [{ ubicacion: {id}, especialidad: {id, nombre} }],
 *   tipos_agenda: [{ id, nombre }] }]
 */
export async function fetchProfessionalsFull() {
  return apiFetch("/api/profesional/list/");
}

/**
 * Full paginated professional list (118 total, includes inactive).
 * Response: { count, next, previous, results: [{ ...full detail }] }
 */
export async function fetchProfessionalsPaginated(page = 1) {
  return apiFetch(`/api/profesional/?page=${page}`);
}

/**
 * Get professionals by specialty AND branch.
 * Response: [{ id, nombres, paterno, tipos_cita: [{ id, nombre, duracion }] }]
 */
export async function fetchProfessionalsBySpecialtyAndBranch(especialidadId, ubicacionId) {
  return apiFetch(`/api/profesional/get_por_especialidad/${especialidadId}/${ubicacionId}/`);
}

// ─── Specialties ────────────────────────────────────────────────

/**
 * List all specialties.
 * Response: [{ id: 5, nombre: "Nutrición" }, ...] (23 items)
 */
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

/**
 * Get appointment types for a professional.
 * Response: [{ id, nombre, duracion, color, tipoagenda, sucursales }]
 */
export async function fetchAppointmentTypes(profesionalId) {
  return apiFetch(`/api/agenda/tipocita/get-por-profesional/${profesionalId}/`);
}

/**
 * Get appointment types by branch + specialty + professional.
 */
export async function fetchAppointmentTypesByContext(branchId, specialtyId, profesionalId, isResource = 0) {
  return apiFetch(
    `/api/agenda/tipocita/get-by-branch-specialty-and-professional/${branchId}/${specialtyId}/${profesionalId}/${isResource}/`
  );
}

// ─── Branches (Sucursales) ──────────────────────────────────────

/** List all branches/locations */
export async function fetchBranches() {
  return apiFetch("/api/transversal/sucursal/list/");
}

/** List active branches */
export async function fetchActiveBranches() {
  return apiFetch("/api/transversal/sucursal/activos-list/");
}

// ─── Insurance (Previsiones) ────────────────────────────────────

/** List all insurance/previsión options */
export async function fetchPrevisiones() {
  return apiFetch("/api/transversal/prevision/");
}

// ─── Patients ───────────────────────────────────────────────────

/** Check if patient exists by RUT/RUN */
export async function checkPatientByRut(rut) {
  return apiFetch(`/api/pacientes/existe-run/?run=${encodeURIComponent(rut)}`);
}

/** Get patient data by ID */
export async function fetchPatientById(patientId) {
  return apiFetch(`/api/pacientes/get-patient-data-by-id/${patientId}/`);
}

/** Search patients by autocomplete */
export async function searchPatients(query) {
  return apiFetch(`/api/pacientes/autocomplete/filter/?search=${encodeURIComponent(query)}`);
}

// ─── Availability / Slots ───────────────────────────────────────

/**
 * Get available slots for a professional in a date range.
 * @param {number} ubicacionId    Branch / location ID (e.g. 39)
 * @param {number} especialidadId Specialty ID (e.g. 5 for Nutrición)
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
 * Designed specifically for chatbot flows — returns simplified availability.
 */
export async function fetchNextSlotsChatbot(ubicacionId, especialidadId) {
  return apiFetch(
    `/api/agenda/citas/proximos-cupos-chatbot/${ubicacionId}/${especialidadId}/`,
    { timeout: 20000 }
  );
}

/**
 * Check if a professional is available at a specific date/time.
 */
export async function checkProfessionalAvailable(profesionalId, agendaType, dateFrom, duration) {
  return apiFetch(
    `/api/agenda/citas/professional-is-available/${profesionalId}/${agendaType}/${dateFrom}/${duration}/`
  );
}

/**
 * Get professionals with availability for a specialty at a branch in a date range.
 */
export async function fetchProfessionalResourceAvailable(ubicacionId, especialidadId, fechaDesde, fechaHasta, tipocitaId, agendaTypeId) {
  return apiFetch(
    `/api/agenda/citas/professional-resource-available/${ubicacionId}/${especialidadId}/${fechaDesde}/${fechaHasta}/${tipocitaId}/${agendaTypeId}/`,
    { timeout: 20000 }
  );
}

// ─── Booking ────────────────────────────────────────────────────

/**
 * Book via chatbot-specific endpoint (preferred over overschedule).
 */
export async function bookChatbot(data) {
  return apiFetch("/api/agenda/citas/add-chatbot/", {
    method: "POST",
    body: data,
    timeout: 20000,
  });
}

/**
 * Book an appointment (overschedule — public API, Token auth).
 */
export async function bookOverschedule(data) {
  return apiFetch("/api-public/schedule/appointment/add-overschedule/", {
    method: "POST",
    body: data,
    timeout: 20000,
  });
}

// ─── No-auth endpoints (publicly accessible) ───────────────────

/**
 * Check cupos for a patient at a branch. No auth required.
 * @param {number} ubicacionId  Branch ID (e.g. 39)
 * @param {string} rut          Patient RUT with dv (e.g. "24.611.466-8")
 * @returns {{ status, mensaje, paciente_existe, puede_agendar, maximo_cupos }}
 */
export async function checkCupos(ubicacionId, rut) {
  return noAuthFetch(
    `/api/agenda/citas/get-check-cupos/${ubicacionId}/?identifier=${encodeURIComponent(rut)}`,
    { timeout: 10000 }
  );
}

/**
 * Book via agendaweb-add endpoint. No auth required.
 * Uses application/x-www-form-urlencoded + X-Requested-With: XMLHttpRequest.
 *
 * @param {object} opts
 * @param {object} opts.slot         - { dataDia, time, professionalId, duration }
 * @param {number} opts.especialidad - Specialty ID
 * @param {number} opts.tipocita     - Appointment type ID
 * @param {number} opts.ubicacion    - Branch ID
 * @param {boolean} opts.pacienteExiste - true if patient already exists in system
 * @param {object} opts.paciente     - Patient data
 * @param {string} opts.paciente.run
 * @param {string} [opts.paciente.email]
 * @param {string} [opts.paciente.telefono]
 * @param {string} [opts.paciente.nombre]       - Required if !pacienteExiste
 * @param {string} [opts.paciente.apellidos]     - Required if !pacienteExiste
 * @param {string} [opts.paciente.sexo]          - Required if !pacienteExiste
 * @param {string} [opts.paciente.fechaNacimiento] - Required if !pacienteExiste (YYYY-MM-DD)
 * @param {string} [opts.paciente.direccion]     - Required if !pacienteExiste
 * @param {string|number} [opts.paciente.aseguradora] - Required if !pacienteExiste
 */
export async function bookAgendaweb({ slot, especialidad, tipocita, ubicacion, pacienteExiste, paciente }) {
  const fields = {
    es_recurso: "false",
    estado: "1",
    fecha: slot.dataDia,
    tipo: String(tipocita),
    duracion: String(slot.duration || 30),
    especialidad: String(especialidad),
    hora: slot.time,
    profesional: String(slot.professionalId),
    sesion_id: "",
    tipoagenda: "",
    observacion: "Agendado via AgendaWeb.",
    run: paciente.run,
    ubicacion: String(ubicacion),
    desde_agendaweb: "true",
    is_patient_created_from_two_factor: "false",
    email: paciente.email || "",
    telefono_fijo: paciente.telefono || "",
  };

  if (pacienteExiste) {
    // Existing patient: personal fields empty
    fields.nombre = "";
    fields.apellidos = "";
    fields.direccion = "";
    fields.sexo = "";
    fields.fecha_nacimiento = "";
    fields.aseguradora = "";
  } else {
    // New patient: all personal fields required
    fields.nombre = paciente.nombre || "";
    fields.apellidos = paciente.apellidos || "";
    fields.direccion = paciente.direccion || "";
    fields.sexo = paciente.sexo || "";
    fields.fecha_nacimiento = paciente.fechaNacimiento || "";
    fields.aseguradora = String(paciente.aseguradora || "");
  }

  const body = new URLSearchParams(fields).toString();

  return noAuthFetch("/api/agenda/citas/agendaweb-add/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
    timeout: 20000,
  });
}

/**
 * Full API-only search + book flow. No auth/token required.
 * 1. checkCupos → paciente_existe?
 * 2. fetchAvailableSlots (via noAuthFetch) → available slots
 * 3. bookAgendaweb → confirm booking
 */
export async function searchSlotsNoAuth({ ubicacionId, especialidadId, profesionalId, fechaDesde, fechaHasta, tipocitaId }) {
  return noAuthFetch(
    `/api/agenda/citas/cupos-disponibles/${ubicacionId}/${especialidadId}/${profesionalId}/${fechaDesde}/${fechaHasta}/${tipocitaId}/`,
    { timeout: 20000 }
  );
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
 * Known specialty ID mapping (from /api/especialidad/list/).
 * Avoids extra API call when we already know the specialty.
 */
const SPECIALTY_IDS = {
  "CIRUGIA PLASTICA": 54,
  "CIRUGIA GENERAL Y APARATO DIGESTIVO": 1,
  "CIRUGIA ADULTO": 19,
  "ENDOCRINOLOGIA ADULTO": 2,
  "ENDOCRINOLOGIA INFANTIL": 17,
  "ENDOSCOPIA / COLONOSCOPIA": 58,
  "ENFERMERIA": 13,
  "EXAMENES": 9,
  "GASTROENTEROLOGIA ADULTO": 3,
  "GASTROENTEROLOGIA PEDIATRICA": 20,
  "HEMATOLOGO": 55,
  "INTERNISTA": 11,
  "MEDICINA DEPORTIVA": 4,
  "MEDICINA GENERAL": 53,
  "NEUROCIRUGIA": 57,
  "NEUROLOGIA": 10,
  "NUTRICION": 5,
  "NUTRIOLOGIA": 6,
  "ONCOLOGIA": 12,
  "PEDIATRIA": 56,
  "PROCEDIMIENTOS": 15,
  "PSICOLOGIA": 7,
  "PSIQUIATRIA": 8,
};

/**
 * Find specialty ID by name (fuzzy).
 */
export function findSpecialtyId(name) {
  const normalized = normalizeText(name);
  // Exact match
  if (SPECIALTY_IDS[normalized]) return SPECIALTY_IDS[normalized];
  // Partial match
  for (const [key, id] of Object.entries(SPECIALTY_IDS)) {
    if (key.includes(normalized) || normalized.includes(key)) return id;
  }
  return null;
}

/**
 * Search for a professional by name/query, returning the best match.
 * Uses /api/profesional/activos-list/ (lightweight: id, nombres, paterno, display).
 */
export async function findProfessional(query) {
  const normalized = normalizeText(query);
  if (!normalized) return null;

  // Fetch all active professionals and match locally
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
 * Get full professional details (tipos_cita, sucursal_especialidades) for a matched professional.
 * Enriches the lightweight match from activos-list with data from list/.
 */
export async function getProfessionalDetails(profId) {
  const fullList = await fetchProfessionalsFull();
  if (!Array.isArray(fullList)) return null;
  return fullList.find((p) => p.id === profId) || null;
}

/**
 * Build the professionals cache from API (replaces Playwright cacheAllProfessionals).
 * Returns array in the same shape as the old Playwright cache for backward compatibility.
 */
export async function buildProfessionalsCache() {
  const fullList = await fetchProfessionalsFull();
  if (!Array.isArray(fullList)) return [];

  return fullList.map((prof) => {
    const name = `${prof.nombres || ""} ${prof.paterno || ""}`.replace(/\s+/g, " ").trim();
    const suc_esps = prof.sucursal_especialidades || [];
    const specialties = suc_esps.map((se) => se.especialidad?.nombre || "").filter(Boolean);
    const tipoCita = prof.tipos_cita || [];

    return {
      id: String(prof.id || ""),
      name,
      specialty: specialties[0] || "",
      specialtyId: String(suc_esps[0]?.especialidad?.id || ""),
      tipocita: String(tipoCita[0]?.id || ""),
      duracion: String(tipoCita[0]?.duracion || ""),
      alert_text: prof.agendaweb_alert || "",
      avatarUrl: prof.avatar || "",
      // Extra API-only fields
      ubicacionId: String(suc_esps[0]?.ubicacion?.id || ""),
      allSpecialties: specialties,
      allSucursalEspecialidades: suc_esps.map((se) => ({
        ubicacionId: se.ubicacion?.id,
        ubicacionNombre: se.ubicacion?.etiqueta || se.ubicacion?.descripcion || "",
        especialidadId: se.especialidad?.id,
        especialidadNombre: se.especialidad?.nombre || "",
      })),
      allTiposCita: tipoCita.map((tc) => ({
        id: tc.id,
        nombre: tc.nombre,
        duracion: tc.duracion,
        sucursales: tc.sucursales || [],
      })),
      esActivo: prof.es_activo !== false,
      permiteAgendaweb: prof.permite_agendaweb || false,
    };
  });
}

/**
 * Search available slots for a professional via API.
 * Needs the full professional detail to extract ubicacionId, especialidadId, tipocitaId.
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
  const entries = Array.isArray(rawSlots) ? rawSlots : rawSlots?.results || rawSlots?.cupos || rawSlots?.slots || [];

  for (const entry of entries) {
    if (slots.length >= MAX_SLOTS) break;

    const date = entry.fecha || entry.date || entry.dia || "";
    const time = entry.hora || entry.hour || entry.time || "";
    if (!date || !time) continue;

    slots.push({
      date: isoToDisplayDate(date) || date,
      time,
      dataDia: date,
      professional: entry.profesional || entry.professional_name || "",
      professionalId: String(entry.profesional_id || professionalId),
      specialty: entry.especialidad || entry.specialty_name || "",
      duration: entry.duracion || entry.duration || 30,
    });
  }

  return slots;
}

/**
 * Book an appointment via API (replaces Playwright bookSlot).
 * Tries chatbot endpoint first, falls back to overschedule.
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

  // Add patient fields
  if (patientData?.nombres) bookingPayload.patient_name = `${patientData.nombres} ${patientData.apPaterno || ""} ${patientData.apMaterno || ""}`.trim();
  if (patientData?.email) bookingPayload.patient_email = patientData.email;
  if (patientData?.fono) bookingPayload.patient_phone = patientData.fono;
  if (patientData?.prevision) bookingPayload.patient_insurance = patientData.prevision;

  try {
    // Try chatbot-specific booking endpoint first
    const result = await bookChatbot(bookingPayload);
    return {
      source: "antonia_booking_via_api_chatbot",
      success: true,
      message: "Reserva realizada con éxito",
      appointmentId: result?.id || result?.appointment_id || result?.cita_id || null,
      patient_reply: "Tu cita ha sido agendada con éxito. Revisa tu email para la confirmación. ¡Gracias!",
      raw: result,
    };
  } catch (chatbotError) {
    console.log("Chatbot booking failed, trying overschedule:", chatbotError.message);
  }

  // Fallback to overschedule (public API, Token auth — always works)
  try {
    const result = await bookOverschedule(bookingPayload);
    return {
      source: "antonia_booking_via_api_overschedule",
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
