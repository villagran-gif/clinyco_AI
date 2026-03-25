/**
 * Test local: bookAgendaweb con dos RUTs.
 *
 * Flujo completo:
 *   1. checkCupos (sin auth)
 *   2. fetchAvailableSlots (con Token auth)
 *   3. bookAgendaweb (sin auth, solo headers especiales)
 *
 * Uso: node test-agendaweb-local.mjs
 */

// Asegurar token para endpoints que lo requieren
process.env.MEDINET_API_TOKEN ??= "64c8840eeb9675d6b9427f8fe37751d007e62086";

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
  return new Date().toISOString().slice(0, 10);
}
function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Cache de slots (compartir entre ambos tests)
let cachedSlots = null;

async function getFirstAvailableSlot() {
  if (cachedSlots) return cachedSlots;

  const desde = today();
  const hasta = futureDate(14);
  console.log(`   Buscando slots ${desde} → ${hasta}...`);
  const raw = await fetchAvailableSlots(BRANCH, ESPECIALIDAD, PROFESIONAL, desde, hasta, TIPO_CITA);

  const allSlots = Array.isArray(raw) ? raw : (raw?.cupos || raw?.data || []);

  // Flatten: cada día puede tener múltiples horas
  for (const item of allSlots) {
    if (item.horas && Array.isArray(item.horas)) {
      for (const h of item.horas) {
        cachedSlots = { fecha: item.fecha, hora: h.hora || h };
        return cachedSlots;
      }
    } else if (item.fecha && item.hora) {
      cachedSlots = { fecha: item.fecha, hora: item.hora };
      return cachedSlots;
    }
  }

  // Debug: mostrar respuesta cruda
  console.log("   Raw response:", JSON.stringify(raw).slice(0, 500));
  return null;
}

// ─── Main ────────────────────────────────────────────────────
async function testRut({ rut, label }) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${label} → ${rut}`);
  console.log("=".repeat(60));

  // 1. Check cupos (sin auth)
  console.log("\n1) checkCupos...");
  let pacienteExiste = false;
  try {
    const cupos = await checkCupos(BRANCH, rut);
    console.log("   →", JSON.stringify(cupos));
    pacienteExiste = cupos.paciente_existe === true;
    // Paciente nuevo: no devuelve puede_agendar, pero sí puede
    // Paciente existente: puede_agendar=false → cupos agotados
    if (cupos.puede_agendar === false) {
      console.log("   ✗ Cupos agotados para este paciente.");
      return { rut, label, result: "sin_cupos", pacienteExiste };
    }
  } catch (err) {
    console.log("   ⚠ checkCupos error (continuando):", err.message);
  }

  // 2. Obtener slot disponible (con Token auth)
  console.log("\n2) fetchAvailableSlots...");
  let slot;
  try {
    slot = await getFirstAvailableSlot();
  } catch (err) {
    console.log("   ✗ ERROR buscando slots:", err.message);
    return { rut, label, result: "error_slots", pacienteExiste };
  }

  if (!slot) {
    console.log("   ✗ No hay slots disponibles en los próximos 14 días.");
    return { rut, label, result: "sin_slots", pacienteExiste };
  }
  console.log(`   → Slot: ${slot.fecha} ${slot.hora}`);

  // 3. Agendar (sin auth, solo headers especiales)
  console.log(`\n3) bookAgendaweb... (${slot.fecha} ${slot.hora})`);
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
    console.log(ok ? "   ✓ ÉXITO" : `   ✗ Respuesta: ${res.status || res.mensaje || JSON.stringify(res)}`);
    return { rut, label, result: res.status || "unknown", pacienteExiste };
  } catch (err) {
    console.log("   ✗ ERROR:", err.message);
    return { rut, label, result: "error", error: err.message, pacienteExiste };
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
