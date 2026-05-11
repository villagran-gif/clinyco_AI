/**
 * melania/handoff-router.js — Endpoint de entrada para reschedules
 * empujados desde el módulo confirmations en sell-medinet-backend.
 *
 * Flujo:
 *   1) Un paciente recibe el HSM de confirmación (MelanIA → Chatwoot).
 *   2) Paciente responde "reagendar".
 *   3) inbound-processor de sell-medinet-backend clasifica la intención
 *      como `reschedule` y hace POST a este endpoint con el contexto de
 *      la cita.
 *   4) Aquí persistimos el handoff en `melania_handoffs` para que un
 *      worker / la propia capa de mensajes (server.js#/messages) lo
 *      tome y arranque MelanIA con esos slots precargados.
 *
 * Este archivo es solo el receptor + persistencia. La consumición del
 * handoff (despertar a MelanIA dentro de una conversación viva) vive
 * en el flujo de /messages — un commit posterior puede hacer el cable
 * leyendo de esta tabla cuando llegue el próximo mensaje del paciente.
 *
 * Auth: Bearer CONFIRMATIONS_HANDOFF_TOKEN. Debe coincidir con
 * CLINYCO_HANDOFF_TOKEN en sell-medinet-backend.
 */

import { Router } from "express";
import { getPool, dbEnabled } from "../db.js";

let tableEnsured = false;

async function ensureTable() {
  if (tableEnsured) return;
  if (!dbEnabled()) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS melania_handoffs (
      id                       BIGSERIAL PRIMARY KEY,
      external_id              BIGINT NOT NULL,
      branch_id                INTEGER,
      patient_run              TEXT,
      patient_phone            TEXT NOT NULL,
      patient_name             TEXT,
      appointment_at           TIMESTAMPTZ,
      specialty                TEXT,
      professional             TEXT,
      inbound_message          TEXT,
      chatwoot_conversation_id BIGINT,
      raw                      JSONB NOT NULL,
      consumed_at              TIMESTAMPTZ,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_melania_handoffs_phone_pending
       ON melania_handoffs (patient_phone, created_at DESC)
       WHERE consumed_at IS NULL`
  );
  tableEnsured = true;
}

function requireBearer(req, res, next) {
  const expected = process.env.CONFIRMATIONS_HANDOFF_TOKEN;
  if (!expected) {
    return res.status(500).json({
      error: "server_misconfigured",
      message: "CONFIRMATIONS_HANDOFF_TOKEN no configurado",
    });
  }
  const m = /^Bearer\s+(.+)$/i.exec((req.get("Authorization") || "").trim());
  if (!m || m[1].trim() !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

function validate(body) {
  if (!body || typeof body !== "object") throw bad("body", "JSON requerido");
  const externalId = Number(body.external_id);
  if (!Number.isFinite(externalId) || externalId <= 0) {
    throw bad("external_id", "entero positivo requerido");
  }
  const phone = String(body?.patient?.phone || "").trim();
  if (!phone) throw bad("patient.phone", "requerido");
  return {
    externalId,
    branchId: numOrNull(body.branch_id),
    patientRun: strOrNull(body.patient?.run),
    patientPhone: phone,
    patientName: strOrNull(body.patient?.name),
    appointmentAt: body.appointment_at ? new Date(body.appointment_at) : null,
    specialty: strOrNull(body.specialty),
    professional: strOrNull(body.professional),
    inboundMessage: strOrNull(body.inbound_message),
    chatwootConversationId: numOrNull(body.chatwoot_conversation_id),
    raw: body,
  };
}

export function createMelaniaHandoffRouter() {
  const router = Router();

  /**
   * POST /melania/start-from-confirmation
   *
   * Body esperado (lo manda sell-medinet-backend/inbound-processor):
   *   {
   *     "external_id": 414088,
   *     "branch_id": 2,
   *     "patient": { "run", "phone", "name" },
   *     "appointment_at": "2026-05-11T17:30:00-04:00",
   *     "specialty": "...",
   *     "professional": "...",
   *     "inbound_message": "REAGENDAR mañana",
   *     "chatwoot_conversation_id": 12345
   *   }
   *
   * Responde 200 rápido. La consumición real ocurre cuando el siguiente
   * mensaje del paciente entra a /messages y el handler ve un handoff
   * pendiente para ese teléfono (próximo commit).
   */
  router.post("/start-from-confirmation", requireBearer, async (req, res) => {
    let v;
    try {
      v = validate(req.body);
    } catch (err) {
      if (err.status === 400) {
        return res
          .status(400)
          .json({ error: "invalid_payload", field: err.field, message: err.message });
      }
      throw err;
    }

    try {
      await ensureTable();
      if (!dbEnabled()) {
        console.warn(
          "[melania/handoff] DB desactivada — handoff recibido pero NO persistido:",
          { external_id: v.externalId, phone: v.patientPhone }
        );
        return res.status(202).json({ status: "accepted_no_db" });
      }
      const { rows } = await getPool().query(
        `
        INSERT INTO melania_handoffs (
          external_id, branch_id, patient_run, patient_phone, patient_name,
          appointment_at, specialty, professional, inbound_message,
          chatwoot_conversation_id, raw
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id, created_at
        `,
        [
          v.externalId,
          v.branchId,
          v.patientRun,
          v.patientPhone,
          v.patientName,
          v.appointmentAt,
          v.specialty,
          v.professional,
          v.inboundMessage,
          v.chatwootConversationId,
          JSON.stringify(v.raw),
        ]
      );
      console.log(
        `[melania/handoff] persistido handoff ${rows[0].id} (external_id=${v.externalId}, phone=${v.patientPhone})`
      );
      return res.status(202).json({
        status: "accepted",
        handoff_id: rows[0].id,
        created_at: rows[0].created_at,
      });
    } catch (err) {
      console.error("[melania/handoff] db_error:", err.message);
      return res.status(500).json({ error: "db_error", message: err.message });
    }
  });

  /**
   * GET /melania/handoffs/pending?phone=+56912345678
   * Helper de inspección (mismo Bearer). Devuelve el handoff pendiente
   * más reciente para ese teléfono. Útil cuando el handler de /messages
   * decida si despertar MelanIA al recibir el próximo mensaje.
   */
  router.get("/handoffs/pending", requireBearer, async (req, res) => {
    const phone = String(req.query.phone || "").trim();
    if (!phone) return res.status(400).json({ error: "phone_required" });

    try {
      await ensureTable();
      if (!dbEnabled()) return res.status(200).json({ handoff: null });
      const { rows } = await getPool().query(
        `
        SELECT id, external_id, branch_id, patient_run, patient_name,
               appointment_at, specialty, professional, inbound_message,
               chatwoot_conversation_id, created_at
          FROM melania_handoffs
         WHERE patient_phone = $1 AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
        `,
        [phone]
      );
      return res.status(200).json({ handoff: rows[0] || null });
    } catch (err) {
      return res.status(500).json({ error: "db_error", message: err.message });
    }
  });

  return router;
}

function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function bad(field, message) {
  const err = new Error(`${field}: ${message}`);
  err.status = 400;
  err.field = field;
  return err;
}
