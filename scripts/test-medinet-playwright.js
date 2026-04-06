/**
 * test-medinet-playwright.js — Prueba paso a paso Medinet via Playwright
 * Ejecuta medinet-antonia.cjs en cada modo y logea resultados.
 *
 * Paciente ficticio (existe en Medinet, NO es real):
 *   RUT: 6.469.664-5
 *   Nombre: prueba6 prueba6
 *
 * Usage: cd ~/clinyco_AI && source .env && node scripts/test-medinet-playwright.js
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { accessSync, constants as fsConstants } from "fs";

const execFileAsync = promisify(execFile);

// ── Resolve script path ──
function resolveScript() {
  const base = fileURLToPath(new URL("../Antonia/", import.meta.url));
  for (const name of ["medinet-antonia.cjs", "medinet-antonia.js"]) {
    try { accessSync(base + name, fsConstants.R_OK); return base + name; } catch { /* skip */ }
  }
  return base + "medinet-antonia.cjs";
}

const SCRIPT = resolveScript();
const MEDINET_RUT = process.env.MEDINET_RUT || "13580388k";

// ── Paciente ficticio ──
const PATIENT = {
  rut: "6.469.664-5",
  nombres: "prueba6",
  apPaterno: "prueba6",
  apMaterno: "",
  nacimiento: "08/09/1979",
  email: "villagran@clinyco.cl",
  fono: "+56912345678",
  prevision: "BANMEDICA",
  direccion: "zucovic, ALGARROBO",
};

function log(step, label, data) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  PASO ${step}: ${label}`);
  console.log(`  Script: ${SCRIPT}`);
  console.log(`${"═".repeat(70)}`);
  if (data instanceof Error) {
    console.log(`  ❌ ERROR: ${data.message}`);
    if (data.stderr) console.log(`  STDERR: ${data.stderr.slice(-500)}`);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function runPlaywright(step, label, envOverrides, timeoutMs = 60000) {
  const env = {
    ...process.env,
    MEDINET_RUT,
    MEDINET_HEADED: "false",
    ...envOverrides,
  };

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  PASO ${step}: ${label}`);
  console.log(`  Script: ${SCRIPT}`);
  console.log(`  Env vars enviadas:`);
  for (const [k, v] of Object.entries(envOverrides)) {
    console.log(`    ${k} = ${v}`);
  }
  console.log(`  Timeout: ${timeoutMs}ms`);
  console.log(`${"═".repeat(70)}`);

  try {
    const { stdout, stderr } = await execFileAsync("node", [SCRIPT], {
      env,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr) {
      console.log(`  ⚠️  STDERR (ultimos 500 chars):`);
      console.log(`  ${stderr.slice(-500)}`);
    }

    // Buscar ANTONIA_RESPONSE en stdout
    const match = stdout.match(/ANTONIA_RESPONSE\s+(\{[\s\S]*\})/);
    if (match) {
      const result = JSON.parse(match[1]);
      console.log(`  ✅ ANTONIA_RESPONSE encontrada:`);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    // Buscar MEDINET_PAGE_DIAGNOSTIC (error diagnostico)
    const diagMatch = stdout.match(/MEDINET_PAGE_DIAGNOSTIC\s+(\{[\s\S]*?\n\})/);
    if (diagMatch) {
      const diag = JSON.parse(diagMatch[1]);
      console.log(`  ⚠️  MEDINET_PAGE_DIAGNOSTIC (pagina no cargo correctamente):`);
      console.log(JSON.stringify(diag, null, 2));
      return { error: "diagnostic", diagnostic: diag };
    }

    // No se encontro respuesta estructurada
    console.log(`  ⚠️  Sin ANTONIA_RESPONSE. Stdout (ultimos 1000 chars):`);
    console.log(stdout.slice(-1000));
    return { error: "no_response", stdout: stdout.slice(-500) };

  } catch (err) {
    console.log(`  ❌ ERROR: ${err.message}`);
    if (err.stderr) console.log(`  STDERR: ${err.stderr.slice(-500)}`);
    if (err.stdout) {
      const diagMatch = err.stdout.match(/MEDINET_PAGE_DIAGNOSTIC\s+(\{[\s\S]*?\n\})/);
      if (diagMatch) {
        try {
          const diag = JSON.parse(diagMatch[1]);
          console.log(`  📋 DIAGNOSTIC:`);
          console.log(JSON.stringify(diag, null, 2));
        } catch { /* ignore */ }
      }
    }
    return { error: err.message };
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  TEST MEDINET PLAYWRIGHT — Simulacion paso a paso                  ║");
  console.log("║  Paciente: prueba6 prueba6 | RUT: 6.469.664-5                      ║");
  console.log("║  Script: medinet-antonia.cjs                                        ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  // ── PASO 1: Cache — scrapea profesionales de la sucursal ──
  const cacheResult = await runPlaywright(1, "CACHE — Scrapear profesionales de sucursal", {
    MEDINET_MODE: "cache",
  }, 90000);

  // ── PASO 2: Search — buscar horas de nutriologia ──
  const searchResult = await runPlaywright(2, 'SEARCH — Buscar horas de "nutriologia"', {
    MEDINET_QUERY: "nutriologia",
    MEDINET_PATIENT_PHONE: PATIENT.fono,
    MEDINET_PATIENT_MESSAGE: "Quiero agendar con nutriologa",
    MEDINET_RUT: MEDINET_RUT,
  }, 60000);

  // ── PASO 3: Search con RUT del paciente ──
  const searchRutResult = await runPlaywright(3, "SEARCH — Buscar horas con RUT del paciente", {
    MEDINET_QUERY: "nutriologia",
    MEDINET_RUT: PATIENT.rut,
    MEDINET_PATIENT_PHONE: PATIENT.fono,
    MEDINET_PATIENT_MESSAGE: "Quiero agendar hora con nutriologa Khaterine Araya",
  }, 60000);

  // Si encontramos slots, intentar agendar (PASO 4)
  const slots = searchResult?.available_slots || searchRutResult?.available_slots;
  if (slots && slots.length > 0) {
    const slot = slots[0]; // primer slot disponible
    console.log(`\n  📅 Slot encontrado para booking test: ${slot.date || slot.dataDia} ${slot.time}`);

    await runPlaywright(4, "SEARCH_AND_BOOK — Agendar primer slot disponible", {
      MEDINET_MODE: "search_and_book",
      MEDINET_RUT: MEDINET_RUT,
      MEDINET_PROFESSIONAL_ID: String(slot.professionalId || ""),
      MEDINET_SLOT_DATE: String(slot.dataDia || slot.date || ""),
      MEDINET_SLOT_TIME: String(slot.time || ""),
      MEDINET_PATIENT_RUT: PATIENT.rut,
      MEDINET_PATIENT_NOMBRES: PATIENT.nombres,
      MEDINET_PATIENT_AP_PATERNO: PATIENT.apPaterno,
      MEDINET_PATIENT_AP_MATERNO: PATIENT.apMaterno,
      MEDINET_PATIENT_PREVISION: PATIENT.prevision,
      MEDINET_PATIENT_NACIMIENTO: PATIENT.nacimiento,
      MEDINET_PATIENT_EMAIL: PATIENT.email,
      MEDINET_PATIENT_FONO: PATIENT.fono,
      MEDINET_PATIENT_DIRECCION: PATIENT.direccion,
    }, 180000);
  } else {
    console.log("\n  ⏭️  PASO 4: SKIP — No se encontraron slots para probar booking");
  }

  console.log("\n" + "═".repeat(70));
  console.log("  TEST COMPLETO");
  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
