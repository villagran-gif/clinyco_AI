/**
 * Test local: bookAgendaweb con dos RUTs nuevos.
 *
 * Flujo:
 *   1. checkCupos → confirmar paciente_existe y puede_agendar
 *   2. fetchAvailableSlots → obtener un slot libre
 *   3. bookAgendaweb → agendar
 *
 * Uso: node test-agendaweb-local.mjs
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

// Dos RUTs de prueba (ajustar si necesario)
const TEST_RUTS = [
  { rut: "23.754.493-5", label: "RUT A" },
  { rut: "6.469.664-5",  label: "RUT B" },
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

  if (!cupos.puede_agendar) {
    console.log("   ✗ No puede agendar, saltando.");
    return { rut, label, result: "no_puede_agendar", cupos };
  }

  // 2. Buscar slots
  console.log("\n2) fetchAvailableSlots...");
  const desde = today();
  const hasta = futureDate(14);
  const slots = await fetchAvailableSlots(BRANCH, ESPECIALIDAD, PROFESIONAL, desde, hasta, TIPO_CITA);

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
    return { rut, label, result: "sin_slots", slots };
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
      pacienteExiste: cupos.paciente_existe,
    });
    console.log("   →", JSON.stringify(res));
    const ok = res.status === "agendado_correctamente";
    console.log(ok ? "   ✓ ÉXITO" : `   ✗ FALLO: ${res.status}`);
    return { rut, label, result: res.status, pacienteExiste: cupos.paciente_existe };
  } catch (err) {
    console.log("   ✗ ERROR:", err.message);
    return { rut, label, result: "error", error: err.message, pacienteExiste: cupos.paciente_existe };
  }
}

// ─── Run ─────────────────────────────────────────────────────
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
