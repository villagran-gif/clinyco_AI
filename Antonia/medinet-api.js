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
 *   POST /api/agenda/citas/add-chatbot/                                    → book (chatbot)
 *   POST /api/agenda/citas/agendaweb-add/                                 → book (agendaweb form, form-urlencoded)
 *   GET  /api/agenda/citas/get-check-cupos/{ubi}/?identifier=X            → cupo/patient check
 *   POST /api/agenda/citas/solicitar-codigo/                              → request verification code
 *   GET  /api/agenda/tipocita/get-por-profesional/{prof}/
 *   GET  /api/transversal/sucursal/list/                                   → branch list
 *   GET  /api/transversal/prevision/                                       → insurance list
 *   GET  /api/pacientes/existe-run/                                        → check patient by RUT
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
 * Token auth works for most parametric /api/* endpoints and /api-public/*.
 * Api-Key and Cookie are tried only as fallbacks for endpoints that reject Token.
 *
 * Verified working with Token auth (2026-03-25):
 *   /api/profesional/activos-list/                    (also works unauthenticated)
 *   /api/especialidad/get_por_ubicacion/{id}/
 *   /api/especialidad/get_por_profesional/{ubi}/{prof}/
 *   /api/pacientes/existe-run/?run=XX.XXX.XXX-X
 *   /api/agenda/citas/proximos-cupos-chatbot/{ubi}/{esp}/
 *   /api/agenda/tipocita/get-by-branch-specialty-and-professional/{b}/{e}/{p}/{r}/
 */
function buildHeaders(path) {
  const h = { "Content-Type": "application/json" };

  // Token auth is the primary method — works for both /api/ and /api-public/
  try {
    h.Authorization = `Token ${getToken()}`;
  } catch {
    // Token not configured — try fallbacks
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
  }

  return h;
}

/**
 * POST with application/x-www-form-urlencoded body.
 * Used for agendaweb endpoints that require form data + XMLHttpRequest header.
 */
async function apiFormPost(path, params, { timeout = 20000 } = {}) {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const h = { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" };
    // Add auth if available
    try { h.Authorization = `Token ${getToken()}`; } catch { /* no token */ }

    const res = await fetch(url, {
      method: "POST",
      headers: h,
      body: params.toString(),
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      // agendaweb-add returns 200 even for errors like "cupo_tomado"
      if (json.status === "cupo_tomado") {
        throw new Error(json.message || "La hora seleccionada no tiene cupo.");
      }
      return json;
    }

    // Non-JSON response (likely HTML error page) means server error
    const text = await res.text().catch(() => "");
    if (!res.ok || text.includes("<title>500</title>") || text.includes("<title>404</title>")) {
      throw new Error(`Medinet form POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
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
    const text = await res.text();
    // Some endpoints return empty body on success (e.g. proximos-cupos-chatbot with no slots)
    if (!text || !text.trim()) return null;
    return text;
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

// ─── Cupos / Verification ───────────────────────────────────────

/**
 * Check if a patient can book at a given branch (cupo check).
 * @param {number} ubicacionId  Branch ID (e.g. 39)
 * @param {string} identifier   Patient RUT formatted with dots (e.g. "6.469.664-5")
 * @returns {{ status: boolean, mensaje: string, paciente_existe: boolean, puede_agendar: boolean, maximo_cupos: number }}
 */
export async function checkCupos(ubicacionId, identifier) {
  return apiFetch(
    `/api/agenda/citas/get-check-cupos/${ubicacionId}/?identifier=${encodeURIComponent(identifier)}`
  );
}

/**
 * Request a verification code for a patient (sends email notification).
 * @param {string} identifier  Patient RUT
 * @param {boolean} isFromTwoFactor  Whether this is a two-factor request
 * @returns {{ status: boolean, mensaje: string, id: number, is_created_from_two_factor: boolean }}
 */
export async function requestVerificationCode(identifier, isFromTwoFactor = false) {
  const params = new URLSearchParams({
    identifier,
    is_from_two_factor: String(isFromTwoFactor),
  });
  return apiFormPost("/api/agenda/citas/solicitar-codigo/", params);
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

/**
 * Book via the agendaweb form endpoint (same endpoint the web UI uses).
 * Requires X-Requested-With: XMLHttpRequest and form-urlencoded body.
 *
 * IMPORTANT rules discovered via testing:
 *  - Header X-Requested-With: XMLHttpRequest is MANDATORY (500 without it)
 *  - For existing patients: personal fields (nombre, apellidos, direccion, sexo,
 *    fecha_nacimiento, aseguradora) MUST be empty — backend looks them up by RUN
 *  - For new patients: all personal fields must be provided
 *
 * @param {object} opts
 * @param {string} opts.run                Patient RUT (e.g. "6.469.664-5")
 * @param {string} opts.fecha              Date "YYYY-MM-DD"
 * @param {string} opts.hora               Time "HH:MM"
 * @param {number} opts.profesional        Professional ID
 * @param {number} opts.especialidad       Specialty ID
 * @param {number} opts.tipo               Appointment type ID
 * @param {number} opts.duracion           Duration in minutes
 * @param {number} opts.ubicacion          Branch ID
 * @param {boolean} opts.pacienteExiste    Whether the patient already exists
 * @param {string} [opts.email]            Patient email
 * @param {string} [opts.telefono]         Patient phone
 * @param {string} [opts.nombre]           Patient first name (new patients only)
 * @param {string} [opts.apellidos]        Patient last name (new patients only)
 * @param {string} [opts.direccion]        Patient address (new patients only)
 * @param {string} [opts.sexo]             Patient sex M/F (new patients only)
 * @param {string} [opts.fechaNacimiento]  Patient DOB DD/MM/YYYY (new patients only)
 * @param {string} [opts.aseguradora]      Insurance ID (new patients only)
 * @param {boolean} [opts.esRecurso]       Whether booking a resource (default false)
 * @returns {{ status: string }} e.g. { status: "agendado_correctamente" }
 */
export async function bookAgendaweb(opts) {
  const isNew = !opts.pacienteExiste;

  const params = new URLSearchParams({
    es_recurso: String(opts.esRecurso || false),
    estado: "1",
    fecha: opts.fecha,
    tipo: String(opts.tipo),
    duracion: String(opts.duracion || 30),
    especialidad: String(opts.especialidad),
    hora: opts.hora,
    profesional: String(opts.profesional),
    sesion_id: "",
    tipoagenda: "",
    observacion: "Agendado vía AgendaWeb.",
    nombre: isNew ? (opts.nombre || "") : "",
    apellidos: isNew ? (opts.apellidos || "") : "",
    telefono_fijo: opts.telefono || "",
    direccion: isNew ? (opts.direccion || "") : "",
    sexo: isNew ? (opts.sexo || "") : "",
    email: opts.email || "",
    fecha_nacimiento: isNew ? (opts.fechaNacimiento || "") : "",
    aseguradora: isNew ? (opts.aseguradora || "") : "",
    run: opts.run,
    ubicacion: String(opts.ubicacion),
    desde_agendaweb: "true",
    is_patient_created_from_two_factor: "false",
  });

  return apiFormPost("/api/agenda/citas/agendaweb-add/", params);
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
 *
 * Strategy (3-tier fallback):
 *  1. bookAgendaweb()  — form-urlencoded, same endpoint the web UI uses (proven working)
 *  2. bookChatbot()    — JSON, chatbot-specific endpoint
 *  3. bookOverschedule() — JSON, public API endpoint
 *
 * @param {object} opts
 * @param {object} opts.slot          Slot object { professionalId, dataDia, time, duration, specialtyId, tipoCitaId }
 * @param {object} opts.patientData   Patient { run, email, fono, nombres, apPaterno, apMaterno, direccion, sexo, fechaNacimiento, prevision }
 * @param {number} opts.branchId      Branch/ubicacion ID
 * @param {boolean} [opts.pacienteExiste]  Whether patient already exists (from checkCupos)
 * @param {number} [opts.scheduleTypeId]   Schedule type (default 1)
 */
export async function bookAppointmentForPatient({ slot, patientData, branchId, pacienteExiste, scheduleTypeId = 1 }) {

  // ── Tier 1: bookAgendaweb (preferred — proven via real browser testing) ──
  try {
    const result = await bookAgendaweb({
      run: patientData.run || patientData.rut || "",
      fecha: slot.dataDia,
      hora: slot.time,
      profesional: Number(slot.professionalId),
      especialidad: Number(slot.specialtyId || slot.especialidadId || 0),
      tipo: Number(slot.tipoCitaId || slot.tipo || 0),
      duracion: Number(slot.duration || 30),
      ubicacion: Number(branchId),
      pacienteExiste: pacienteExiste !== false, // default true for safety
      email: patientData.email || "",
      telefono: patientData.fono || patientData.telefono || "",
      nombre: patientData.nombres || "",
      apellidos: [patientData.apPaterno || "", patientData.apMaterno || ""].filter(Boolean).join(" "),
      direccion: patientData.direccion || "",
      sexo: patientData.sexo || "",
      fechaNacimiento: patientData.fechaNacimiento || patientData.nacimiento || "",
      aseguradora: patientData.prevision || "",
    });
    return {
      source: "antonia_booking_via_api_agendaweb",
      success: true,
      message: "Reserva realizada con éxito",
      appointmentId: result?.id || result?.cita_id || null,
      patient_reply: "Tu cita ha sido agendada con éxito. Revisa tu email para la confirmación.",
      raw: result,
    };
  } catch (agendawebError) {
    console.log("[medinet-api] bookAgendaweb failed, trying chatbot:", agendawebError.message);
  }

  // ── Tier 2: bookChatbot (JSON endpoint) ──
  const bookingPayload = {
    profesional_id: Number(slot.professionalId),
    date: slot.dataDia,
    hour: slot.time,
    duration: Number(slot.duration || 30),
    schedule_type_id: scheduleTypeId,
    branch_id: Number(branchId),
  };
  if (patientData?.nombres) bookingPayload.patient_name = `${patientData.nombres} ${patientData.apPaterno || ""} ${patientData.apMaterno || ""}`.trim();
  if (patientData?.email) bookingPayload.patient_email = patientData.email;
  if (patientData?.fono) bookingPayload.patient_phone = patientData.fono;
  if (patientData?.prevision) bookingPayload.patient_insurance = patientData.prevision;

  try {
    const result = await bookChatbot(bookingPayload);
    return {
      source: "antonia_booking_via_api_chatbot",
      success: true,
      message: "Reserva realizada con éxito",
      appointmentId: result?.id || result?.appointment_id || result?.cita_id || null,
      patient_reply: "Tu cita ha sido agendada con éxito. Revisa tu email para la confirmación.",
      raw: result,
    };
  } catch (chatbotError) {
    console.log("[medinet-api] bookChatbot failed, trying overschedule:", chatbotError.message);
  }

  // ── Tier 3: bookOverschedule (public API fallback) ──
  try {
    const result = await bookOverschedule(bookingPayload);
    return {
      source: "antonia_booking_via_api_overschedule",
      success: true,
      message: "Reserva realizada con éxito",
      appointmentId: result?.id || result?.appointment_id || null,
      patient_reply: "Tu cita ha sido agendada con éxito. Revisa tu email para la confirmación.",
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

// ─── API-first search (replaces Playwright for slot discovery) ──

const DEFAULT_BRANCH_ID = 39; // Mall Arauco Express

/**
 * Format RUT with dots and dash for the existe-run endpoint.
 * Input:  "13580388k" or "13580388-k" or "13.580.388-k"
 * Output: "13.580.388-k"
 */
function formatRutWithDots(rut) {
  const clean = String(rut || "").replace(/[.\-\s]/g, "").toUpperCase();
  if (clean.length < 2) return rut;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1).toLowerCase();
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted}-${dv}`;
}

/**
 * Specialty-based search: find available slots for any professional in a specialty.
 * Used when the user queries by specialty name (e.g. "nutricion", "medicina general")
 * instead of a professional name.
 */
async function searchSlotsBySpecialty({ specialtyId, specialtyQuery, branchId = DEFAULT_BRANCH_ID }) {
  const normalizedQuery = normalizeText(specialtyQuery);

  // Resolve specialty display name from the API or local map
  let specialtyName = Object.entries(SPECIALTY_IDS).find(([, id]) => id === specialtyId)?.[0] || normalizedQuery;
  // Capitalize first letter for display
  specialtyName = specialtyName.charAt(0).toUpperCase() + specialtyName.slice(1).toLowerCase();

  // Try chatbot-optimized endpoint first (returns slots across all professionals)
  let slots = [];
  try {
    const chatbotSlots = await fetchNextSlotsChatbot(branchId, specialtyId);
    if (Array.isArray(chatbotSlots) && chatbotSlots.length > 0) {
      for (const entry of chatbotSlots) {
        if (slots.length >= MAX_SLOTS) break;
        const date = entry.fecha || entry.date || entry.dia || "";
        const time = entry.hora || entry.hour || entry.time || "";
        if (!date || !time) continue;
        slots.push({
          date: isoToDisplayDate(date) || date,
          time,
          dataDia: date,
          professional: entry.profesional || null,
          professionalId: entry.profesional_id ? String(entry.profesional_id) : null,
          specialty: entry.especialidad || specialtyName,
          specialtyId,
          duration: entry.duracion || 30,
        });
      }
    }
  } catch (e) {
    console.log(`[medinet-api] searchSlotsBySpecialty chatbot(${branchId},${specialtyId}) failed:`, e.message);
  }

  // If chatbot returned nothing, try fetching professionals for this specialty and search each
  if (slots.length === 0) {
    try {
      const profs = await fetchProfessionalsBySpecialtyAndBranch(specialtyId, branchId);
      if (Array.isArray(profs) && profs.length > 0) {
        for (const prof of profs) {
          if (slots.length >= MAX_SLOTS) break;
          const profId = prof.id;
          const profName = `${prof.nombres || ""} ${prof.paterno || ""}`.trim();
          const tipoCita = Array.isArray(prof.tipos_cita) && prof.tipos_cita.length > 0 ? prof.tipos_cita[0] : null;
          if (!tipoCita) continue;

          try {
            const profSlots = await searchAvailableSlots({
              professionalId: profId,
              ubicacionId: branchId,
              especialidadId: specialtyId,
              tipocitaId: tipoCita.id,
              daysAhead: 14,
            });
            for (const s of profSlots) {
              if (slots.length >= MAX_SLOTS) break;
              slots.push({ ...s, specialty: specialtyName, specialtyId });
            }
          } catch { /* skip this professional */ }
        }
      }
    } catch (e) {
      console.log(`[medinet-api] searchSlotsBySpecialty profs fallback failed:`, e.message);
    }
  }

  // Build patient-facing reply
  let patient_reply = null;
  if (slots.length > 0) {
    const lines = slots.map((s, i) => {
      const profLabel = s.professional ? ` con ${s.professional}` : "";
      return `${i + 1}. ${s.date} a las ${s.time}${profLabel}`;
    });
    lines.push(`${slots.length + 1}. Salir`);
    patient_reply =
      `Encontré las siguientes horas disponibles en ${specialtyName}:\n\n` +
      lines.join("\n") +
      "\n\n¿Cuál prefieres?";
  }

  return {
    source: "api_specialty_search",
    professional: slots.length > 0 ? slots[0].professional : null,
    professionalId: slots.length > 0 ? slots[0].professionalId : null,
    specialty: specialtyName,
    specialtyId,
    available_slots: slots,
    patient_reply,
  };
}

/**
 * API-first professional search + slot discovery.
 * Uses only endpoints verified working with Token auth.
 *
 * Flow:
 *  1. findProfessional() → match by name (activos-list, public)
 *  1b. If no professional found, try findSpecialtyId() → specialty-based search
 *  2. fetchSpecialtiesForProfessional() → get specialty (Token auth)
 *  3. fetchAppointmentTypesByContext() → get tipo_cita (Token auth)
 *  4. fetchNextSlotsChatbot() → get available slots (Token auth)
 *  5. Falls back to fetchAvailableSlots() if chatbot endpoint has no data
 *
 * Returns object compatible with runMedinetAntonia response shape:
 *  { professional, specialty, available_slots, patient_reply, source }
 */
export async function searchSlotsViaApi({ query, branchId = DEFAULT_BRANCH_ID }) {
  const profMatch = await findProfessional(query);

  // If no professional matched, try specialty-based search
  if (!profMatch) {
    const specId = findSpecialtyId(query);
    if (specId) {
      return searchSlotsBySpecialty({ specialtyId: specId, specialtyQuery: query, branchId });
    }
    return {
      source: "api",
      professional: null,
      specialty: null,
      available_slots: [],
      patient_reply: null,
    };
  }

  const profName = profMatch.display || `${profMatch.nombres || ""} ${profMatch.paterno || ""}`.trim();
  const profId = profMatch.id;

  // Get specialty for this professional at this branch
  let specialties = [];
  try {
    specialties = await fetchSpecialtiesForProfessional(branchId, profId);
  } catch (e) {
    console.log(`[medinet-api] fetchSpecialtiesForProfessional(${branchId},${profId}) failed:`, e.message);
  }

  const specialty = Array.isArray(specialties) && specialties.length > 0 ? specialties[0] : null;
  const specialtyId = specialty?.id;
  const specialtyName = specialty?.nombre || "";

  if (!specialtyId) {
    // Professional found but no specialty at this branch — return name only
    return {
      source: "api",
      professional: profName,
      professionalId: profId,
      specialty: null,
      available_slots: [],
      patient_reply: null,
    };
  }

  // Try to get appointment types (needed for cupos-disponibles)
  let tipoCitaId = null;
  try {
    const tipos = await fetchAppointmentTypesByContext(branchId, specialtyId, profId, false);
    if (Array.isArray(tipos) && tipos.length > 0) {
      tipoCitaId = tipos[0].id;
    }
  } catch (e) {
    console.log(`[medinet-api] fetchAppointmentTypesByContext failed:`, e.message);
  }

  // Try chatbot-optimized slots endpoint first
  let slots = [];
  try {
    const chatbotSlots = await fetchNextSlotsChatbot(branchId, specialtyId);
    if (Array.isArray(chatbotSlots) && chatbotSlots.length > 0) {
      for (const entry of chatbotSlots) {
        if (slots.length >= MAX_SLOTS) break;
        const date = entry.fecha || entry.date || entry.dia || "";
        const time = entry.hora || entry.hour || entry.time || "";
        if (!date || !time) continue;
        // Filter for this specific professional if the endpoint returns all
        if (entry.profesional_id && entry.profesional_id !== profId) continue;
        slots.push({
          date: isoToDisplayDate(date) || date,
          time,
          dataDia: date,
          professional: entry.profesional || profName,
          professionalId: String(profId),
          specialty: entry.especialidad || specialtyName,
          duration: entry.duracion || 30,
        });
      }
    }
  } catch (e) {
    console.log(`[medinet-api] fetchNextSlotsChatbot(${branchId},${specialtyId}) failed:`, e.message);
  }

  // If chatbot endpoint returned no slots and we have tipoCitaId, try cupos-disponibles
  if (slots.length === 0 && tipoCitaId) {
    try {
      slots = await searchAvailableSlots({
        professionalId: profId,
        ubicacionId: branchId,
        especialidadId: specialtyId,
        tipocitaId: tipoCitaId,
        daysAhead: 14,
      });
    } catch (e) {
      console.log(`[medinet-api] searchAvailableSlots failed:`, e.message);
    }
  }

  // Build patient-facing reply
  let patient_reply = null;
  if (slots.length > 0) {
    const lines = slots.map((s, i) => `${i + 1}. ${s.date} a las ${s.time}`);
    lines.push(`${slots.length + 1}. Salir`);
    patient_reply =
      `Encontré las siguientes horas disponibles con ${profName} (${specialtyName}):\n\n` +
      lines.join("\n") +
      "\n\n¿Cuál prefieres?";
  }

  return {
    source: "api",
    professional: profName,
    professionalId: profId,
    specialty: specialtyName,
    specialtyId,
    tipoCitaId,
    available_slots: slots,
    patient_reply,
  };
}

/**
 * Build professionals cache entirely from API (no Playwright needed).
 * Uses activos-list (public) + get_por_profesional per professional.
 * Returns cache object compatible with the Playwright cache format.
 */
export async function buildCacheFromApi(branchId = DEFAULT_BRANCH_ID) {
  const professionals = await fetchActiveProfessionals();
  if (!Array.isArray(professionals) || !professionals.length) return null;

  const cached = [];
  for (const prof of professionals) {
    const name = prof.display || `${prof.nombres || ""} ${prof.paterno || ""}`.trim();
    let specialty = "";
    let specialtyId = "";

    try {
      const specs = await fetchSpecialtiesForProfessional(branchId, prof.id);
      if (Array.isArray(specs) && specs.length > 0) {
        specialty = specs[0].nombre || "";
        specialtyId = String(specs[0].id || "");
      }
    } catch {
      // Some professionals may not be at this branch
    }

    cached.push({
      id: String(prof.id),
      name,
      specialty,
      specialtyId,
      tipocita: "",
      duracion: "",
      alert_text: "",
      avatarUrl: "",
    });
  }

  return {
    branch: String(branchId),
    cachedAt: new Date().toISOString(),
    professionals: cached,
  };
}

export { formatRutWithDots, DEFAULT_BRANCH_ID };
