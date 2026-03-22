/**
 * Medinet REST API client — uses only validated public endpoints.
 *
 * Confirmed public (no auth needed):
 *   GET /api/profesional/activos-list/  → [{id, nombres, paterno, display}]
 *
 * All other /api/ endpoints require session auth (cookie-based) and are NOT
 * usable without a browser session. Playwright handles those flows.
 *
 * This module replaces the slow Playwright cache (~45s) with a fast API call (~1s)
 * for the professionals list, while Playwright continues to handle slot search and booking.
 */

const BASE_URL = "https://clinyco.medinetapp.com";
const ACTIVOS_LIST_PATH = "/api/profesional/activos-list/";

/**
 * Fetch all active professionals from the public API.
 * No authentication required.
 * @returns {Promise<Array<{id: number, nombres: string, paterno: string, display: string}>>}
 */
export async function fetchActiveProfessionals() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${BASE_URL}${ACTIVOS_LIST_PATH}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Medinet API GET ${ACTIVOS_LIST_PATH} → ${res.status}: ${text.slice(0, 200)}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Text normalization (matches server.js normalizeKey) ────────

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Find a professional by name/query from the public activos-list.
 * Uses the same fuzzy matching logic as server.js matchProfessionalFromCache.
 * @param {string} query - Professional name or partial name
 * @returns {Promise<{id: number, nombres: string, paterno: string, display: string}|null>}
 */
export async function findProfessional(query) {
  const normalized = normalizeText(query);
  if (!normalized) return null;

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
 * Build a professionals cache from the public API.
 * Returns array in the same shape as the Playwright cache for backward compatibility.
 * Fields that require auth (specialty, tipocita, etc.) are left empty — they'll be
 * populated when Playwright runs a search and overwrites the cache with full data.
 */
export async function buildProfessionalsCacheFromAPI() {
  const professionals = await fetchActiveProfessionals();
  if (!Array.isArray(professionals) || !professionals.length) return [];

  return professionals.map((prof) => {
    const name = prof.display || `${prof.nombres || ""} ${prof.paterno || ""}`.replace(/\s+/g, " ").trim();
    return {
      id: String(prof.id || ""),
      name,
      specialty: "",       // Not available from public API
      specialtyId: "",     // Not available from public API
      tipocita: "",        // Not available from public API
      duracion: "",        // Not available from public API
      alert_text: "",
      avatarUrl: "",
    };
  });
}
