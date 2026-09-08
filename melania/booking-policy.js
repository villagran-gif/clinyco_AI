// Endoscopy appointments are handled exclusively by the human scheduling team.
export const ENDOSCOPY_HANDOFF = "Las endoscopias deben agendarse directamente con nuestro equipo de atención. AntonIA y MelanIA no pueden ofrecer ni confirmar horas para ese procedimiento.";

export function isEndoscopyBooking(value) {
  if (!value || typeof value !== "object") return false;
  if ([value.branchId, value.branch_id, value.ubicacion].some(v => String(v) === "38")) return true;
  if ([value.especialidad_id, value.specialtyId, value.especialidad].some(v => String(v) === "58")) return true;
  if ([value.tipo, value.appointmentTypeId, value.tipoId].some(v => String(v) === "235")) return true;
  return [value.branchName, value.especialidad, value.specialty, value.appointmentType,
    value.appointmentTypeName, value.tipoNombre, value.tipo_cita, value.prestacion]
    .some(v => typeof v === "string" && /endoscop|gastroscop/i.test(v.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
}

export function endoscopyExit(state = {}) {
  return { reply: ENDOSCOPY_HANDOFF, done: true, failReason: "endoscopy_human_only",
    melaniaState: { ...state, active: false, step: "human_required", chosenSlot: null, availableSlots: null, chosenProfessional: null } };
}
