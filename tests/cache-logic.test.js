/**
 * Unit tests for Medinet professionals cache logic.
 * Tests the matching, TTL, and dynamic KNOWN_AGENDA_PROFESSIONALS without needing Playwright.
 *
 * Run: node tests/cache-logic.test.js
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_CACHE_DIR = path.resolve(__dirname, ".test-cache-temp");
const TEMP_CACHE_FILE = path.join(TEMP_CACHE_DIR, "medinet_professionals_cache.json");

// ─── Helpers copied from server.js for isolated testing ───
function normalizeKey(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function matchProfessionalFromCache(text, professionals) {
  if (!Array.isArray(professionals) || !professionals.length) return null;
  const requested = normalizeKey(text);
  if (!requested) return null;

  let bestMatch = null;
  let bestPriority = 99;

  for (const prof of professionals) {
    const normalizedName = normalizeKey(prof.name || "");
    const normalizedSpecialty = normalizeKey(prof.specialty || "");
    const nameTokens = normalizedName.split(/\s+/).filter(Boolean);

    let priority = 99;
    if (normalizedName === requested) priority = 1;
    else if (normalizedName.startsWith(requested)) priority = 3;
    else if (normalizedName.includes(requested)) priority = 4;
    else if (normalizedSpecialty === requested) priority = 5;
    else if (normalizedSpecialty.includes(requested)) priority = 7;
    else if (nameTokens.some((t) => t === requested)) priority = 8;
    else if (nameTokens.some((t) => t.startsWith(requested) || requested.startsWith(t))) priority = 9;
    else {
      const requestedTokens = requested.split(/\s+/).filter(Boolean);
      if (requestedTokens.length >= 2 && requestedTokens.every((rt) => nameTokens.some((nt) => nt.includes(rt) || rt.includes(nt)))) {
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

// ─── Test Data ───
const SAMPLE_PROFESSIONALS = [
  { id: "1", name: "Rodrigo Villagran Leiva", specialty: "Cirugía Digestiva", specialtyId: "1" },
  { id: "2", name: "Nelson Aros Ojeda", specialty: "Cirugía General y Aparato Digestivo", specialtyId: "2" },
  { id: "3", name: "Peggy Huerta Pizarro", specialty: "Psicología", specialtyId: "7" },
  { id: "4", name: "Magaly Cerquera Perdomo", specialty: "Nutrición", specialtyId: "3" },
  { id: "5", name: "Katherine Saavedra Moreno", specialty: "Nutrición", specialtyId: "3" },
  { id: "6", name: "Edmundo Ziede Larrú", specialty: "Cirugía Plástica", specialtyId: "4" },
  { id: "7", name: "Francisca Naritelli González", specialty: "Psicología", specialtyId: "7" },
  { id: "8", name: "Ingrid Yévenes Moreno", specialty: "Nutriología", specialtyId: "5" },
  { id: "9", name: "Pablo Ramos Zamora", specialty: "Medicina Deportiva", specialtyId: "8" },
  { id: "10", name: "Carlos Núñez Fernández", specialty: "Medicina General", specialtyId: "9" },
  { id: "11", name: "Daniza Jaldín Vargas", specialty: "Pediatría", specialtyId: "10" },
  { id: "12", name: "Rodrigo Bancalari López", specialty: "Endocrinología Infantil", specialtyId: "11" },
];

// ─── Test Runner ───
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// ─── Tests ───

console.log("\n=== matchProfessionalFromCache tests ===\n");

// Exact full name
let match = matchProfessionalFromCache("Peggy Huerta Pizarro", SAMPLE_PROFESSIONALS);
assert(match?.id === "3", "exact full name: 'Peggy Huerta Pizarro' → id 3");

// Partial name (first + last)
match = matchProfessionalFromCache("peggy huerta", SAMPLE_PROFESSIONALS);
assert(match?.id === "3", "partial name: 'peggy huerta' → id 3");

// Single last name
match = matchProfessionalFromCache("villagran", SAMPLE_PROFESSIONALS);
assert(match?.id === "1", "single last name: 'villagran' → id 1");

// Single first name
match = matchProfessionalFromCache("peggy", SAMPLE_PROFESSIONALS);
assert(match?.id === "3", "single first name: 'peggy' → id 3");

// Specialty match
match = matchProfessionalFromCache("psicologia", SAMPLE_PROFESSIONALS);
assert(match?.id === "3" || match?.id === "7", "specialty: 'psicologia' → psicología professional");

// Accented query
match = matchProfessionalFromCache("Núñez", SAMPLE_PROFESSIONALS);
assert(match?.id === "10", "accented query: 'Núñez' → id 10");

// No match
match = matchProfessionalFromCache("dr fantasma", SAMPLE_PROFESSIONALS);
assert(match === null, "no match: 'dr fantasma' → null");

// Empty query
match = matchProfessionalFromCache("", SAMPLE_PROFESSIONALS);
assert(match === null, "empty query → null");

// Empty list
match = matchProfessionalFromCache("peggy", []);
assert(match === null, "empty professionals list → null");

// Case insensitive
match = matchProfessionalFromCache("EDMUNDO ZIEDE", SAMPLE_PROFESSIONALS);
assert(match?.id === "6", "case insensitive: 'EDMUNDO ZIEDE' → id 6");

// Starts with match
match = matchProfessionalFromCache("Rodrigo V", SAMPLE_PROFESSIONALS);
assert(match?.id === "1", "starts with: 'Rodrigo V' → id 1 (Villagran)");

// Two-token partial
match = matchProfessionalFromCache("nelson aros", SAMPLE_PROFESSIONALS);
assert(match?.id === "2", "two-token: 'nelson aros' → id 2");

// Specialty partial
match = matchProfessionalFromCache("nutricion", SAMPLE_PROFESSIONALS);
assert(match?.id === "4" || match?.id === "5", "specialty partial: 'nutricion' → a Nutrición professional");

console.log("\n=== Cache file I/O tests ===\n");

// Write and read cache
mkdirSync(TEMP_CACHE_DIR, { recursive: true });
const cachePayload = {
  cachedAt: new Date().toISOString(),
  branch: "Antofagasta Mall Arauco Express",
  professionals: SAMPLE_PROFESSIONALS,
};
writeFileSync(TEMP_CACHE_FILE, JSON.stringify(cachePayload, null, 2) + "\n", "utf8");

const read = JSON.parse(readFileSync(TEMP_CACHE_FILE, "utf8"));
assert(read.professionals.length === 12, "cache file written and read: 12 professionals");
assert(!!read.cachedAt, "cache file has cachedAt timestamp");
assert(read.branch === "Antofagasta Mall Arauco Express", "cache file has correct branch");

console.log("\n=== TTL staleness tests ===\n");

// Fresh cache (just created)
const freshAge = Date.now() - new Date(read.cachedAt).getTime();
assert(freshAge < 5000, `fresh cache age is ${freshAge}ms (< 5s)`);
assert(freshAge < 30 * 60 * 1000, "fresh cache is NOT stale");

// Simulate stale cache (35 minutes ago)
const stalePayload = {
  ...cachePayload,
  cachedAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
};
writeFileSync(TEMP_CACHE_FILE, JSON.stringify(stalePayload, null, 2) + "\n", "utf8");

const staleRead = JSON.parse(readFileSync(TEMP_CACHE_FILE, "utf8"));
const staleAge = Date.now() - new Date(staleRead.cachedAt).getTime();
assert(staleAge > 30 * 60 * 1000, `stale cache age is ${Math.round(staleAge / 60000)}min (> 30min) → IS stale`);

console.log("\n=== Dynamic KNOWN_AGENDA_PROFESSIONALS tests ===\n");

const FALLBACK = [
  "RODRIGO VILLAGRAN", "NELSON AROS", "PEGGY HUERTA", "EDMUNDO ZIEDE",
];

function buildKnownAgendaProfessionals(professionals, fallback) {
  const names = new Set(fallback);
  if (Array.isArray(professionals)) {
    for (const prof of professionals) {
      if (prof.name) names.add(normalizeKey(prof.name));
    }
  }
  return names;
}

const dynamic = buildKnownAgendaProfessionals(SAMPLE_PROFESSIONALS, FALLBACK);
assert(dynamic.has("RODRIGO VILLAGRAN"), "fallback name preserved: RODRIGO VILLAGRAN");
assert(dynamic.has("PEGGY HUERTA PIZARRO"), "cache name added: PEGGY HUERTA PIZARRO");
assert(dynamic.has("DANIZA JALDIN VARGAS"), "cache name added: DANIZA JALDIN VARGAS");
assert(dynamic.size > FALLBACK.length, `dynamic set (${dynamic.size}) > fallback (${FALLBACK.length})`);

// With empty cache
const emptyDynamic = buildKnownAgendaProfessionals([], FALLBACK);
assert(emptyDynamic.size === FALLBACK.length, "empty cache → fallback only");

// Cleanup
rmSync(TEMP_CACHE_DIR, { recursive: true, force: true });

// ─── Summary ───
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("=".repeat(40));
process.exitCode = failed > 0 ? 1 : 0;
