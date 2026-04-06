/**
 * test-medinet-agendaweb-add.js — Prueba directa de bookAgendaweb()
 *
 * Primero busca un slot disponible con searchSlotsNoAuth,
 * luego intenta agendar con bookAgendaweb enviando TODOS los datos del paciente.
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

const BRANCH_ID = DEFAULT_BRANCH_ID; // 39 = Antofagasta

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  TEST bookAgendaweb() — Prueba directa con datos completos         ║");
  console.log("║  Paciente: prueba7 prueba7 pruebaMaterno7                           ║");
  console.log("║  RUT: 6.469.664-5                                                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  // ── PASO 1: checkCupos ──
  console.log("\n══ PASO 1: checkCupos ══");
  const rut = formatRutWithDots(PATIENT.rut);
  console.log(`  RUT formateado: ${rut}`);
  let pacienteExiste = true;
  try {
    const cupos = await checkCupos(BRANCH_ID, rut);
    console.log("  Resultado:", JSON.stringify(cupos, null, 2));
    if (cupos && cupos.puede_agendar === false) {
      console.log("  ❌ Paciente NO puede agendar:", cupos.mensaje);
      return;
    }
    pacienteExiste = cupos?.paciente_existe !== false;
    console.log(`  pacienteExiste: ${pacienteExiste}`);
  } catch (err) {
    console.log("  ⚠️ checkCupos error:", err.message);
  }

  // ── PASO 2: Buscar un slot disponible ──
  console.log("\n══ PASO 2: searchSlotsNoAuth — buscar slot de nutriologia ══");
  let slot;
  try {
    const search = await searchSlotsNoAuth({ query: "nutriologia", branchId: BRANCH_ID });
    console.log(`  Slots encontrados: ${search?.available_slots?.length || 0}`);
    if (search?.available_slots?.length > 0) {
      slot = search.available_slots[0];
      console.log(`  Usando primer slot: ${slot.date} ${slot.time} con ${slot.professional}`);
      console.log(`  Slot completo:`, JSON.stringify(slot, null, 2));
    } else {
      console.log("  ❌ No hay slots disponibles. Abortando.");
      return;
    }
  } catch (err) {
    console.log("  ❌ searchSlotsNoAuth error:", err.message);
    return;
  }

  // ── PASO 3A: bookAgendaweb SIN datos personales (como funciona HOY) ──
  console.log("\n══ PASO 3A: bookAgendaweb SIN datos personales (comportamiento actual) ══");
  const payloadSinDatos = {
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
    // nombre, apellidos, etc. NO se envian (comportamiento actual)
  };

  console.log("  Payload enviado a agendaweb-add:");
  console.log(JSON.stringify(payloadSinDatos, null, 2));

  try {
    const result = await bookAgendaweb(payloadSinDatos);
    console.log("  ✅ Respuesta de Medinet:");
    console.log(JSON.stringify(result, null, 2));

    if (result?.status === "agendado_correctamente") {
      console.log("\n  ⚠️ CITA CREADA SIN DATOS PERSONALES — Verificar en Medinet que nombre este vacio");
      console.log("  Para cancelar, hacerlo manualmente en Medinet.");
      return; // No probar 3B si 3A ya creo la cita
    }
  } catch (err) {
    console.log("  ❌ Error:", err.message);
    if (err.httpStatus) console.log("  HTTP Status:", err.httpStatus);
    if (err.responseBody) console.log("  Response body:", JSON.stringify(err.responseBody, null, 2));
  }

  // ── PASO 3B: bookAgendaweb CON datos personales (lo que queremos probar) ──
  // Solo se ejecuta si 3A fallo (no creo la cita)
  console.log("\n══ PASO 3B: bookAgendaweb CON datos personales (prueba nueva) ══");

  // Buscar otro slot porque el anterior podria estar tomado
  let slot2;
  try {
    const search2 = await searchSlotsNoAuth({ query: "nutriologia", branchId: BRANCH_ID });
    if (search2?.available_slots?.length > 0) {
      slot2 = search2.available_slots[0];
      console.log(`  Usando slot: ${slot2.date} ${slot2.time}`);
    } else {
      console.log("  ❌ No hay mas slots. Abortando 3B.");
      return;
    }
  } catch (err) {
    console.log("  ❌ Error buscando slot:", err.message);
    return;
  }

  const payloadConDatos = {
    run: rut,
    fecha: slot2.dataDia,
    hora: slot2.time,
    profesional: Number(slot2.professionalId),
    especialidad: Number(slot2.specialtyId || 6),
    tipo: Number(slot2.tipoCitaId || 1),
    duracion: Number(slot2.duration || 30),
    ubicacion: BRANCH_ID,
    email: PATIENT.email,
    telefono: PATIENT.fono,
    // NUEVOS: datos personales que hoy se envian vacios
    nombre: PATIENT.nombres,
    apellidos: `${PATIENT.apPaterno} ${PATIENT.apMaterno}`.trim(),
    direccion: PATIENT.direccion,
    sexo: "",
    fecha_nacimiento: PATIENT.nacimiento,
    aseguradora: PATIENT.prevision,
  };

  console.log("  Payload enviado a agendaweb-add:");
  console.log(JSON.stringify(payloadConDatos, null, 2));

  try {
    const result = await bookAgendaweb(payloadConDatos);
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
