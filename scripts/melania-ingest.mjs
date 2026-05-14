#!/usr/bin/env node
/**
 * scripts/melania-ingest.mjs — Cable de ingesta MelanIA (standalone).
 *
 * Corre EN EL VPS CHILENO (único con acceso geo a Medinet). Hace:
 *   1. Login JWT contra Medinet (/token-login/).
 *   2. fetchAllAppointments para un rango de fechas y un set de sucursales.
 *   3. Normaliza el shape Medinet → contrato de /confirmations/intake.
 *   4. Filtra pacientes sintéticos y estados no accionables.
 *   5. POST a sell-medinet-backend/confirmations/intake (Bearer).
 *
 * Es idempotente del lado del backend (upsert por external_id), así que
 * se puede correr por cron cada N minutos sin duplicar.
 *
 * Uso:
 *   node scripts/melania-ingest.mjs              # corre el ciclo completo
 *   node scripts/melania-ingest.mjs --dry-run    # normaliza pero NO postea
 *   node scripts/melania-ingest.mjs --days 14    # override ventana
 *
 * Sin dependencias externas: fetch nativo (Node ≥18).
 *
 * Env requeridas (del .env de clinyco_AI):
 *   MEDINET_USER / MEDINET_USER_KEY          credenciales JWT (las que funcionan)
 *   MEDINET_JWT_USERNAME / MEDINET_JWT_PASSWORD   fallback (post Opción A)
 *   SELL_MEDINET_BACKEND_URL                 default https://sell-medinet-backend.onrender.com
 *   SELL_MEDINET_INTAKE_TOKEN                = CONFIRMATIONS_INTAKE_TOKEN del backend
 * Env opcionales:
 *   MELANIA_INGEST_BRANCH_IDS                CSV, default "39,38,41,2,3"
 *   MELANIA_INGEST_DAYS_AHEAD                default 7
 *   MELANIA_INGEST_STATES                    CSV de estado.id a procesar, default "1,2,6"
 *   MELANIA_TZ_OFFSET                        default "-04:00" (Chile horario estándar)
 */

const MEDINET_BASE = "https://clinyco.medinetapp.com";
const BACKEND_URL = (
  process.env.SELL_MEDINET_BACKEND_URL || "https://sell-medinet-backend.onrender.com"
).replace(/\/+$/, "");
const INTAKE_TOKEN = process.env.SELL_MEDINET_INTAKE_TOKEN || "";

const BRANCH_IDS = (process.env.MELANIA_INGEST_BRANCH_IDS || "39,38,41,2,3")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Number.isFinite);

const DAYS_AHEAD = (() => {
  const flagIdx = process.argv.indexOf("--days");
  if (flagIdx !== -1) {
    const n = Number(process.argv[flagIdx + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const n = Number(process.env.MELANIA_INGEST_DAYS_AHEAD);
  return Number.isFinite(n) && n > 0 ? n : 7;
})();

const PROCESS_STATES = new Set(
  (process.env.MELANIA_INGEST_STATES || "1,2,6")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite)
);

const TZ_OFFSET = process.env.MELANIA_TZ_OFFSET || "-04:00";
const DRY_RUN = process.argv.includes("--dry-run");

// Pacientes sintéticos / slots administrativos — NO se les manda WhatsApp.
const SYNTHETIC_RUNS = new Set(["77.777.777-7", "77777777-7", "777777777"]);
const SYNTHETIC_NAME_HINTS = [
  "ANTIGUOS PACIENTES",
  "PACIENTE NUEVO",
  "NUEVO X DIA",
  "PACIENTES INDICADOS",
];

// ----------------------------------------------------------------
// Auth
// ----------------------------------------------------------------
async function loginJwt() {
  const pairs = [
    [process.env.MEDINET_USER, process.env.MEDINET_USER_KEY],
    [process.env.MEDINET_JWT_USERNAME, process.env.MEDINET_JWT_PASSWORD],
  ].filter(([u, p]) => u && p);

  if (pairs.length === 0) {
    throw new Error(
      "Faltan credenciales: definir MEDINET_USER/MEDINET_USER_KEY o MEDINET_JWT_USERNAME/MEDINET_JWT_PASSWORD"
    );
  }

  let lastErr = "";
  for (const [username, password] of pairs) {
    const res = await fetch(`${MEDINET_BASE}/token-login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const text = await res.text();
    if (res.ok) {
      let token;
      try {
        token = JSON.parse(text).token;
      } catch {
        token = null;
      }
      if (token) {
        console.log(`[ingest] login OK como "${username}"`);
        return token;
      }
      lastErr = `respuesta sin token: ${text.slice(0, 120)}`;
    } else {
      lastErr = `${res.status} ${text.slice(0, 120)}`;
      console.warn(`[ingest] login falló como "${username}": ${lastErr}`);
    }
  }
  throw new Error(`No se pudo obtener JWT. Último error: ${lastErr}`);
}

// ----------------------------------------------------------------
// Fetch
// ----------------------------------------------------------------
async function fetchAppointments(jwt, branchId, fromDate, toDate) {
  const path = `/api-public/schedule/appointment/all-appointments/${fromDate}/${toDate}/?branch_id=${branchId}`;
  const res = await fetch(`${MEDINET_BASE}${path}`, {
    headers: { Authorization: `MEDINET_JWT ${jwt}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`all-appointments branch ${branchId}: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// ----------------------------------------------------------------
// Normalize + filter
// ----------------------------------------------------------------
function normalizePhone(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  // Conserva un + inicial, descarta todo lo no-dígito.
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return digits ? (hasPlus ? `+${digits}` : digits) : "";
}

function isSyntheticPatient(paciente) {
  const run = String(paciente?.run || "").trim();
  if (SYNTHETIC_RUNS.has(run)) return true;
  if (!run) return true; // sin RUN = slot administrativo

  const phone = normalizePhone(paciente?.telefono || paciente?.telefono_2);
  // +56 9 9999 9999 y similares de relleno
  if (/^\+?569?9{6,}$/.test(phone)) return true;
  if (!phone) return true;

  const fullName = [paciente?.nombres, paciente?.paterno, paciente?.materno]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  if (SYNTHETIC_NAME_HINTS.some((h) => fullName.includes(h))) return true;

  return false;
}

function joinName(obj) {
  return [obj?.nombres, obj?.paterno, obj?.materno]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Medinet shape → contrato /confirmations/intake.
 * Devuelve null si la cita debe descartarse (con motivo logueado por el caller).
 */
function normalize(appt) {
  const estadoId = Number(appt?.estado?.id);
  if (!PROCESS_STATES.has(estadoId)) {
    return { skip: `estado ${estadoId} (${appt?.estado?.nombre}) no accionable` };
  }

  const paciente = appt?.paciente || {};
  if (isSyntheticPatient(paciente)) {
    return { skip: "paciente sintético / slot administrativo" };
  }

  const phone = normalizePhone(paciente.telefono || paciente.telefono_2);
  if (!phone) return { skip: "sin teléfono" };

  // fecha "2026/05/12" + hora "15:30" → ISO con offset Chile
  const fecha = String(appt?.fecha || "").replace(/\//g, "-");
  const hora = String(appt?.hora || "00:00");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { skip: `fecha inválida: ${appt?.fecha}` };
  }
  const appointmentAtIso = `${fecha}T${hora.padStart(5, "0")}:00${TZ_OFFSET}`;
  const appointmentAt = new Date(appointmentAtIso);
  if (Number.isNaN(appointmentAt.getTime())) {
    return { skip: `appointment_at no parseable: ${appointmentAtIso}` };
  }
  if (appointmentAt.getTime() <= Date.now()) {
    return { skip: "cita en el pasado" };
  }

  return {
    payload: {
      external_id: Number(appt.id),
      branch_id: Number(appt?.sucursal?.id),
      branch_name: appt?.sucursal?.nombre || null,
      specialty: appt?.especialidad_nombre || null,
      professional: joinName(appt?.profesional) || null,
      appointment_at: appointmentAtIso,
      duration_min: Number(appt?.duracion) || null,
      medinet_state: appt?.estado?.nombre || null,
      patient: {
        run: paciente.run || null,
        name: joinName(paciente) || null,
        phone,
        email: paciente.email || null,
      },
      raw: appt,
    },
  };
}

// ----------------------------------------------------------------
// Push
// ----------------------------------------------------------------
async function pushIntake(payload) {
  const res = await fetch(`${BACKEND_URL}/confirmations/intake`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INTAKE_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`intake ${res.status}: ${text.slice(0, 200)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  return json;
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------
function ymd(date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  if (!INTAKE_TOKEN && !DRY_RUN) {
    throw new Error("Falta SELL_MEDINET_INTAKE_TOKEN (o usa --dry-run)");
  }

  const from = new Date();
  const to = new Date(Date.now() + DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const fromStr = ymd(from);
  const toStr = ymd(to);

  console.log(
    `[ingest] rango ${fromStr} → ${toStr} | sucursales ${BRANCH_IDS.join(",")} | ` +
      `estados ${[...PROCESS_STATES].join(",")} | ${DRY_RUN ? "DRY-RUN" : "LIVE"}`
  );

  const jwt = await loginJwt();

  const totals = {
    fetched: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    errors: 0,
  };

  for (const branchId of BRANCH_IDS) {
    let appointments;
    try {
      appointments = await fetchAppointments(jwt, branchId, fromStr, toStr);
    } catch (err) {
      console.error(`[ingest] branch ${branchId} fetch falló: ${err.message}`);
      totals.errors++;
      continue;
    }
    totals.fetched += appointments.length;
    console.log(`[ingest] branch ${branchId}: ${appointments.length} citas`);

    for (const appt of appointments) {
      const result = normalize(appt);
      if (result.skip) {
        totals.skipped++;
        console.log(`  - skip id=${appt?.id}: ${result.skip}`);
        continue;
      }

      if (DRY_RUN) {
        console.log(
          `  ✓ id=${result.payload.external_id} ${result.payload.appointment_at} ` +
            `${result.payload.patient.name} ${result.payload.patient.phone}`
        );
        continue;
      }

      try {
        const resp = await pushIntake(result.payload);
        if (resp.created) totals.created++;
        else totals.updated++;
        console.log(
          `  ✓ id=${result.payload.external_id} → ${resp.created ? "creada" : "actualizada"} ` +
            `(appt #${resp.appointment?.id}, state=${resp.appointment?.state})`
        );
      } catch (err) {
        totals.errors++;
        console.error(`  ✗ id=${appt?.id} intake falló: ${err.message}`);
      }
    }
  }

  console.log(
    `[ingest] DONE — fetched=${totals.fetched} created=${totals.created} ` +
      `updated=${totals.updated} skipped=${totals.skipped} errors=${totals.errors}`
  );
  if (totals.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[ingest] FATAL: ${err.message}`);
  process.exit(1);
});
