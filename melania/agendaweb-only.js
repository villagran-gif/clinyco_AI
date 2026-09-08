import { isEndoscopyBooking } from "./booking-policy.js";
export const UNAVAILABLE = "No puedo confirmar cupos publicados en Agenda Web en este momento. Nuestro equipo debe revisar tu solicitud.";
const norm = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const positive = v => Number.isFinite(Number(v)) && Number(v) > 0;
const localParts = now => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23" }).formatToParts(now).map(p => [p.type,p.value]));

export function publishedProfessionals(rows, now = new Date()) {
  const p = localParts(now);
  const today = p.year+"-"+p.month+"-"+p.day;
  const time = p.hour+":"+p.minute;
  const end = new Date(Date.parse(today+"T12:00:00Z")+14*86400000).toISOString().slice(0,10);
  return (Array.isArray(rows) ? rows : []).flatMap(prof => {
    if (isEndoscopyBooking({...prof,tipo:prof.tipo_cita}) || prof.is_resource === true ||
      prof.es_activo === false || prof.permite_agendaweb === false ||
      ![prof.id,prof.branchId,prof.especialidad_id,prof.tipo_cita,prof.duracion_cita].every(positive)) return [];
    const cupos = (prof.cupos || []).flatMap(c => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha || "") || c.fecha < today || c.fecha >= end) return [];
      const horas = [...new Set((Array.isArray(c.horas) ? c.horas : []).filter(h =>
        typeof h === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(h) && (c.fecha > today || h > time)))].sort();
      return horas.length ? [{fecha:c.fecha,horas}] : [];
    });
    return cupos.length ? [{...prof,cupos}] : [];
  });
}

export function publishedSlots(rows, {query,branchId,professionalId} = {}) {
  const tokens = norm(query).split(/\s+/).filter(t => t && !["dr","dra","doctor","doctora"].includes(t));
  return rows.flatMap(p => {
    if (branchId && String(p.branchId)!==String(branchId)) return [];
    if (professionalId && String(p.id)!==String(professionalId)) return [];
    const name = [p.nombres,p.paterno,p.materno].filter(Boolean).join(" ");
    if (!professionalId && (!tokens.length || !tokens.every(t => norm(name).includes(t)) &&
        !norm(p.especialidad).includes(norm(query)))) return [];
    return p.cupos.flatMap(c => c.horas.map(time => ({
      professionalId:String(p.id), professional:name, specialtyId:String(p.especialidad_id),
      specialty:p.especialidad, tipoCitaId:String(p.tipo_cita), duration:Number(p.duracion_cita),
      branchId:Number(p.branchId), branchName:p.branchName, dataDia:c.fecha,
      date:c.fecha.split("-").reverse().join("/"), time, source:"agendaweb"
    })));
  }).sort((a,b) => (a.dataDia+a.time).localeCompare(b.dataDia+b.time));
}

export function samePublishedSlot(a,b) {
  return ["professionalId","branchId","specialtyId","tipoCitaId","duration","dataDia","time"]
    .every(k => a?.[k] != null && b?.[k] != null && String(a[k])===String(b[k]));
}

export async function reservePublishedSlot({slot,patientData,load,check,post}) {
  const failure = step => ({success:false,step,message:UNAVAILABLE,patient_reply:UNAVAILABLE});
  if (!slot || isEndoscopyBooking({...slot,tipo:slot.tipoCitaId})) return failure("agendaweb_only");
  const eligibility = await check(slot.branchId,patientData.rut || patientData.run || "");
  // This existing-patient route must not silently create an incomplete patient record.
  if (eligibility?.paciente_existe !== true || eligibility?.puede_agendar === false) return failure("patient_review_required");
  const current = publishedSlots(await load(),{professionalId:slot.professionalId,branchId:slot.branchId});
  const exact = current.find(candidate=>samePublishedSlot(candidate,slot));
  if (!exact) return failure("slot_revalidate");
  // One POST only: a timeout or ambiguous response must never trigger a fallback.
  const result = await post({run:patientData.rut || patientData.run,fecha:exact.dataDia,hora:exact.time,
    profesional:exact.professionalId,especialidad:exact.specialtyId,tipo:exact.tipoCitaId,
    duracion:exact.duration,ubicacion:exact.branchId,pacienteExiste:true,
    email:patientData.email,telefono:patientData.fono});
  if (result?.status!=="agendado_correctamente") return failure("booking_unconfirmed");
  return {success:true,source:"agendaweb",booking:result,slot:exact,
    message:"Reserva confirmada en Agenda Web."};
}
