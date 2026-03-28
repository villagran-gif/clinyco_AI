/**
 * Medinet REST API client — replaces Playwright browser automation.
 *
 * Auth (two layers):
 *   /api-public/*  → "Authorization: MEDINET_JWT <jwt>" via POST /token-login/ (username/password)
 *                     Falls back to "Authorization: Token <MEDINET_API_TOKEN>" if JWT env vars not set.
 *   /api/*          → "Authorization: Token <MEDINET_API_TOKEN>"
 *                     Falls back to Api-Key header or Cookie session.
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
 *   GET  /api/agenda/citas/proximos-cupos-all/{ubi}/                        → all profs + next slots (NO AUTH)
 *   GET  /api/agenda/citas/proximos-cupos/{ubi}/{esp}/                     → profs + next slots by specialty (NO AUTH)
 *   GET  /api/especialidad/get_por_ubicacion/{ubi}/                        → specialties by branch (NO AUTH)
 *   GET  /api/agenda/citas/get-check-cupos/{ubi}/?identifier={rut}          → check cupos (NO AUTH)
 *   POST /api/agenda/citas/agendaweb-add/                                  → book via agendaweb (NO AUTH, form-urlencoded)
 *   POST /api-public/schedule/appointment/add-overschedule/                → book (public API)
 *   GET  /api-public/schedule/appointment/all-appointments/{from}/{to}/
 *   GET  /api-public/schedule/appointment/{id}/
 *   POST /api-public/schedule/appointment/update-appointment-state/{id}/
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

// ─── JWT Auth (for /api-public/* endpoints) ─────────────────────

let _jwtToken = null;
let _jwtExpiresAt = 0;

/**
 * Authenticate via POST /token-login/ and cache the JWT.
 * Requires MEDINET_JWT_USERNAME and MEDINET_JWT_PASSWORD env vars.
 */
async function loginJwt() {
  const username = process.env.MEDINET_JWT_USERNAME;
  const password = process.env.MEDINET_JWT_PASSWORD;
  if (!username || !password) {
    throw new Error("MEDINET_JWT_USERNAME and MEDINET_JWT_PASSWORD are required for JWT auth");
  }

  const res = await fetch(`${BASE_URL}/token-login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Medinet JWT login failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  _jwtToken = data.token;
  if (!_jwtToken) throw new Error("Medinet /token-login/ did not return a token");
  // Cache for ~22h (conservative; actual expiry may differ)
  _jwtExpiresAt = Date.now() + 22 * 60 * 60 * 1000;
  return _jwtToken;
}

async function getJwtToken() {
  if (_jwtToken && Date.now() < _jwtExpiresAt) return _jwtToken;
  return loginJwt();
}

function clearJwtToken() {
  _jwtToken = null;
  _jwtExpiresAt = 0;
}

/**
 * Build auth headers.
 *
 * /api-public/* → MEDINET_JWT via /token-login/ (preferred), falls back to Token auth.
 * /api/*        → Token auth (primary), falls back to Api-Key or Cookie.
 *
 * Verified working with Token auth (2026-03-25):
 *   /api/profesional/activos-list/                    (also works unauthenticated)
 *   /api/especialidad/get_por_ubicacion/{id}/
 *   /api/especialidad/get_por_profesional/{ubi}/{prof}/
 *   /api/pacientes/existe-run/?run=XX.XXX.XXX-X
 *   /api/agenda/citas/proximos-cupos-chatbot/{ubi}/{esp}/
 *   /api/agenda/tipocita/get-by-branch-specialty-and-professional/{b}/{e}/{p}/{r}/
 *
 * Verified working with MEDINET_JWT auth (2026-03-27):
 *   /api-public/schedule/appointment/all-appointments/{from}/{to}/
 *   /api-public/schedule/appointment/{id}/
 *   /api-public/schedule/appointment/update-appointment-state/{id}/
 *   /api-public/schedule/appointment/add-overschedule/
 */
async function buildHeaders(path) {
  const h = { "Content-Type": "application/json" };

  // /api-public/* and /api/v2/* endpoints use JWT auth (MEDINET_JWT prefix)
  if (path.startsWith("/api-public/") || path.startsWith("/api/v2/")) {
    try {
      const jwt = await getJwtToken();
      h.Authorization = `MEDINET_JWT ${jwt}`;
      return h;
    } catch {
      // JWT not configured — fall through to static Token auth
    }
  }

  // /api/* endpoints and fallback: use static Token auth
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
    // Add auth — JWT for /api-public/, Token for /api/
    try {
      if (path.startsWith("/api-public/")) {
        const jwt = await getJwtToken();
        h.Authorization = `MEDINET_JWT ${jwt}`;
      } else {
        h.Authorization = `Token ${getToken()}`;
      }
    } catch { /* no auth available */ }

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
      headers: await buildHeaders(path),
      signal: controller.signal,
    };
    if (body) options.body = JSON.stringify(body);

    let res = await fetch(url, options);

    // Auto-refresh JWT on 401 for /api-public/ and /api/v2/ endpoints (single retry)
    if (res.status === 401 && (path.startsWith("/api-public/") || path.startsWith("/api/v2/")) && _jwtToken) {
      clearJwtToken();
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), timeout);
      try {
        options.headers = await buildHeaders(path);
        options.signal = controller2.signal;
        res = await fetch(url, options);
      } finally {
        clearTimeout(timer2);
      }
    }

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
  return apiFetch(`/api/pacientes/autocomplete/filter/?query=${encodeURIComponent(query)}`);
}

/** Get full patient profile by ID (buscador-general) */
export async function fetchPatientProfile(patientId) {
  return apiFetch(`/api/pacientes/${patientId}/buscador-general/`);
}

/**
 * Lookup patient by RUT: autocomplete → buscador-general.
 * Returns combined patient data or null if not found.
 */
export async function lookupPatientByRut(rut) {
  const cleanRut = String(rut || "").replace(/[.\-\s]/g, "");
  if (!cleanRut) return null;

  const results = await searchPatients(cleanRut);
  if (!Array.isArray(results) || results.length === 0) return null;

  const match = results[0];
  const profile = await fetchPatientProfile(match.id).catch(() => null);

  return {
    patientId: match.id,
    nombre: match.nombre || "",
    run: match.run || "",
    email: match.email || profile?.data?.email || "",
    phone: match.phone || profile?.data?.telefono_movil || "",
    insurer: match.insurer || "",
    profile: profile?.data || null,
  };
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
 * No auth/token required — uses apiFormPost (form-urlencoded + XMLHttpRequest).
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

    // Patient data — send when available (required for new patients,
    // for existing patients backend looks them up by RUN)
    nombre: opts.pacienteExiste ? "" : (opts.nombre || ""),
    apellidos: opts.pacienteExiste ? "" : (opts.apellidos || ""),
    direccion: opts.pacienteExiste ? "" : (opts.direccion || ""),
    sexo: opts.pacienteExiste ? "" : (opts.sexo || ""),
    fecha_nacimiento: opts.pacienteExiste ? "" : (opts.fechaNacimiento || ""),
    aseguradora: opts.pacienteExiste ? "" : (opts.aseguradora || ""),

    telefono_fijo: opts.telefono || "",
    email: opts.email || "",
    run: opts.run,
    ubicacion: String(opts.ubicacion),
    desde_agendaweb: "true",
    is_patient_created_from_two_factor: "false",
  });

  const res = await fetch(`${BASE_URL}/api/agenda/citas/agendaweb-add/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json",
    },
    body: params.toString(),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`agendaweb-add ${res.status}: ${text.slice(0, 300)}`);
    err.httpStatus = res.status;
    err.responseBody = data;
    throw err;
  }

  return data;
}

// ─── Business error helpers for agendaweb-add ──────────────────

function isAgendawebBusinessFailure(result) {
  const status = String(result?.status || "").toLowerCase();
  const message = String(result?.message || "").toLowerCase();

  return (
    status === "cupo_tomado" ||
    status === "slot_not_found" ||
    message.includes("no tiene cupo") ||
    message.includes("hora seleccionada") ||
    message.includes("slot") ||
    message.includes("sin cupo")
  );
}

function isAgendawebBusinessError(error) {
  const body = error?.responseBody || {};
  const status = String(body?.status || "").toLowerCase();
  const message = String(body?.message || error?.message || "").toLowerCase();

  return (
    status === "cupo_tomado" ||
    status === "slot_not_found" ||
    message.includes("no tiene cupo") ||
    message.includes("hora seleccionada") ||
    message.includes("sin cupo") ||
    message.includes("slot")
  );
}

// ─── No-auth slot search endpoints ──────────────────────────────

/**
 * Full API-only slot search. No auth required.
 * Returns ALL professionals + next available slots for a branch.
 * Response: [{ id, nombres, paterno, especialidad, especialidad_id, tipo_cita,
 *   duracion_cita, avatar_url, agendaweb_alert, is_resource,
 *   cupos: [{ fecha: "YYYY-MM-DD", horas: ["HH:MM", ...] }] }]
 */
export async function fetchProximosCuposAll(ubicacionId) {
  return noAuthFetch(
    `/api/agenda/citas/proximos-cupos-all/${ubicacionId}/`,
    { timeout: 20000 }
  );
}

/**
 * Slot search filtered by specialty. No auth required.
 * Same response shape as proximos-cupos-all but filtered to one specialty.
 */
export async function fetchProximosCupos(ubicacionId, especialidadId) {
  return noAuthFetch(
    `/api/agenda/citas/proximos-cupos/${ubicacionId}/${especialidadId}/`,
    { timeout: 20000 }
  );
}

/**
 * Fetch specialties for a branch. No auth required.
 * Response: [{ id, nombre, ubicaciones, ... }]
 */
export async function fetchSpecialtiesByBranchNoAuth(ubicacionId) {
  return noAuthFetch(
    `/api/especialidad/get_por_ubicacion/${ubicacionId}/`,
    { timeout: 10000 }
  );
}

// ─── Appointments (query / manage) ─────────────────────────────

/**
 * Get all appointments in a date range.
 * @param {string} startDate "YYYY-MM-DD"
 * @param {string} endDate   "YYYY-MM-DD"
 * @param {object} [opts]
 * @param {number} [opts.branchId]  Filter by sucursal (branch_id query param)
 * @param {number} [opts.statusId]  Filter by estado (status_id query param)
 */
export async function fetchAllAppointments(startDate, endDate, { branchId, statusId } = {}) {
  const params = new URLSearchParams();
  if (branchId != null) params.set("branch_id", String(branchId));
  if (statusId != null) params.set("status_id", String(statusId));
  const qs = params.toString();
  const path = `/api-public/schedule/appointment/all-appointments/${startDate}/${endDate}/${qs ? `?${qs}` : ""}`;
  return apiFetch(path, { timeout: 20000 });
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
 * @param {string} [observation]  Optional note (e.g. "Confirmado vía WhatsApp")
 */
export async function updateAppointmentState(appointmentId, action, observation) {
  const body = { action };
  if (observation) body.observation = observation;
  return apiFetch(`/api-public/schedule/appointment/update-appointment-state/${appointmentId}/`, {
    method: "POST",
    body,
  });
}

/** Delete an overschedule appointment */
export async function deleteOverschedule(appointmentId) {
  return apiFetch(`/api-public/schedule/appointment/${appointmentId}/delete-overschedule/`, {
    method: "DELETE",
  });
}

// ─── High-level helpers (used by server.js) ─────────────────────

const MAX_SLOTS = 6;

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
export async function bookAppointmentForPatient({
  slot,
  patientData,
  branchId = DEFAULT_BRANCH_ID,
  pacienteExiste = true,
}) {
  const run = formatRutWithDots(patientData?.run || patientData?.rut || "");
  const email = patientData?.email || "";
  const telefono = patientData?.fono || patientData?.telefono || "";
  const duration = Number(slot?.duration || 30);
  const specialtyId = Number(slot?.specialtyId || slot?.especialidad || 0);
  const tipoCitaId = Number(slot?.tipoCitaId || slot?.tipo || 0);
  const professionalId = Number(slot?.professionalId || slot?.profesional || 0);

  if (!run || !slot?.dataDia || !slot?.time || !specialtyId || !tipoCitaId || !professionalId) {
    return {
      success: false,
      source: "antonia_booking_invalid_input",
      message: "Faltan datos obligatorios para reservar.",
      patient_reply: "No pude completar la reserva porque faltan datos de la hora seleccionada.",
    };
  }

  // 1) agendaweb-add (API pública sin token, probada)
  try {
    const agendawebResult = await bookAgendaweb({
      run,
      fecha: slot.dataDia,
      hora: slot.time,
      profesional: professionalId,
      especialidad: specialtyId,
      tipo: tipoCitaId,
      duracion: duration,
      ubicacion: branchId,
      email,
      telefono,
      pacienteExiste,
      nombre: patientData?.nombres || "",
      apellidos: [patientData?.apPaterno, patientData?.apMaterno].filter(Boolean).join(" "),
      direccion: patientData?.direccion || "",
      sexo: patientData?.sexo || "",
      fechaNacimiento: patientData?.nacimiento || patientData?.fechaNacimiento || "",
      aseguradora: patientData?.prevision || patientData?.aseguradora || "",
    });

    if (agendawebResult?.status === "agendado_correctamente") {
      return {
        success: true,
        source: "antonia_booking_via_api_agendaweb",
        message: "Reserva completada correctamente.",
        patient_reply: `Tu hora quedó agendada para el ${slot.date || slot.dataDia} a las ${slot.time}.`,
        booking: agendawebResult,
      };
    }

    // Si agendaweb respondió, pero con error de negocio, NO continuar a overschedule/chatbot
    if (isAgendawebBusinessFailure(agendawebResult)) {
      return {
        success: false,
        source: "antonia_booking_via_api_agendaweb",
        message: agendawebResult?.message || "La hora seleccionada ya no tiene cupo.",
        patient_reply: agendawebResult?.message || "La hora seleccionada ya no está disponible. ¿Quieres que busque otra?",
        booking: agendawebResult,
      };
    }

    // Si vino una respuesta rara, la tratamos como error técnico y seguimos a fallback controlado
    console.warn("[medinet-api] agendaweb-add unexpected response:", agendawebResult);
  } catch (error) {
    if (isAgendawebBusinessError(error)) {
      return {
        success: false,
        source: "antonia_booking_via_api_agendaweb",
        message: error?.responseBody?.message || "La hora seleccionada ya no tiene cupo.",
        patient_reply: error?.responseBody?.message || "La hora seleccionada ya no está disponible. ¿Quieres que busque otra?",
      };
    }

    console.warn("[medinet-api] agendaweb-add technical error:", error.message);
  }

  // 2) chatbot endpoint
  try {
    const chatbotResult = await bookChatbot({
      slot,
      patientData: { ...patientData, run },
      branchId,
    });

    if (chatbotResult?.status === true || chatbotResult?.success === true) {
      return {
        success: true,
        source: "antonia_booking_via_api_chatbot",
        message: "Reserva completada por API chatbot.",
        patient_reply: `Tu hora quedó agendada para el ${slot.date || slot.dataDia} a las ${slot.time}.`,
        booking: chatbotResult,
      };
    }
  } catch (error) {
    console.warn("[medinet-api] chatbot booking error:", error.message);
  }

  // 3) overschedule
  try {
    const overscheduleResult = await bookOverschedule({
      slot,
      patientData: { ...patientData, run },
      branchId,
    });

    if (overscheduleResult?.status === true || overscheduleResult?.success === true) {
      return {
        success: true,
        source: "antonia_booking_via_api_overschedule",
        message: "Reserva completada por overschedule.",
        patient_reply: `Tu hora quedó agendada para el ${slot.date || slot.dataDia} a las ${slot.time}.`,
        booking: overscheduleResult,
      };
    }

    return {
      success: false,
      source: "antonia_booking_via_api_overschedule",
      message: overscheduleResult?.message || "No se pudo reservar la hora.",
      patient_reply: overscheduleResult?.message || "No pude completar la reserva. ¿Quieres que busque otra hora?",
      booking: overscheduleResult,
    };
  } catch (error) {
    return {
      success: false,
      source: "antonia_booking_via_api_overschedule",
      message: error.message,
      patient_reply: "No pude completar la reserva por API. ¿Quieres que intente otra alternativa?",
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

  // If chatbot returned nothing, find professionals for this specialty via full list
  // (fetchProfessionalsFull works with Token auth; get_por_especialidad does not)
  if (slots.length === 0) {
    try {
      const fullList = await fetchProfessionalsFull();
      // Filter to professionals that have this specialty at this branch
      const matching = (Array.isArray(fullList) ? fullList : []).filter((prof) => {
        if (!prof.es_activo || !prof.permite_agendaweb) return false;
        const suc_esps = prof.sucursal_especialidades || [];
        return suc_esps.some(
          (se) => se.especialidad?.id === specialtyId && se.ubicacion?.id === branchId
        );
      });

      for (const prof of matching) {
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
            slots.push({ ...s, professional: s.professional || profName, specialty: specialtyName, specialtyId });
          }
        } catch (e2) {
          console.log(`[medinet-api] searchSlotsBySpecialty prof ${profId} slots failed:`, e2.message);
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

// ─── No-auth search (uses proximos-cupos, 0 token needed) ──────

const MAX_NOAUTH_SLOTS = 3;

/**
 * Search for available slots using only no-auth endpoints.
 * Uses proximos-cupos-all (all specialties) or proximos-cupos (filtered by specialty).
 *
 * Flow:
 *  1. fetchProximosCuposAll or fetchProximosCupos → professionals + next slots
 *  2. Match query against professional names and specialties
 *  3. Return slots in the same format as searchSlotsViaApi
 *
 * @param {object} opts
 * @param {string} opts.query          - Professional name or specialty to search
 * @param {number} [opts.branchId=39]  - Branch ID
 * @returns Same shape as searchSlotsViaApi: { professional, specialty, available_slots, patient_reply, source }
 */
export async function searchSlotsNoAuth({ query, branchId = DEFAULT_BRANCH_ID }) {
  const normalized = normalizeText(query);
  if (!normalized) {
    return { source: "api_noauth", professional: null, specialty: null, available_slots: [], patient_reply: null };
  }

  // Step 1: Check if query matches a known specialty
  const specId = findSpecialtyId(query);

  // Step 2: Fetch data — filtered by specialty if we know it, otherwise all
  let professionals;
  try {
    professionals = specId
      ? await fetchProximosCupos(branchId, specId)
      : await fetchProximosCuposAll(branchId);
  } catch (e) {
    console.log(`[medinet-api] searchSlotsNoAuth fetch failed:`, e.message);
    return { source: "api_noauth", professional: null, specialty: null, available_slots: [], patient_reply: null };
  }

  if (!Array.isArray(professionals) || !professionals.length) {
    return { source: "api_noauth", professional: null, specialty: specId ? normalized : null, available_slots: [], patient_reply: null };
  }

  // Step 3: Match query against professional names (if not a specialty search)
  let matched = professionals;
  if (!specId) {
    const queryTokens = normalized.split(/\s+/).filter(Boolean);

    const scored = professionals.map((prof) => {
      const display = normalizeText(`${prof.nombres || ""} ${prof.paterno || ""}`);
      const specName = normalizeText(prof.especialidad || "");
      let score = 0;

      // Exact display match
      if (display === normalized) score = 100;
      // All query tokens found in name
      else if (queryTokens.length >= 2 && queryTokens.every((t) => display.includes(t))) score = 90;
      // Display starts with query
      else if (display.startsWith(normalized)) score = 80;
      // Display contains query
      else if (display.includes(normalized)) score = 70;
      // Any token matches
      else if (queryTokens.some((t) => display.includes(t))) score = 50;
      // Specialty matches
      else if (specName.includes(normalized) || normalized.includes(specName)) score = 40;

      return { prof, score };
    });

    scored.sort((a, b) => b.score - a.score);
    matched = scored.filter((s) => s.score > 0).map((s) => s.prof);

    if (!matched.length) {
      return { source: "api_noauth", professional: null, specialty: null, available_slots: [], patient_reply: null };
    }
  }

  // Step 4: Build slots from matched professionals
  const slots = [];
  for (const prof of matched) {
    if (slots.length >= MAX_NOAUTH_SLOTS) break;
    const cupos = prof.cupos || [];
    const profName = `${prof.nombres || ""} ${prof.paterno || ""}`.trim();

    for (const cupo of cupos) {
      if (slots.length >= MAX_NOAUTH_SLOTS) break;
      const horas = cupo.horas || [];
      for (const hora of horas) {
        if (slots.length >= MAX_NOAUTH_SLOTS) break;
        slots.push({
          date: isoToDisplayDate(cupo.fecha) || cupo.fecha,
          time: hora,
          dataDia: cupo.fecha,
          professional: profName,
          professionalId: String(prof.id),
          specialty: prof.especialidad || "",
          specialtyId: prof.especialidad_id || null,
          tipoCitaId: prof.tipo_cita || null,
          duration: prof.duracion_cita || 30,
        });
      }
    }
  }

  // Step 5: Build patient reply
  let patient_reply = null;
  if (slots.length > 0) {
    const isSpecialtySearch = !!specId;
    const label = isSpecialtySearch
      ? (slots[0].specialty || normalized)
      : `${slots[0].professional} (${slots[0].specialty})`;

    const lines = slots.map((s, i) => {
      const profLabel = isSpecialtySearch ? ` con ${s.professional}` : "";
      return `${i + 1}. ${s.date} a las ${s.time}${profLabel}`;
    });
    lines.push(`${slots.length + 1}. Salir`);

    patient_reply =
      `Encontré las siguientes horas disponibles${isSpecialtySearch ? ` en ${label}` : ` con ${label}`}:\n\n` +
      lines.join("\n") +
      "\n\n¿Cuál prefieres?";
  }

  return {
    source: "api_noauth",
    professional: slots.length > 0 ? slots[0].professional : null,
    professionalId: slots.length > 0 ? slots[0].professionalId : null,
    specialty: slots.length > 0 ? slots[0].specialty : (specId ? normalized : null),
    specialtyId: slots.length > 0 ? slots[0].specialtyId : specId,
    tipoCitaId: slots.length > 0 ? slots[0].tipoCitaId : null,
    available_slots: slots,
    patient_reply,
  };
}

// ─── Payments (JWT) ──────────────────────────────────────────────

export async function registerPayment(appointmentId, data) {
  return apiFetch(`/api-public/schedule/appointment/${appointmentId}/register-payment/`, {
    method: "POST",
    body: data,
  });
}

export async function fetchPaymentMethods() {
  return apiFetch("/api-public/billing/payments-methods/all/");
}

export { loginJwt, formatRutWithDots, DEFAULT_BRANCH_ID };
