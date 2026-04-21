import { fetchAllAppointments } from "../Antonia/medinet-api.js";
import { query } from "./db.js";
import { upsertAppointment, TELEMEDICINE_BRANCH_IDS } from "./lifecycle.js";

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Medinet response fields vary; pick what we need tolerantly.
function normalize(raw, branchId) {
  if (!raw) return null;
  const medinetId = raw.id || raw.appointment_id || raw.cita_id;
  if (!medinetId) return null;

  const date = raw.date || raw.fecha || raw.data_dia || raw.dataDia;
  const time = raw.time || raw.hora;
  let startsAt = raw.starts_at || raw.datetime_start;
  if (!startsAt && date && time) {
    const iso = `${date}T${String(time).slice(0, 5)}:00-04:00`;
    startsAt = iso;
  }
  if (!startsAt) return null;

  const patient = raw.patient || raw.paciente || {};
  const professional = raw.professional || raw.profesional || {};

  return {
    medinetAppointmentId: medinetId,
    branchId,
    patientRut: patient.rut || patient.run || raw.patient_rut || null,
    patientName:
      [patient.nombres || patient.first_name, patient.paterno || patient.last_name, patient.materno || patient.maiden_name]
        .filter(Boolean)
        .join(" ") || patient.display || null,
    whatsappPhone: patient.phone || patient.telefono || patient.celular || raw.patient_phone || null,
    email: patient.email || raw.patient_email || null,
    professionalId: professional.id || raw.professional_id || null,
    professionalName:
      [professional.nombres || professional.first_name, professional.paterno || professional.last_name]
        .filter(Boolean)
        .join(" ") || professional.display || null,
    professionalPhone: professional.phone || professional.telefono || null,
    specialty: (raw.specialty || raw.especialidad || professional.especialidad || "").toString() || null,
    startsAt,
    durationMinutes: raw.duration || raw.duracion || null,
    source: "polling",
    rawMedinetJson: raw,
  };
}

async function updateIngestState(patch) {
  const cols = [];
  const vals = [];
  let idx = 1;
  for (const [k, v] of Object.entries(patch)) {
    cols.push(`${k} = $${idx++}`);
    vals.push(v);
  }
  cols.push(`updated_at = now()`);
  await query(`update telemedicine_ingest_state set ${cols.join(", ")} where id = 1`, vals);
}

export async function ingestFromMedinet({ daysAhead } = {}) {
  const span = Number(daysAhead || process.env.TELEMEDICINE_INGEST_DAYS_AHEAD || 14);
  const start = new Date();
  const end = new Date(start.getTime() + span * 24 * 60 * 60 * 1000);
  const from = formatDate(start);
  const to = formatDate(end);

  await updateIngestState({ last_run_at: new Date().toISOString(), last_error: null });

  let fetched = 0;
  let inserted = 0;
  const byBranch = {};

  for (const branchId of TELEMEDICINE_BRANCH_IDS) {
    try {
      const appointments = await fetchAllAppointments(from, to, { branchId });
      const list = Array.isArray(appointments) ? appointments : appointments?.results || [];
      byBranch[branchId] = { fetched: list.length, inserted: 0, failed: 0 };
      fetched += list.length;

      for (const raw of list) {
        const normalized = normalize(raw, branchId);
        if (!normalized) {
          byBranch[branchId].failed += 1;
          continue;
        }
        try {
          const { inserted: wasInserted } = await upsertAppointment(normalized);
          if (wasInserted) {
            inserted += 1;
            byBranch[branchId].inserted += 1;
          }
        } catch (err) {
          byBranch[branchId].failed += 1;
          console.warn(`[telemedicine.ingest] upsert failed for medinet_id=${normalized.medinetAppointmentId}:`, err.message);
        }
      }
    } catch (err) {
      console.warn(`[telemedicine.ingest] branch=${branchId} fetch failed:`, err.message);
      byBranch[branchId] = { fetched: 0, inserted: 0, failed: 0, error: err.message };
      await updateIngestState({ last_error: `branch ${branchId}: ${err.message}` });
    }
  }

  await updateIngestState({
    last_success_at: new Date().toISOString(),
    last_fetched_count: fetched,
    last_inserted_count: inserted,
  });

  return { fetched, inserted, from, to, byBranch };
}
