import { createHash } from 'node:crypto';
import { samePublishedSlot } from '../melania/agendaweb-only.js';

const fingerprint = (slot, patient) => createHash('sha256').update(JSON.stringify({
  slot, rut:patient.rut, email:patient.email, fono:patient.fono,
})).digest('hex');
const describe = slot => `${slot.date} a las ${slot.time}, con ${slot.professional}, ${slot.branchName}`;
const required = [['rut','RUT'],['email','correo electrónico'],['fono','teléfono']];

export function bookingPatientData(state) {
  const facts = state.conversation?.facts || [];
  const own = field => facts.find(f => f.field === field && f.subject === 'self')?.value;
  const historical = state.identity?.safeToUseHistoricalContext ? state.contactDraft || {} : {};
  return {rut:own('rut') || historical.c_rut || '',email:own('email') || historical.c_email || '',
    fono:own('phone') || historical.c_tel1 || ''};
}

// The model proposes an operation; this boundary owns actual slots, consent,
// patient data, one-shot execution and receipts. No model-authored payload POST.
export async function runModelBooking({state,plan,userText,messageId,search,reserve,persist,assertActive,now=Date.now()}) {
  state.booking ||= {};
  const booking = state.booking;
  const patient = bookingPatientData(state);
  const blocked = 'La reserva anterior debe verificarse en Medinet antes de intentar otra. No tengo confirmación suficiente para repetirla.';
  await assertActive();
  if (['pending','uncertain'].includes(booking.modelAttempt?.status)) return blocked;
  if (plan.operation === 'cancel_draft') {
    booking.pendingSlots=[];booking.chosenSlot=null;booking.modelConfirmation=null;
    await persist();
    return 'Dejé de preparar esta reserva. Esto no cancela ninguna cita ya registrada en Medinet.';
  }
  if (plan.operation === 'search') {
    const result = await search({query:plan.query,branchId:plan.branchId || undefined});
    await assertActive();
    booking.pendingSlots = result.available_slots || [];
    booking.chosenSlot = null;booking.modelConfirmation=null;
    await persist();
    return result.patient_reply;
  }
  if (plan.operation === 'select') {
    const slot = booking.pendingSlots?.[plan.slotIndex - 1];
    if (!slot || slot.source !== 'agendaweb') return 'Esa opción no corresponde a los cupos consultados. Necesitamos consultar la disponibilidad nuevamente.';
    booking.chosenSlot = slot;booking.modelConfirmation=null;
  }
  if (!booking.chosenSlot) return 'Primero necesitamos consultar y elegir un cupo publicado para preparar la reserva.';
  const missing = required.filter(([key]) => !patient[key]).map(([,label]) => label);
  if (missing.length) {
    await persist();
    return `Seleccionaste ${describe(booking.chosenSlot)}. Para preparar la reserva faltan: ${missing.join(', ')}.`;
  }
  const key = fingerprint(booking.chosenSlot,patient);
  const confirmation = booking.modelConfirmation;
  const explicit = /^(?:s[ií]|s[ií],? confirmo|confirmo(?: la reserva)?|confirmar|dale|de acuerdo|ok|1)[.!\s]*$/i.test(userText.trim());
  if (plan.operation === 'confirm' && explicit && confirmation?.presented === true && confirmation.fingerprint === key &&
      confirmation.messageId !== String(messageId) && now - confirmation.at < 10*60*1000) {
    if (booking.modelAttempt?.fingerprint === key && booking.modelAttempt.status === 'confirmed') return 'Esa reserva ya tiene confirmación; no la repetiré.';
    booking.modelAttempt={fingerprint:key,status:'pending'};
    // Persistence must succeed before the external effect, including restart.
    await persist();await assertActive();
    let result;
    try { result = await reserve({slot:booking.chosenSlot,patientData:patient}); }
    catch { result={success:false,step:'booking_unconfirmed'}; }
    const verified = result?.success === true && result.booking?.status === 'agendado_correctamente' &&
      samePublishedSlot(result.slot, booking.chosenSlot);
    const uncertain = !verified && (result?.success === true || ['booking_unconfirmed',undefined].includes(result?.step));
    booking.modelAttempt={fingerprint:key,status:verified?'confirmed':uncertain?'uncertain':'rejected',receipt:result?.booking || null};
    booking.modelConfirmation=null;
    if (verified) { booking.chosenSlot=null;booking.pendingSlots=[]; }
    await persist();
    return verified ? `Reserva confirmada en Agenda Web: ${describe(result.slot)}.`
      : uncertain ? blocked : 'No se pudo confirmar la reserva con las validaciones de Agenda Web. Necesitamos revisar los datos y el cupo antes de continuar.';
  }
  booking.modelConfirmation={fingerprint:key,at:now,messageId:String(messageId),presented:false};
  await persist();
  return `Reserva por confirmar: ${describe(booking.chosenSlot)}. RUT ${patient.rut}, correo ${patient.email}, teléfono ${patient.fono}. ¿Confirmas que reserve con estos datos?`;
}
