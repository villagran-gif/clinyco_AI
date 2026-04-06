/**
 * test-medinet-api.js — Prueba paso a paso las funciones de Medinet API
 * como si fuera una solicitud real de agendamiento.
 *
 * Usage: node scripts/test-medinet-api.js
 *
 * Paciente ficticio para testing:
 *   RUT: 12.345.678-5
 *   Nombre: Maria Test Gonzalez
 */
import "dotenv/config";

import {
  checkCupos,
  fetchActiveBranches,
  fetchSpecialtiesByBranchNoAuth,
  fetchProximosCuposAll,
  fetchProximosCupos,
  searchSlotsViaApi,
  searchSlotsNoAuth,
  findProfessional,
  findSpecialtyId,
  checkPatientByRut,
  formatRutWithDots,
  DEFAULT_BRANCH_ID,
} from "../Antonia/medinet-api.js";

const TEST_RUT = "6.469.664-5";
const BRANCH_ID = DEFAULT_BRANCH_ID; // Antofagasta

function log(label, data) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"═".repeat(60)}`);
  if (data instanceof Error) {
    console.log(`  ❌ ERROR: ${data.message}`);
  } else if (data === null || data === undefined) {
    console.log(`  ⚠️  null/undefined`);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function safeCall(label, fn) {
  try {
    const result = await fn();
    log(`✅ ${label}`, result);
    return result;
  } catch (err) {
    log(`❌ ${label}`, err);
    return null;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  TEST MEDINET API — Simulacion de agendamiento         ║");
  console.log("║  Paciente: prueba6 prueba6                              ║");
  console.log("║  RUT: 6.469.664-5                                      ║");
  console.log("║  Branch: Antofagasta (ID: " + BRANCH_ID + ")                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // PASO 1: Listar sucursales disponibles
  const branches = await safeCall("PASO 1: fetchActiveBranches()", () =>
    fetchActiveBranches()
  );

  // PASO 2: Listar especialidades de la sucursal (NO AUTH)
  const specialties = await safeCall(
    `PASO 2: fetchSpecialtiesByBranchNoAuth(${BRANCH_ID})`,
    () => fetchSpecialtiesByBranchNoAuth(BRANCH_ID)
  );

  // PASO 3: Verificar cupos del paciente (NO AUTH)
  const cupos = await safeCall(
    `PASO 3: checkCupos(${BRANCH_ID}, "${TEST_RUT}")`,
    () => checkCupos(BRANCH_ID, TEST_RUT)
  );

  // PASO 4: Verificar si paciente existe por RUT
  const patientExists = await safeCall(
    `PASO 4: checkPatientByRut("${TEST_RUT}")`,
    () => checkPatientByRut(TEST_RUT)
  );

  // PASO 5: Buscar especialidad "nutricion"
  const nutricionId = await safeCall(
    'PASO 5: findSpecialtyId("nutricion")',
    () => findSpecialtyId("nutricion")
  );

  // PASO 6: Proximos cupos ALL (NO AUTH) — todos los profesionales
  const cuposAll = await safeCall(
    `PASO 6: fetchProximosCuposAll(${BRANCH_ID})`,
    () => fetchProximosCuposAll(BRANCH_ID)
  );

  // PASO 7: Proximos cupos por especialidad (NO AUTH)
  if (nutricionId) {
    await safeCall(
      `PASO 7: fetchProximosCupos(${BRANCH_ID}, ${nutricionId})`,
      () => fetchProximosCupos(BRANCH_ID, nutricionId)
    );
  } else {
    log("⏭️  PASO 7: SKIP", "No se encontro especialidad nutricion");
  }

  // PASO 8: Buscar profesional "nutriologia" (como haria Antonia)
  const prof = await safeCall(
    'PASO 8: findProfessional("nutriologia")',
    () => findProfessional("nutriologia")
  );

  // PASO 9: Buscar slots via API (con auth)
  await safeCall(
    `PASO 9: searchSlotsViaApi({ query: "nutriologia", branchId: ${BRANCH_ID} })`,
    () => searchSlotsViaApi({ query: "nutriologia", branchId: BRANCH_ID })
  );

  // PASO 10: Buscar slots sin auth (fallback)
  await safeCall(
    `PASO 10: searchSlotsNoAuth({ query: "nutriologia", branchId: ${BRANCH_ID} })`,
    () => searchSlotsNoAuth({ query: "nutriologia", branchId: BRANCH_ID })
  );

  console.log("\n" + "═".repeat(60));
  console.log("  TEST COMPLETO");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
