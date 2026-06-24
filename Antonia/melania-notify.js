/**
 * melania-notify.js — Notificación inmediata al backend tras una reserva
 * exitosa de Antonia.
 *
 * Flujo:
 *   1. Login JWT contra Medinet (mismo /token-login/ que usa el ingest).
 *   2. GET /api-public/schedule/appointment/all-appointments/{day}/{day}/?branch_id=X
 *   3. Filtrar por RUT (y hora si está disponible) → obtener la cita
 *      recién creada con su `id` real.
 *   4. Normalizar al contrato del intake (mismo que melania-ingest.mjs).
 *   5. POST a sell-medinet-backend/confirmations/intake (Bearer).
 *
 * El intake del backend dispara el 1er WhatsApp inline al crearse → la
 * confirmación llega en segundos, sin depender del cron poller.
 *
 * Fire-and-forget desde Antonia: errores se loguean, no se relanzan.
 *
 * Env requeridas (las mismas que el ingest):
 *   MEDINET_USER / MEDINET_USER_KEY (o MEDINET_JWT_USERNAME/PASSWORD)
 *   SELL_MEDINET_INTAKE_TOKEN
 * Opcionales:
 *   SELL_MEDINET_BACKEND_URL  default https://sell-medinet-backend.onrender.com
 *   MELANIA_TZ_OFFSET         default "-04:00"
 */

const MEDINET_BASE = 'https://clinyco.medinetapp.com';
const BACKEND_URL = (
  process.env.SELL_MEDINET_BACKEND_URL || 'https://sell-medinet-backend.onrender.com'
).replace(/\/+$/, '');
const TZ_OFFSET = process.env.MELANIA_TZ_OFFSET || '-04:00';

async function loginJwt() {
  const pairs = [
    [process.env.MEDINET_USER, process.env.MEDINET_USER_KEY],
    [process.env.MEDINET_JWT_USERNAME, process.env.MEDINET_JWT_PASSWORD],
  ].filter(([u, p]) => u && p);

  if (!pairs.length) {
    throw new Error(
      'faltan credenciales: MEDINET_USER/MEDINET_USER_KEY o MEDINET_JWT_USERNAME/MEDINET_JWT_PASSWORD'
    );
  }

  let lastErr = '';
  for (const [username, password] of pairs) {
    const res = await fetch(`${MEDINET_BASE}/token-login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const text = await res.text();
    if (res.ok) {
      try {
        const { token } = JSON.parse(text);
        if (token) return token;
      } catch {
        // continúa al fallback
      }
      lastErr = `respuesta sin token: ${text.slice(0, 120)}`;
    } else {
      lastErr = `${res.status} ${text.slice(0, 120)}`;
    }
  }
  throw new Error(`token-login falló: ${lastErr}`);
}

async function fetchAppointmentsForDay(jwt, branchId, day) {
  const path = `/api-public/schedule/appointment/all-appointments/${day}/${day}/?branch_id=${branchId}`;
  const res = await fetch(`${MEDINET_BASE}${path}`, {
    headers: { Authorization: `MEDINET_JWT ${jwt}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`all-appointments ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function normalizeRun(s) {
  return String(s || '').replace(/[.\s-]/g, '').toUpperCase();
}

function normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  let canonical;
  if (digits.length === 11 && digits.startsWith('569')) canonical = digits;
  else if (digits.length === 9 && digits.startsWith('9')) canonical = `56${digits}`;
  else return '';
  return `+${canonical}`;
}

function joinName(o) {
  return [o?.nombres, o?.paterno, o?.materno]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' ');
}

function buildIntakePayload(appt) {
  const paciente = appt.paciente || {};
  const phone = normalizePhone(paciente.telefono) || normalizePhone(paciente.telefono_2);
  if (!phone) throw new Error('teléfono del paciente inválido o ausente');
  const fecha = String(appt.fecha || '').replace(/\//g, '-');
  const hora = String(appt.hora || '00:00').padStart(5, '0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error(`fecha Medinet inválida: ${appt.fecha}`);
  }
  return {
    external_id: Number(appt.id),
    branch_id: Number(appt?.sucursal?.id),
    branch_name: appt?.sucursal?.nombre || null,
    branch_address: appt?.sucursal?.direccion || null,
    specialty: appt?.especialidad_nombre || null,
    professional: joinName(appt?.profesional) || null,
    appointment_at: `${fecha}T${hora}:00${TZ_OFFSET}`,
    duration_min: Number(appt?.duracion) || null,
    medinet_state: appt?.estado?.nombre || null,
    patient: {
      run: paciente.run || null,
      name: joinName(paciente) || null,
      phone,
      email: paciente.email || null,
    },
    raw: appt,
  };
}

async function postIntake(payload) {
  const token = process.env.SELL_MEDINET_INTAKE_TOKEN;
  if (!token) throw new Error('SELL_MEDINET_INTAKE_TOKEN no está configurado');
  const res = await fetch(`${BACKEND_URL}/confirmations/intake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`intake ${res.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

/**
 * Busca la cita recién creada y la postea al intake del backend.
 *
 * Reintenta hasta 3 veces (1s entre intentos) porque Medinet puede tardar
 * unos segundos en exponer la cita por la API tras el submit del formulario.
 *
 * @param {object} args
 * @param {string|number} args.branchId  id de sucursal Medinet
 * @param {string} args.slotDate         "YYYY-MM-DD"
 * @param {string} args.rut              RUT del paciente recién agendado
 * @param {string} [args.slotTime]       "HH:MM" — opcional, ayuda a desambiguar
 */
async function notifyMelaniaAfterBooking({ branchId, slotDate, rut, slotTime }) {
  const t0 = Date.now();
  try {
    if (!branchId || !slotDate || !rut) {
      console.warn('[melania-notify] faltan args:', { branchId, slotDate, rut });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) {
      throw new Error(`slotDate inválido: ${slotDate} (esperado YYYY-MM-DD)`);
    }

    const jwt = await loginJwt();
    const rutNorm = normalizeRun(rut);

    let target = null;
    for (let attempt = 1; attempt <= 3 && !target; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1000));
      const appts = await fetchAppointmentsForDay(jwt, branchId, slotDate);
      const matches = appts.filter((a) => normalizeRun(a?.paciente?.run) === rutNorm);
      target = slotTime
        ? matches.find((a) => String(a?.hora || '').slice(0, 5) === slotTime.slice(0, 5))
        : matches[0];
      if (!target && matches.length) target = matches[matches.length - 1]; // la más nueva si no matchea hora
    }

    if (!target) {
      console.warn(
        `[melania-notify] no encontré cita para RUT ${rut} en branch ${branchId} el ${slotDate}`
      );
      return;
    }

    const payload = buildIntakePayload(target);
    const out = await postIntake(payload);
    console.log(
      `[melania-notify] intake OK external_id=${payload.external_id} (${Date.now() - t0}ms): ${out.slice(0, 200)}`
    );
  } catch (err) {
    console.error('[melania-notify] error:', err.message);
  }
}

module.exports = { notifyMelaniaAfterBooking };
