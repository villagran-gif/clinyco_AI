/**
 * test-medinet-playwright.js — Reproduce el error exacto del log
 *
 * Reproduce la busqueda que fallo para Barbara (conv 69a5acc84ca266f32ac32c0f)
 * buscando nutriologa en Antofagasta.
 *
 * Del log:
 *   MEDINET_ANTONIA_ERROR Error: Medinet agenda no disponible: 404
 *   Error, Sin Acceso!!
 *   at openBookingStepOne (medinet-antonia.cjs:224)
 *
 * Usage: cd ~/clinyco_AI && source .env && node scripts/test-medinet-playwright.js
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { accessSync, constants as fsConstants } from "fs";

const execFileAsync = promisify(execFile);

function resolveScript() {
  const base = fileURLToPath(new URL("../Antonia/", import.meta.url));
  for (const name of ["medinet-antonia.cjs", "medinet-antonia.js"]) {
    try { accessSync(base + name, fsConstants.R_OK); return base + name; } catch { /* skip */ }
  }
  return base + "medinet-antonia.cjs";
}

const SCRIPT = resolveScript();

// Datos exactos del log que fallo:
// Paciente: Barbara, RUT 21.675.714-9, buscaba nutriologa Khaterine Araya
// Branch: Antofagasta Mall Arauco Express
// El MEDINET_RUT es el de login del sistema (no del paciente)
const MEDINET_RUT = process.env.MEDINET_RUT || "13580388k";

// Paciente de prueba (existe en Medinet, no es real)
const TEST_PATIENT_RUT = "6.469.664-5";

// Datos del paciente en los pasos de booking
const PATIENT = {
  rut: "6.469.664-5",
  nombres: "prueba7",
  apPaterno: "prueba7",
  apMaterno: "pruebaMaterno7",
  nacimiento: "08/09/1979",
  email: "villagran@clinyco.cl",
  fono: "+56912345678",
  prevision: "BANMEDICA",
  direccion: "zucovic, ALGARROBO",
};

async function runStep(step, label, envOverrides, timeoutMs = 60000) {
  const env = {
    ...process.env,
    MEDINET_HEADED: "false",
    ...envOverrides,
  };

  const envLog = Object.entries(envOverrides)
    .map(([k, v]) => `    ${k} = ${v}`)
    .join("\n");

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  PASO ${step}: ${label}`);
  console.log(`  Funcion Playwright que se ejecuta:`);

  if (envOverrides.MEDINET_MODE === "cache") {
    console.log(`    cacheAllProfessionals() → openBookingStepOne() → scrapeBranchProfessionals()`);
  } else if (envOverrides.MEDINET_MODE === "search_and_book") {
    console.log(`    searchAndBook() → openBookingStepOne() → openProfessionalAgenda() → selectCalendarDate() → fill form → confirm`);
  } else {
    console.log(`    main() → openBookingStepOne() → openProfessionalAgenda() → readVisibleCalendarTables()`);
  }

  console.log(`  Env vars:`);
  console.log(envLog);
  console.log(`  Timeout: ${timeoutMs}ms`);
  console.log(`${"─".repeat(70)}`);

  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync("node", [SCRIPT], {
      env,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Log NET requests (API calls que hizo Playwright)
    const netLines = stdout.split("\n").filter(l => l.startsWith("[NET]"));
    if (netLines.length) {
      console.log(`  Requests HTTP capturados (${netLines.length}):`);
      netLines.forEach(l => console.log(`    ${l}`));
    }

    if (stderr) {
      const stderrLines = stderr.split("\n").filter(l => l.trim());
      console.log(`  STDERR (${stderrLines.length} lineas):`);
      stderrLines.slice(-10).forEach(l => console.log(`    ${l}`));
    }

    // Buscar ANTONIA_RESPONSE
    const match = stdout.match(/ANTONIA_RESPONSE\s+(\{[\s\S]*\})/);
    if (match) {
      const result = JSON.parse(match[1]);
      console.log(`  ✅ EXITO en ${elapsed}s`);
      console.log(`  Resultado:`);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    // Buscar DIAGNOSTIC
    const diagMatch = stdout.match(/MEDINET_PAGE_DIAGNOSTIC\s+(\{[\s\S]*?\n\})/);
    if (diagMatch) {
      const diag = JSON.parse(diagMatch[1]);
      console.log(`  ❌ FALLO en ${elapsed}s — Pagina no cargo`);
      console.log(`  Diagnostic:`);
      console.log(`    URL: ${diag.url}`);
      console.log(`    Error: ${diag.errorMessage}`);
      console.log(`    HTML length: ${diag.htmlLength}`);
      console.log(`    Body preview: ${diag.bodyTextPreview}`);
      console.log(`    Branch: ${diag.branchName}`);
      console.log(`    Screenshot: ${diag.screenshotPath}`);
      return { error: true, diagnostic: diag };
    }

    console.log(`  ⚠️  Sin respuesta estructurada (${elapsed}s)`);
    console.log(`  Stdout (ultimas 500 chars): ${stdout.slice(-500)}`);
    return null;

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ❌ ERROR en ${elapsed}s: ${err.message}`);

    if (err.stdout) {
      const diagMatch = err.stdout.match(/MEDINET_PAGE_DIAGNOSTIC\s+(\{[\s\S]*?\n\})/);
      if (diagMatch) {
        try {
          const diag = JSON.parse(diagMatch[1]);
          console.log(`  Diagnostic:`);
          console.log(`    URL: ${diag.url}`);
          console.log(`    Error: ${diag.errorMessage}`);
          console.log(`    Body preview: ${diag.bodyTextPreview}`);
          console.log(`    Branch: ${diag.branchName}`);
        } catch { /* ignore */ }
      }

      const netLines = err.stdout.split("\n").filter(l => l.startsWith("[NET]"));
      if (netLines.length) {
        console.log(`  Requests HTTP antes del error:`);
        netLines.forEach(l => console.log(`    ${l}`));
      }
    }

    if (err.stderr) {
      console.log(`  STDERR: ${err.stderr.slice(-300)}`);
    }

    return { error: true, message: err.message };
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  TEST MEDINET PLAYWRIGHT — Reproduce error del log                  ║");
  console.log("║  Caso: Barbara busca nutriologa Khaterine Araya en Antofagasta      ║");
  console.log("║  Error original: 404 Sin Acceso en openBookingStepOne               ║");
  console.log("║  Paciente test: prueba7 prueba7 pruebaMaterno7 | RUT: 6.469.664-5    ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  // ── PASO 1: Search "nutriologia" (reproduce el error exacto del log) ──
  const searchResult = await runStep(1,
    'SEARCH "nutriologia" — Reproduce error del log de Barbara',
    {
      MEDINET_RUT: MEDINET_RUT,
      MEDINET_QUERY: "nutriologia",
      MEDINET_PATIENT_PHONE: "+56963733789",
      MEDINET_PATIENT_MESSAGE: "Hola necesito agendar hora en antofagasta con la nutriologa Khaterine Araya",
    },
    60000
  );

  // ── PASO 2: Cache (scrapear profesionales) ──
  const cacheResult = await runStep(2,
    "CACHE — Scrapear profesionales de todas las sucursales",
    {
      MEDINET_MODE: "cache",
      MEDINET_RUT: MEDINET_RUT,
    },
    90000
  );

  // ── PASO 3: Search con RUT del paciente de prueba ──
  const searchRut = await runStep(3,
    'SEARCH "nutriologia" con RUT paciente prueba6',
    {
      MEDINET_RUT: TEST_PATIENT_RUT,
      MEDINET_QUERY: "nutriologia",
      MEDINET_PATIENT_PHONE: "+56912345678",
      MEDINET_PATIENT_MESSAGE: "Quiero agendar hora con nutriologa",
    },
    60000
  );

  // ── PASO 4: Si encontramos slots, intentar booking ──
  const slots = searchResult?.available_slots || searchRut?.available_slots;
  if (slots && slots.length > 0) {
    const slot = slots[0];
    console.log(`\n  📅 Slot encontrado: ${slot.date || slot.dataDia} ${slot.time}`);

    await runStep(4,
      `SEARCH_AND_BOOK — Agendar slot ${slot.time} del ${slot.date || slot.dataDia}`,
      {
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
      },
      180000
    );
  } else {
    console.log("\n  ⏭️  PASO 4: SKIP — No se encontraron slots");
  }

  console.log("\n" + "═".repeat(70));
  console.log("  TEST COMPLETO");
  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
