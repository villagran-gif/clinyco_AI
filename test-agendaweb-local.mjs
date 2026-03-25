/**
 * Test local: bookAgendaweb con dos RUTs.
 *
 * Flujo:
 *   1. checkCupos → confirmar puede_agendar (paciente nuevo = sí puede)
 *   2. fetchAvailableSlots → obtener un slot libre
 *   3. bookAgendaweb → agendar con campos personales vacíos
 *
 * Uso:
 *   MEDINET_API_TOKEN=64c8840eeb9675d6b9427f8fe37751d007e62086 node test-agendaweb-local.mjs
 */
import {
  checkCupos,
  fetchAvailableSlots,
  bookAgendaweb,
} from "./Antonia/medinet-api.js";

// ─── Config ──────────────────────────────────────────────────
const BRANCH = 39;
const ESPECIALIDAD = 5;      // Nutrición
const PROFESIONAL = 69;      // Cerquera Magaly
const TIPO_CITA = 6;
const DURACION = 30;

// Dos RUTs de prueba
const TEST_RUTS = [
  { rut: "23.754.493-5", label: "RUT A (nuevo)" },
  { rut: "6.469.664-5",  label: "RUT B (existente)" },
];

// ─── Helpers ─────────────────────────────────────────────────
function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Main ────────────────────────────────────────────────────
async function testRut({ rut, label }) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${label} → ${rut}`);
  console.log("=".repeat(60));

  // 1. Check cupos
  console.log("\n1) checkCupos...");
  const cupos = await checkCupos(BRANCH, rut);
  console.log("   →", JSON.stringify(cupos));

  // Paciente nuevo no devuelve puede_agendar, pero sí puede agendar
  const puedeAgendar = cupos.puede_agendar === true || cupos.puede_agendar === undefined;
  const pacienteExiste = cupos.paciente_existe === true;

  if (!puedeAgendar) {
    console.log("   ✗ No puede agendar (cupos agotados), saltando.");
    return { rut, label, result: "no_puede_agendar", pacienteExiste, cupos };
  }

  console.log(`   → paciente_existe=${pacienteExiste}, puede_agendar=true`);

  // 2. Buscar slots
  console.log("\n2) fetchAvailableSlots...");
  let slots;
  try {
    const desde = today();
    const hasta = futureDate(14);
    slots = await fetchAvailableSlots(BRANCH, ESPECIALIDAD, PROFESIONAL, desde, hasta, TIPO_CITA);
  } catch (err) {
    console.log("   ✗ ERROR buscando slots:", err.message);
    return { rut, label, result: "error_slots", error: err.message, pacienteExiste };
  }

  // slots suele ser un array de objetos con fecha/hora
  const allSlots = Array.isArray(slots) ? slots : (slots?.cupos || slots?.data || []);

  // Flatten: cada día puede tener múltiples horas
  let flatSlots = [];
  for (const item of allSlots) {
    if (item.horas && Array.isArray(item.horas)) {
      for (const h of item.horas) {
        flatSlots.push({ fecha: item.fecha, hora: h.hora || h });
      }
    } else if (item.fecha && item.hora) {
      flatSlots.push({ fecha: item.fecha, hora: item.hora });
    }
  }

  if (flatSlots.length === 0) {
    console.log("   Raw slots response:", JSON.stringify(slots).slice(0, 500));
    console.log("   ✗ No hay slots disponibles.");
    return { rut, label, result: "sin_slots", pacienteExiste };
  }

  // Tomar el primer slot disponible
  const slot = flatSlots[0];
  console.log(`   → ${flatSlots.length} slots encontrados. Usando: ${slot.fecha} ${slot.hora}`);

  // 3. Agendar
  console.log("\n3) bookAgendaweb...");
  try {
    const res = await bookAgendaweb({
      run: rut,
      fecha: slot.fecha,
      hora: slot.hora,
      profesional: PROFESIONAL,
      especialidad: ESPECIALIDAD,
      tipo: TIPO_CITA,
      duracion: DURACION,
      ubicacion: BRANCH,
      email: "",
      telefono: "",
      pacienteExiste,
    });
    console.log("   →", JSON.stringify(res));
    const ok = res.status === "agendado_correctamente";
    console.log(ok ? "   ✓ ÉXITO" : `   ✗ FALLO: ${res.status}`);
    return { rut, label, result: res.status, pacienteExiste };
  } catch (err) {
    console.log("   ✗ ERROR:", err.message);
    return { rut, label, result: "error", error: err.message, pacienteExiste };
  }
}

// ─── Run ─────────────────────────────────────────────────────
if (!process.env.MEDINET_API_TOKEN) {
  console.error("ERROR: Falta MEDINET_API_TOKEN. Ejecuta así:");
  console.error("  MEDINET_API_TOKEN=64c8840eeb9675d6b9427f8fe37751d007e62086 node test-agendaweb-local.mjs");
  process.exit(1);
}

console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║  Test agendaweb-add: campos personales siempre vacíos  ║");
console.log("╚══════════════════════════════════════════════════════════╝");

const results = [];
for (const t of TEST_RUTS) {
  results.push(await testRut(t));
}

console.log("\n\n" + "═".repeat(60));
console.log("RESUMEN:");
console.log("═".repeat(60));
for (const r of results) {
  const icon = r.result === "agendado_correctamente" ? "✓" : "✗";
  console.log(`  ${icon} ${r.label} (${r.rut}) → ${r.result} [pacienteExiste=${r.pacienteExiste}]`);
}
