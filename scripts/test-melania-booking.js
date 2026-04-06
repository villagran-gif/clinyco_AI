/**
 * test-melania-booking.js — Simula flujo MelanIA con 3 pacientes
 *
 * Test 1: Pablo (nuevo) → checkCupos + buscar slots Villagran + agendar
 * Test 2: Pablo (ya existe) → checkCupos + buscar slots Villagran + agendar 2da cita
 * Test 3: Solo checkCupos para Rafael y Felipe (no agendar)
 *
 * Usage: cd ~/clinyco_AI && source .env && node scripts/test-melania-booking.js
 */
import {
  checkCupos,
  bookAgendaweb,
  searchSlotsViaApi,
  formatRutWithDots,
  DEFAULT_BRANCH_ID,
} from "../Antonia/medinet-api.js";

const PATIENTS = [
  {
    rut: "23.754.493-5",
    nombres: "Pablo Enrique",
    apPaterno: "Villagran",
    apMaterno: "Van Steenderen",
    nacimiento: "14/09/2011",
    email: "villagran@clinyco.cl",
    fono: "+56912345678",
    prevision: "BANMEDICA",
    direccion: "zucovic",
    comuna: "ALGARROBO",
  },
  {
    rut: "24.611.466-8",
    nombres: "Rafael Santiago",
    apPaterno: "Villagran",
    apMaterno: "Van Steenderen",
    nacimiento: "22/04/2014",
    email: "villagran@clinyco.cl",
    fono: "+56912345678",
    prevision: "BANMEDICA",
    direccion: "zucovic",
    comuna: "ALGARROBO",
  },
  {
    rut: "25.203.895-7",
    nombres: "Felipe Emiliano",
    apPaterno: "Villagran",
    apMaterno: "Van Steenderen",
    nacimiento: "12/11/2015",
    email: "villagran@clinyco.cl",
    fono: "+56912345678",
    prevision: "BANMEDICA",
    direccion: "zucovic",
    comuna: "ALGARROBO",
  },
];

const BRANCH_ID = DEFAULT_BRANCH_ID;

async function doCheckCupos(patient) {
  const rut = formatRutWithDots(patient.rut);
  console.log(`  RUT: ${rut}`);
  try {
    const cupos = await checkCupos(BRANCH_ID, rut);
    console.log(`  paciente_existe: ${cupos.paciente_existe}`);
    console.log(`  puede_agendar: ${cupos.puede_agendar ?? "n/a"}`);
    console.log(`  mensaje: ${cupos.mensaje}`);
    console.log(`  maximo_cupos: ${cupos.maximo_cupos ?? "n/a"}`);
    return cupos;
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    return null;
  }
}

async function doBook(patient, slot) {
  const rut = formatRutWithDots(patient.rut);
  const payload = {
    run: rut,
    fecha: slot.dataDia,
    hora: slot.time,
    profesional: Number(slot.professionalId),
    especialidad: Number(slot.specialtyId),
    tipo: Number(slot.tipoCitaId),
    duracion: Number(slot.duration || 20),
    ubicacion: BRANCH_ID,
    email: patient.email,
    telefono: patient.fono,
    nombre: patient.nombres,
    apellidos: `${patient.apPaterno} ${patient.apMaterno}`.trim(),
    direccion: patient.direccion,
    sexo: "M",
    fecha_nacimiento: patient.nacimiento,
    aseguradora: patient.prevision,
  };

  console.log(`  Payload:`);
  console.log(`    RUT: ${rut}`);
  console.log(`    Nombre: ${patient.nombres} ${patient.apPaterno} ${patient.apMaterno}`);
  console.log(`    Profesional ID: ${slot.professionalId} (${slot.professional})`);
  console.log(`    Fecha: ${slot.dataDia} ${slot.time}`);
  console.log(`    Especialidad: ${slot.specialty} (ID:${slot.specialtyId})`);
  console.log(`    Email: ${patient.email}`);
  console.log(`    Prevision: ${patient.prevision}`);

  try {
    const result = await bookAgendaweb(payload);
    console.log(`  Respuesta: ${JSON.stringify(result)}`);
    if (result?.status === "agendado_correctamente") {
      console.log(`  ✅ CITA AGENDADA`);
    } else {
      console.log(`  ⚠️ Respuesta inesperada`);
    }
    return result;
  } catch (e) {
    console.log(`  ❌ ERROR: ${e.message}`);
    if (e.httpStatus) console.log(`  HTTP: ${e.httpStatus}`);
    if (e.responseBody) console.log(`  Body: ${JSON.stringify(e.responseBody)}`);
    return null;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  TEST MELANIA — Flujo de agendamiento con 3 pacientes              ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  const pablo = PATIENTS[0];
  const rafael = PATIENTS[1];
  const felipe = PATIENTS[2];

  // ── TEST 1: Pablo (nuevo) → buscar slots Villagran → agendar ──
  console.log("\n" + "═".repeat(70));
  console.log("  TEST 1: Pablo Enrique (NUEVO) — 1ra cita con Villagran");
  console.log("═".repeat(70));

  console.log("\n  -- checkCupos --");
  const cupos1 = await doCheckCupos(pablo);

  console.log("\n  -- searchSlotsViaApi (villagran) --");
  let slots;
  try {
    const search = await searchSlotsViaApi({ query: "villagran", branchId: BRANCH_ID });
    slots = search.available_slots;
    console.log(`  Profesional: ${search.professional}`);
    console.log(`  Especialidad: ${search.specialty}`);
    console.log(`  Slots: ${slots?.length || 0}`);
    if (slots?.length) {
      slots.forEach((s, i) => console.log(`    ${i + 1}. ${s.dataDia} ${s.time}`));
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }

  if (slots?.length) {
    console.log(`\n  -- bookAgendaweb (slot 1: ${slots[0].dataDia} ${slots[0].time}) --`);
    await doBook(pablo, slots[0]);
  } else {
    console.log("\n  ⏭️ No hay slots, skip booking");
  }

  // ── TEST 2: Pablo (ya existe) → agendar 2da cita ──
  console.log("\n" + "═".repeat(70));
  console.log("  TEST 2: Pablo Enrique (YA EXISTE) — 2da cita con Villagran");
  console.log("═".repeat(70));

  console.log("\n  -- checkCupos --");
  const cupos2 = await doCheckCupos(pablo);

  if (slots?.length >= 2) {
    console.log(`\n  -- bookAgendaweb (slot 2: ${slots[1].dataDia} ${slots[1].time}) --`);
    await doBook(pablo, slots[1]);
  } else {
    console.log("\n  ⏭️ No hay 2do slot disponible");
  }

  // ── TEST 3: checkCupos para Rafael y Felipe ──
  console.log("\n" + "═".repeat(70));
  console.log("  TEST 3: Check cupos Rafael y Felipe (solo verificar)");
  console.log("═".repeat(70));

  console.log("\n  -- Rafael Santiago --");
  await doCheckCupos(rafael);

  console.log("\n  -- Felipe Emiliano --");
  await doCheckCupos(felipe);

  console.log("\n" + "═".repeat(70));
  console.log("  TEST COMPLETO");
  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
