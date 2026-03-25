/**
 * Test local: bookAgendaweb con dos RUTs.
 *
 * Prueba directa del fix: campos personales SIEMPRE vacíos.
 * Antes del fix: 500. Después del fix: agendado_correctamente o cupo_tomado.
 * Ambas respuestas confirman que el fix funciona (ya no da 500).
 *
 * Uso: node test-agendaweb-local.mjs
 *   o: node test-agendaweb-local.mjs 2026-03-27 10:00
 */
import { bookAgendaweb } from "./Antonia/medinet-api.js";

const BASE = "https://clinyco.medinetapp.com";
// No se necesitan credenciales para checkCupos ni agendaweb-add

// ─── Config ──────────────────────────────────────────────────
const BRANCH = 39;
const ESPECIALIDAD = 5;
const PROFESIONAL = 69;
const TIPO_CITA = 6;
const DURACION = 30;

// Fecha/hora desde args o default a mañana 09:00
const argFecha = process.argv[2];
const argHora = process.argv[3];

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const SLOT_FECHA = argFecha || tomorrow();
const SLOT_HORA = argHora || "09:00";

const TEST_RUTS = [
  { rut: "23.754.493-5", label: "RUT A (nuevo)" },
  { rut: "6.469.664-5",  label: "RUT B (existente)" },
];

// ─── Check cupos directo ─────────────────────────────────────
async function checkCuposDirecto(rut) {
  const res = await fetch(
    `${BASE}/api/agenda/citas/get-check-cupos/${BRANCH}/?identifier=${encodeURIComponent(rut)}`
  );
  if (!res.ok) throw new Error(`checkCupos → ${res.status}`);
  return res.json();
}

// ─── Test ────────────────────────────────────────────────────
async function testRut({ rut, label }) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${label} → ${rut}`);
  console.log("=".repeat(60));

  // 1. Check cupos
  console.log("\n1) checkCupos...");
  let pacienteExiste = false;
  try {
    const cupos = await checkCuposDirecto(rut);
    console.log("   →", JSON.stringify(cupos));
    pacienteExiste = cupos.paciente_existe === true;
    if (cupos.puede_agendar === false) {
      console.log("   ✗ Cupos agotados.");
      return { rut, label, result: "sin_cupos", pacienteExiste };
    }
  } catch (err) {
    console.log("   ⚠ Error (continuando):", err.message);
  }

  // 2. bookAgendaweb directo (sin auth, solo X-Requested-With + form-urlencoded)
  console.log(`\n2) bookAgendaweb (${SLOT_FECHA} ${SLOT_HORA})...`);
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
      pacienteExiste,
    });
    console.log("   →", JSON.stringify(res));

    if (res.status === "agendado_correctamente") {
      console.log("   ✓ ÉXITO — agendado correctamente");
      return { rut, label, result: res.status, pacienteExiste };
    } else if (res.status === "cupo_tomado") {
      console.log("   ✓ OK — cupo_tomado (endpoint respondió bien, no 500)");
      return { rut, label, result: res.status, pacienteExiste };
    } else {
      console.log(`   ? Respuesta inesperada: ${JSON.stringify(res)}`);
      return { rut, label, result: res.status || "unknown", pacienteExiste };
    }
  } catch (err) {
    const is500 = err.message.includes("500");
    console.log(is500
      ? "   ✗ ERROR 500 — el fix NO funcionó (campos personales aún se envían?)"
      : `   ✗ ERROR: ${err.message}`);
    return { rut, label, result: "error", error: err.message, pacienteExiste };
  }
}

// ─── Run ─────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║  Test agendaweb-add: campos personales siempre vacíos  ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log(`Slot: ${SLOT_FECHA} ${SLOT_HORA} | Prof: ${PROFESIONAL} | Esp: ${ESPECIALIDAD} | Branch: ${BRANCH}`);
console.log(`Criterio: agendado_correctamente o cupo_tomado = FIX OK (antes daba 500)`);

const results = [];
for (const t of TEST_RUTS) {
  results.push(await testRut(t));
}

console.log("\n\n" + "═".repeat(60));
console.log("RESUMEN:");
console.log("═".repeat(60));
const OK_STATUSES = ["agendado_correctamente", "cupo_tomado"];
for (const r of results) {
  const ok = OK_STATUSES.includes(r.result);
  const icon = ok ? "✓" : "✗";
  console.log(`  ${icon} ${r.label} (${r.rut}) → ${r.result} [pacienteExiste=${r.pacienteExiste}]`);
}

const allOk = results.every(r => OK_STATUSES.includes(r.result));
console.log(`\n${allOk ? "✓ FIX CONFIRMADO: endpoint responde correctamente (no 500)" : "✗ HAY ERRORES — revisar arriba"}`);
