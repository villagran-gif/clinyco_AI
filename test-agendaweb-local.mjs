/**
 * Test local: bookAgendaweb con dos RUTs.
 *
 * Flujo simplificado:
 *   1. checkCupos → confirmar puede_agendar
 *   2. bookAgendaweb directo con slot hardcodeado (el endpoint no requiere auth)
 *
 * Uso:
 *   MEDINET_API_TOKEN=64c8840eeb9675d6b9427f8fe37751d007e62086 node test-agendaweb-local.mjs
 *
 * O sin token (checkCupos y agendaweb-add no lo requieren):
 *   node test-agendaweb-local.mjs
 */
import {
  checkCupos,
  bookAgendaweb,
} from "./Antonia/medinet-api.js";

// ─── Config ──────────────────────────────────────────────────
const BRANCH = 39;
const ESPECIALIDAD = 5;      // Nutrición
const PROFESIONAL = 69;      // Cerquera Magaly
const TIPO_CITA = 6;
const DURACION = 30;

// Slot a usar: busca manualmente uno disponible si estos fallan
// Ajustar fecha/hora según disponibilidad real
const SLOT_FECHA = "2026-03-26";  // mañana
const SLOT_HORA = "09:00";

// Dos RUTs de prueba
const TEST_RUTS = [
  { rut: "23.754.493-5", label: "RUT A (nuevo)" },
  { rut: "6.469.664-5",  label: "RUT B (existente)" },
];

// ─── Main ────────────────────────────────────────────────────
async function testRut({ rut, label }) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${label} → ${rut}`);
  console.log("=".repeat(60));

  // 1. Check cupos (no requiere auth)
  console.log("\n1) checkCupos...");
  try {
    const cupos = await checkCupos(BRANCH, rut);
    console.log("   →", JSON.stringify(cupos));
    const pacienteExiste = cupos.paciente_existe === true;
    console.log(`   → paciente_existe=${pacienteExiste}`);
  } catch (err) {
    console.log("   ⚠ checkCupos error (continuando):", err.message);
  }

  // 2. Agendar directo (no requiere auth, solo headers especiales)
  console.log(`\n2) bookAgendaweb... (${SLOT_FECHA} ${SLOT_HORA})`);
  try {
    const res = await bookAgendaweb({
      run: rut,
      fecha: SLOT_FECHA,
      hora: SLOT_HORA,
      profesional: PROFESIONAL,
      especialidad: ESPECIALIDAD,
      tipo: TIPO_CITA,
      duracion: DURACION,
      ubicacion: BRANCH,
      email: "",
      telefono: "",
      pacienteExiste: false,  // no importa, siempre envía campos vacíos
    });
    console.log("   →", JSON.stringify(res));
    const ok = res.status === "agendado_correctamente";
    console.log(ok ? "   ✓ ÉXITO" : `   ✗ Respuesta: ${res.status || res.mensaje || JSON.stringify(res)}`);
    return { rut, label, result: res.status || "unknown" };
  } catch (err) {
    console.log("   ✗ ERROR:", err.message);
    return { rut, label, result: "error", error: err.message };
  }
}

// ─── Run ─────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║  Test agendaweb-add: campos personales siempre vacíos  ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log(`Slot: ${SLOT_FECHA} ${SLOT_HORA} | Prof: ${PROFESIONAL} | Esp: ${ESPECIALIDAD} | Branch: ${BRANCH}`);

const results = [];
for (const t of TEST_RUTS) {
  results.push(await testRut(t));
}

console.log("\n\n" + "═".repeat(60));
console.log("RESUMEN:");
console.log("═".repeat(60));
for (const r of results) {
  const icon = r.result === "agendado_correctamente" ? "✓" : "✗";
  console.log(`  ${icon} ${r.label} (${r.rut}) → ${r.result}`);
}
