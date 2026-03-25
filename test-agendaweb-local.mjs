/**
 * Test local: bookAgendaweb con dos RUTs.
 * Script autónomo — usa fetch directo, no depende de medinet-api.js para slots.
 *
 * Flujo completo:
 *   1. checkCupos (sin auth)
 *   2. Slots disponibles (con Token auth) — fetch directo
 *   3. bookAgendaweb via apiFormPost (sin auth, solo headers especiales)
 *
 * Uso: node test-agendaweb-local.mjs
 */
import { bookAgendaweb } from "./Antonia/medinet-api.js";

const BASE = "https://clinyco.medinetapp.com";
const TOKEN = "64c8840eeb9675d6b9427f8fe37751d007e62086";

// Asegurar token para bookAgendaweb (apiFormPost lo usa opcionalmente)
process.env.MEDINET_API_TOKEN ??= TOKEN;

// ─── Config ──────────────────────────────────────────────────
const BRANCH = 39;
const ESPECIALIDAD = 5;      // Nutrición
const PROFESIONAL = 69;      // Cerquera Magaly
const TIPO_CITA = 6;
const DURACION = 30;

const TEST_RUTS = [
  { rut: "23.754.493-5", label: "RUT A (nuevo)" },
  { rut: "6.469.664-5",  label: "RUT B (existente)" },
];

// ─── Helpers: fetch directo ──────────────────────────────────
async function directGet(path, { auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Token ${TOKEN}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Cache de slots
let cachedSlot = null;

async function getFirstSlot() {
  if (cachedSlot) return cachedSlot;

  const desde = today();
  const hasta = futureDate(14);
  console.log(`   Buscando slots ${desde} → ${hasta} (fetch directo con Token)...`);

  const raw = await directGet(
    `/api/agenda/citas/cupos-disponibles/${BRANCH}/${ESPECIALIDAD}/${PROFESIONAL}/${desde}/${hasta}/${TIPO_CITA}/`,
    { auth: true }
  );

  const allSlots = Array.isArray(raw) ? raw : (raw?.cupos || raw?.data || []);

  for (const item of allSlots) {
    if (item.horas && Array.isArray(item.horas)) {
      for (const h of item.horas) {
        cachedSlot = { fecha: item.fecha, hora: h.hora || h };
        return cachedSlot;
      }
    } else if (item.fecha && item.hora) {
      cachedSlot = { fecha: item.fecha, hora: item.hora };
      return cachedSlot;
    }
  }

  console.log("   Raw response:", JSON.stringify(raw).slice(0, 500));
  return null;
}

// ─── Main ────────────────────────────────────────────────────
async function testRut({ rut, label }) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${label} → ${rut}`);
  console.log("=".repeat(60));

  // 1. Check cupos (sin auth)
  console.log("\n1) checkCupos (sin auth)...");
  let pacienteExiste = false;
  try {
    const cupos = await directGet(
      `/api/agenda/citas/get-check-cupos/${BRANCH}/?identifier=${encodeURIComponent(rut)}`
    );
    console.log("   →", JSON.stringify(cupos));
    pacienteExiste = cupos.paciente_existe === true;
    if (cupos.puede_agendar === false) {
      console.log("   ✗ Cupos agotados.");
      return { rut, label, result: "sin_cupos", pacienteExiste };
    }
  } catch (err) {
    console.log("   ⚠ checkCupos error (continuando):", err.message);
  }

  // 2. Obtener slot (con Token)
  console.log("\n2) fetchAvailableSlots (con Token)...");
  let slot;
  try {
    slot = await getFirstSlot();
  } catch (err) {
    console.log("   ✗ ERROR:", err.message);
    return { rut, label, result: "error_slots", pacienteExiste };
  }

  if (!slot) {
    console.log("   ✗ No hay slots en los próximos 14 días.");
    return { rut, label, result: "sin_slots", pacienteExiste };
  }
  console.log(`   → Slot: ${slot.fecha} ${slot.hora}`);

  // 3. Agendar (sin auth, solo X-Requested-With)
  console.log(`\n3) bookAgendaweb (${slot.fecha} ${slot.hora})...`);
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
console.log(`Token: ${TOKEN.slice(0, 8)}...`);

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
