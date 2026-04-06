/**
 * test-medinet-agendaweb-add.js — Prueba bookAgendaweb CON datos personales
 *
 * Paciente: prueba7 prueba7 pruebaMaterno7
 * RUT: 6.469.664-5
 *
 * Usage: cd ~/clinyco_AI && source .env && node scripts/test-medinet-agendaweb-add.js
 */
import {
  checkCupos,
  bookAgendaweb,
  searchSlotsNoAuth,
  formatRutWithDots,
  DEFAULT_BRANCH_ID,
} from "../Antonia/medinet-api.js";

const PATIENT = {
  rut: "6.469.664-5",
  nombres: "prueba7",
  apPaterno: "prueba7",
  apMaterno: "pruebaMaterno7",
  nacimiento: "08/09/1979",
  email: "villagran@clinyco.cl",
  fono: "+56912345678",
  prevision: "BANMEDICA",
  direccion: "zucovic",
  comuna: "ALGARROBO",
};

const BRANCH_ID = DEFAULT_BRANCH_ID;

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  TEST bookAgendaweb() CON datos personales                         ║");
  console.log("║  Paciente: prueba7 prueba7 pruebaMaterno7                           ║");
  console.log("║  RUT: 6.469.664-5                                                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  // ── PASO 1: checkCupos ──
  console.log("\n══ PASO 1: checkCupos ══");
  const rut = formatRutWithDots(PATIENT.rut);
  console.log(`  RUT formateado: ${rut}`);
  try {
    const cupos = await checkCupos(BRANCH_ID, rut);
    console.log("  Resultado:", JSON.stringify(cupos, null, 2));
    if (cupos && cupos.puede_agendar === false) {
      console.log("  ❌ Paciente NO puede agendar:", cupos.mensaje);
      return;
    }
  } catch (err) {
    console.log("  ⚠️ checkCupos error:", err.message);
  }

  // ── PASO 2: Buscar slot disponible ──
  console.log("\n══ PASO 2: Buscar slot disponible ══");
  let slot;
  try {
    const search = await searchSlotsNoAuth({ query: "nutriologia", branchId: BRANCH_ID });
    console.log(`  Slots encontrados: ${search?.available_slots?.length || 0}`);
    if (search?.available_slots?.length > 0) {
      slot = search.available_slots[0];
      console.log(`  Usando slot: ${slot.date} ${slot.time} con ${slot.professional}`);
    } else {
      console.log("  ❌ No hay slots disponibles. Abortando.");
      return;
    }
  } catch (err) {
    console.log("  ❌ Error buscando slot:", err.message);
    return;
  }

  // ── PASO 3: bookAgendaweb CON datos personales ──
  console.log("\n══ PASO 3: bookAgendaweb CON datos personales ══");

  const payload = {
    run: rut,
    fecha: slot.dataDia,
    hora: slot.time,
    profesional: Number(slot.professionalId),
    especialidad: Number(slot.specialtyId || 6),
    tipo: Number(slot.tipoCitaId || 1),
    duracion: Number(slot.duration || 30),
    ubicacion: BRANCH_ID,
    email: PATIENT.email,
    telefono: PATIENT.fono,
    nombre: PATIENT.nombres,
    apellidos: `${PATIENT.apPaterno} ${PATIENT.apMaterno}`.trim(),
    direccion: PATIENT.direccion,
    sexo: "",
    fecha_nacimiento: PATIENT.nacimiento,
    aseguradora: PATIENT.prevision,
  };

  console.log("  Payload enviado a agendaweb-add:");
  console.log(JSON.stringify(payload, null, 2));

  try {
    const result = await bookAgendaweb(payload);
    console.log("  ✅ Respuesta de Medinet:");
    console.log(JSON.stringify(result, null, 2));

    if (result?.status === "agendado_correctamente") {
      console.log("\n  ✅ CITA CREADA CON DATOS PERSONALES — Verificar en Medinet que nombre aparezca");
    }
  } catch (err) {
    console.log("  ❌ Error:", err.message);
    if (err.httpStatus) console.log("  HTTP Status:", err.httpStatus);
    if (err.responseBody) console.log("  Response body:", JSON.stringify(err.responseBody, null, 2));

    if (err.httpStatus === 500) {
      console.log("\n  ⚠️ CONFIRMADO: Medinet devuelve 500 cuando se envian datos personales.");
      console.log("  El comentario en el codigo es correcto: los campos deben ir vacios.");
    }
  }

  console.log("\n" + "═".repeat(70));
  console.log("  TEST COMPLETO");
  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
