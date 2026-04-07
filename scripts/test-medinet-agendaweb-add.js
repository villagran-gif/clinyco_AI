/**
 * test-medinet-agendaweb-add.js — Prueba bookAgendaweb con IDs numericos
 *
 * Paciente: Felipe Emiliano Villagran Van Steenderen
 * RUT: 25.203.895-7
 *
 * Hipotesis: Medinet ignora datos personales porque aseguradora/prevision
 * van como texto en vez de IDs numericos como hace la UI.
 *
 * Usage: cd ~/clinyco_AI && node scripts/test-medinet-agendaweb-add.js
 */
import "dotenv/config";
import {
  checkCupos,
  bookAgendaweb,
  searchSlotsViaApi,
  formatRutWithDots,
  DEFAULT_BRANCH_ID,
} from "../Antonia/medinet-api.js";

const PATIENT = {
  rut: "25.203.895-7",
  nombres: "Felipe Emiliano",
  apPaterno: "Villagran",
  apMaterno: "Van Steenderen",
  nacimiento: "12/11/2015",
  email: "villagran@clinyco.cl",
  fono: "+56912345678",
  // IDs numericos como la UI:
  aseguradora: "3",       // BANMEDICA (ID)
  prevision: "5",         // Banmedica (ID)
  comuna: "68",           // ALGARROBO (ID)
  sexo: "3",              // Indeterminado (ID)
  direccion: "zucovic",
};

const BRANCH_ID = DEFAULT_BRANCH_ID;

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  TEST bookAgendaweb con IDs numericos (como la UI)                 ║");
  console.log("║  Paciente: Felipe Emiliano Villagran Van Steenderen                 ║");
  console.log("║  RUT: 25.203.895-7                                                 ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  const rut = formatRutWithDots(PATIENT.rut);

  // ── PASO 1: checkCupos ──
  console.log("\n══ PASO 1: checkCupos ══");
  console.log(`  RUT: ${rut}`);
  try {
    const cupos = await checkCupos(BRANCH_ID, rut);
    console.log("  Resultado:", JSON.stringify(cupos));
  } catch (err) {
    console.log("  Error:", err.message);
  }

  // ── PASO 2: Buscar slot ──
  console.log("\n══ PASO 2: searchSlotsViaApi villagran ══");
  let slot;
  try {
    const search = await searchSlotsViaApi({ query: "villagran", branchId: BRANCH_ID });
    slot = search.available_slots?.[0];
    if (!slot) { console.log("  No hay slots"); return; }
    console.log(`  Slot: ${slot.dataDia} ${slot.time} con ${slot.professional}`);
  } catch (err) {
    console.log("  Error:", err.message);
    return;
  }

  // ── PASO 3: bookAgendaweb con IDs numericos ──
  console.log("\n══ PASO 3: bookAgendaweb con IDs numericos ══");

  const payload = {
    run: rut,
    fecha: slot.dataDia,
    hora: slot.time,
    profesional: Number(slot.professionalId),
    especialidad: Number(slot.specialtyId),
    tipo: Number(slot.tipoCitaId),
    duracion: Number(slot.duration || 20),
    ubicacion: BRANCH_ID,
    // Datos como la UI los envia:
    nombre: PATIENT.nombres,
    apellidos: `${PATIENT.apPaterno} ${PATIENT.apMaterno}`.trim(),
    direccion: PATIENT.direccion,
    sexo: PATIENT.sexo,
    fecha_nacimiento: PATIENT.nacimiento,
    aseguradora: PATIENT.aseguradora,
    // Campos adicionales que la UI envia:
    email: PATIENT.email,
    telefono: PATIENT.fono,
    telefono_fijo: PATIENT.fono,
    telefono_movil: PATIENT.fono,
    prevision: PATIENT.prevision,
    comuna: PATIENT.comuna,
    tienerut: "true",
    enable_sms_notifications: "true",
    enable_wsp_notifications: "true",
    resource: String(slot.professionalId),
    tipoagenda: "1",
    es_recurso: "0",
    estado: "1",
  };

  console.log("  Payload:");
  for (const [k, v] of Object.entries(payload)) {
    console.log(`    ${k}: ${v}`);
  }

  try {
    const result = await bookAgendaweb(payload);
    console.log("\n  Respuesta:", JSON.stringify(result, null, 2));
    if (result?.status === "agendado_correctamente") {
      console.log("\n  ✅ CITA AGENDADA — Verificar en Medinet si nombre y prevision aparecen");
    }
  } catch (err) {
    console.log("\n  ❌ Error:", err.message);
    if (err.httpStatus) console.log("  HTTP:", err.httpStatus);
    if (err.responseBody) console.log("  Body:", JSON.stringify(err.responseBody));
  }

  console.log("\n" + "═".repeat(70));
  console.log("  TEST COMPLETO");
  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
