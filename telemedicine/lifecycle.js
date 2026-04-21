import { query } from "./db.js";
import { sendWhatsApp } from "./waha-client.js";
import { buildSessionUrl } from "./session-link.js";
import { createPaymentIntent, verifyPayment } from "./payment-bice.js";
import * as tpl from "./templates.js";

export const TELEMEDICINE_BRANCH_IDS = [2, 3];

const REMINDER_KINDS = {
  confirm: { offsetMs: 0 },
  reminder_5d: { offsetMs: -5 * 24 * 60 * 60 * 1000 },
  reminder_2d: { offsetMs: -2 * 24 * 60 * 60 * 1000 },
  reminder_16h: { offsetMs: -16 * 60 * 60 * 1000 },
};

const DEFAULT_AMOUNT_CLP = Number(process.env.TELEMEDICINE_DEFAULT_AMOUNT_CLP || 25000);

function formatStarts(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function professionalDisplay(row) {
  return row.professional_name || `Profesional #${row.professional_id || ""}`.trim();
}

async function scheduleReminders(appointmentId, startsAt) {
  const starts = new Date(startsAt).getTime();
  for (const [kind, cfg] of Object.entries(REMINDER_KINDS)) {
    const scheduledFor = new Date(starts + cfg.offsetMs);
    await query(
      `insert into telemedicine_reminders (appointment_id, kind, scheduled_for)
       values ($1, $2, $3)
       on conflict (appointment_id, kind) do nothing`,
      [appointmentId, kind, scheduledFor.toISOString()]
    );
  }
}

/**
 * Upsert a telemedicine appointment by medinet_appointment_id. Called by both
 * the realtime booking hook and the Medinet polling ingest.
 *
 * @param {object} record - normalized appointment shape.
 * @returns {{ id: number, inserted: boolean }}
 */
export async function upsertAppointment(record) {
  if (!record.medinetAppointmentId) {
    throw new Error("medinetAppointmentId is required");
  }
  if (!TELEMEDICINE_BRANCH_IDS.includes(Number(record.branchId))) {
    return { id: null, inserted: false, skipped: "not_telemedicine" };
  }
  if (!record.startsAt) {
    throw new Error("startsAt is required");
  }

  const { rows } = await query(
    `insert into telemedicine_appointments (
       medinet_appointment_id, branch_id, customer_id, conversation_id,
       patient_rut, patient_name, whatsapp_phone, email,
       professional_id, professional_name, professional_phone,
       specialty, starts_at, duration_minutes, source, raw_medinet_json
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
     )
     on conflict (medinet_appointment_id) do update set
       patient_name = coalesce(excluded.patient_name, telemedicine_appointments.patient_name),
       whatsapp_phone = coalesce(excluded.whatsapp_phone, telemedicine_appointments.whatsapp_phone),
       email = coalesce(excluded.email, telemedicine_appointments.email),
       professional_name = coalesce(excluded.professional_name, telemedicine_appointments.professional_name),
       professional_phone = coalesce(excluded.professional_phone, telemedicine_appointments.professional_phone),
       starts_at = excluded.starts_at,
       updated_at = now()
     returning id, (xmax = 0) as inserted`,
    [
      record.medinetAppointmentId,
      record.branchId,
      record.customerId || null,
      record.conversationId || null,
      record.patientRut || null,
      record.patientName || null,
      record.whatsappPhone || null,
      record.email || null,
      record.professionalId || null,
      record.professionalName || null,
      record.professionalPhone || null,
      record.specialty || null,
      new Date(record.startsAt).toISOString(),
      record.durationMinutes || null,
      record.source || "polling",
      record.rawMedinetJson ? JSON.stringify(record.rawMedinetJson) : null,
    ]
  );

  const { id, inserted } = rows[0];
  if (inserted) {
    await scheduleReminders(id, record.startsAt);
  }
  return { id, inserted };
}

async function getAppointmentById(id) {
  const { rows } = await query(`select * from telemedicine_appointments where id = $1`, [id]);
  return rows[0] || null;
}

async function getReminder(id) {
  const { rows } = await query(`select * from telemedicine_reminders where id = $1`, [id]);
  return rows[0] || null;
}

async function markReminderSent(id, error = null) {
  await query(
    `update telemedicine_reminders
       set sent_at = case when $2::text is null then now() else sent_at end,
           attempts = attempts + 1,
           last_error = $2
     where id = $1`,
    [id, error]
  );
}

async function setAppointmentStatus(id, patch) {
  const cols = [];
  const vals = [];
  let idx = 1;
  for (const [k, v] of Object.entries(patch)) {
    cols.push(`${k} = $${idx++}`);
    vals.push(v);
  }
  cols.push(`updated_at = now()`);
  vals.push(id);
  await query(`update telemedicine_appointments set ${cols.join(", ")} where id = $${idx}`, vals);
}

async function sendAndLog(appt, text, { phoneField = "whatsapp_phone" } = {}) {
  const phone = appt[phoneField];
  if (!phone) return { sent: false, reason: "no_phone" };
  try {
    const result = await sendWhatsApp(phone, text);
    return result;
  } catch (err) {
    console.warn("[telemedicine] sendWhatsApp error:", err.message);
    return { sent: false, error: err.message };
  }
}

export async function confirmAppointment(apptId) {
  const appt = await getAppointmentById(apptId);
  if (!appt) return { ok: false, reason: "not_found" };
  if (appt.status !== "booked") return { ok: true, skipped: `status_${appt.status}` };

  let paymentReference = appt.payment_reference;
  let paymentUrl = appt.payment_url;
  if (!paymentReference) {
    try {
      const intent = await createPaymentIntent({
        appointmentId: appt.id,
        amount: appt.payment_amount || DEFAULT_AMOUNT_CLP,
        patient: { rut: appt.patient_rut, name: appt.patient_name },
      });
      paymentReference = intent.paymentReference;
      paymentUrl = intent.paymentUrl;
      await setAppointmentStatus(apptId, {
        payment_reference: paymentReference,
        payment_url: paymentUrl,
        payment_amount: appt.payment_amount || DEFAULT_AMOUNT_CLP,
      });
    } catch (err) {
      await setAppointmentStatus(apptId, { last_error: `bice_intent: ${err.message}` });
      return { ok: false, reason: "bice_intent_failed", error: err.message };
    }
  }

  const text = tpl.confirmation({
    patientName: appt.patient_name || "paciente",
    starts: formatStarts(appt.starts_at),
    professional: professionalDisplay(appt),
    specialty: appt.specialty || "telemedicina",
    paymentUrl,
  });
  const send = await sendAndLog({ ...appt, whatsapp_phone: appt.whatsapp_phone }, text);

  await setAppointmentStatus(apptId, {
    status: "confirmed",
    payment_status: "pending",
    confirmed_at: new Date().toISOString(),
  });

  return { ok: true, send };
}

export async function markPaymentConfirmed(apptId) {
  const appt = await getAppointmentById(apptId);
  if (!appt) return { ok: false, reason: "not_found" };
  if (appt.payment_status === "confirmed") return { ok: true, skipped: "already_confirmed" };

  const { url: sessionUrl, token: sessionToken } = buildSessionUrl({
    appointmentId: appt.id,
    startsAt: appt.starts_at,
  });

  await setAppointmentStatus(apptId, {
    payment_status: "confirmed",
    payment_confirmed_at: new Date().toISOString(),
    session_url: sessionUrl,
    session_token: sessionToken,
    status: "payment_confirmed",
  });

  const patientText = tpl.sessionLinkToPatient({
    patientName: appt.patient_name || "paciente",
    starts: formatStarts(appt.starts_at),
    professional: professionalDisplay(appt),
    sessionUrl,
  });
  const patientSend = await sendAndLog(appt, patientText);

  const profText = tpl.professionalNotify({
    professionalName: appt.professional_name || "profesional",
    patientName: appt.patient_name || "paciente",
    patientRut: appt.patient_rut || "",
    starts: formatStarts(appt.starts_at),
    specialty: appt.specialty || "telemedicina",
    sessionUrl,
  });
  const profSend = appt.professional_phone
    ? await sendAndLog(appt, profText, { phoneField: "professional_phone" })
    : { sent: false, reason: "no_professional_phone" };

  await setAppointmentStatus(apptId, {
    status: "session_ready",
    session_delivered_at: new Date().toISOString(),
    professional_notified_at: profSend.sent ? new Date().toISOString() : null,
  });

  return { ok: true, patientSend, profSend };
}

export async function handleReminderTick({ limit = 50 } = {}) {
  const { rows: due } = await query(
    `select id from telemedicine_reminders
     where sent_at is null and scheduled_for <= now()
     order by scheduled_for asc
     limit $1`,
    [limit]
  );

  const results = [];
  for (const { id: reminderId } of due) {
    try {
      const r = await dispatchReminder(reminderId);
      results.push({ reminderId, ...r });
    } catch (err) {
      await markReminderSent(reminderId, err.message).catch(() => {});
      results.push({ reminderId, ok: false, error: err.message });
    }
  }
  return { processed: results.length, results };
}

async function dispatchReminder(reminderId) {
  const reminder = await getReminder(reminderId);
  if (!reminder || reminder.sent_at) return { ok: true, skipped: "already_sent" };

  const appt = await getAppointmentById(reminder.appointment_id);
  if (!appt) {
    await markReminderSent(reminderId, "appointment_missing");
    return { ok: false, reason: "appointment_missing" };
  }

  const vars = {
    patientName: appt.patient_name || "paciente",
    starts: formatStarts(appt.starts_at),
    professional: professionalDisplay(appt),
    paymentUrl: appt.payment_url || "",
    isPaid: appt.payment_status === "confirmed",
    sessionUrl: appt.session_url || "",
  };

  let action = null;
  switch (reminder.kind) {
    case "confirm":
      action = await confirmAppointment(appt.id);
      break;
    case "reminder_5d":
      action = await sendAndLog(appt, tpl.reminder5d(vars));
      if (appt.status === "booked") {
        await confirmAppointment(appt.id).catch(() => {});
      }
      await setAppointmentStatus(appt.id, { status: stagedStatus(appt.status, "reminded_5d") });
      break;
    case "reminder_2d":
      action = await sendAndLog(appt, tpl.reminder2d(vars));
      await setAppointmentStatus(appt.id, { status: stagedStatus(appt.status, "reminded_2d") });
      break;
    case "reminder_16h":
      action = await sendAndLog(appt, tpl.reminder16h(vars));
      await setAppointmentStatus(appt.id, { status: stagedStatus(appt.status, "reminded_16h") });
      break;
    default:
      await markReminderSent(reminderId, `unknown_kind:${reminder.kind}`);
      return { ok: false, reason: "unknown_kind" };
  }

  const errText = action?.error || (action?.sent === false && action?.reason ? `skipped:${action.reason}` : null);
  await markReminderSent(reminderId, errText);
  return { ok: !errText, action };
}

function stagedStatus(current, next) {
  const terminalStatuses = new Set(["payment_confirmed", "session_ready", "completed", "canceled", "no_show"]);
  if (terminalStatuses.has(current)) return current;
  return next;
}

export async function handlePaymentPollTick({ limit = 25 } = {}) {
  const { rows } = await query(
    `select id, payment_reference
       from telemedicine_appointments
      where payment_status = 'pending'
        and payment_reference is not null
      order by updated_at asc
      limit $1`,
    [limit]
  );

  const results = [];
  for (const row of rows) {
    try {
      const verify = await verifyPayment(row.payment_reference);
      if (verify.status === "paid") {
        await markPaymentConfirmed(row.id);
        results.push({ id: row.id, status: "paid" });
      } else if (verify.status === "failed") {
        await setAppointmentStatus(row.id, { payment_status: "failed" });
        results.push({ id: row.id, status: "failed" });
      } else {
        results.push({ id: row.id, status: "pending" });
      }
    } catch (err) {
      await setAppointmentStatus(row.id, { last_error: `bice_verify: ${err.message}` });
      results.push({ id: row.id, status: "error", error: err.message });
    }
  }
  return { processed: results.length, results };
}

/**
 * Realtime hook called by server.js after a successful booking.
 * bookingResult: shape from workers/medinet-worker.js::/melania/book.
 */
export async function onBookingSuccess({ bookingResult, patientData, slot }) {
  if (!bookingResult?.success) return { ok: false, reason: "booking_not_successful" };
  const branchId = Number(slot?.branchId);
  if (!TELEMEDICINE_BRANCH_IDS.includes(branchId)) return { ok: true, skipped: "not_telemedicine" };

  const medinetAppointmentId = bookingResult.appointmentId;
  if (!medinetAppointmentId) return { ok: false, reason: "missing_appointment_id" };

  const startsAt = combineDateAndTime(slot?.dataDia || slot?.date || bookingResult.slot?.date, slot?.time || bookingResult.slot?.time);
  if (!startsAt) return { ok: false, reason: "invalid_starts_at" };

  const record = {
    medinetAppointmentId,
    branchId,
    patientRut: patientData?.rut || patientData?.run || null,
    patientName: [patientData?.nombres, patientData?.apPaterno, patientData?.apMaterno].filter(Boolean).join(" ") || null,
    whatsappPhone: patientData?.fono || patientData?.whatsappPhone || null,
    email: patientData?.email || null,
    professionalId: slot?.professionalId || null,
    professionalName: slot?.professional || null,
    professionalPhone: slot?.professionalPhone || null,
    specialty: slot?.specialty || null,
    startsAt,
    durationMinutes: slot?.duration || null,
    source: "bot_hook",
    rawMedinetJson: bookingResult.medinet || null,
  };

  const { id, inserted } = await upsertAppointment(record);
  return { ok: true, id, inserted };
}

function combineDateAndTime(date, time) {
  if (!date || !time) return null;
  // date expected as "YYYY-MM-DD", time as "HH:MM"
  const iso = `${date}T${time.length === 5 ? time : time.slice(0, 5)}:00-04:00`; // Chile offset
  const parsed = new Date(iso);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
