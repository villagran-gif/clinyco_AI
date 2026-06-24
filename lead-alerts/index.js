// lead-alerts/index.js
//
// Notificador de leads calificados → alerta a María Paz por WAHA + recordatorios
// (cliente + agente). Lee SOLO la DB. Opt-in (LEAD_ALERT_ENABLED) y dry-run por defecto.
//
// Flujo del tick:
//   1. findCandidateLeads(): leads con handoff confirmado (stage/handoff_reason) no notificados.
//   2. evaluateLead(): filtro duro — NO Antofagasta + atención en Santiago + turno de Gabriela.
//   3. WAHA: alerta a María Paz (link Chatwoot + resumen) + recordatorio a agente + a cliente.
//   4. lead_alert_log: idempotencia por (conversation_id, kind).

import express from "express";
import { dbEnabled } from "../db.js";
import {
  ensureLeadAlertSchema,
  findCandidateLeads,
  wasSent,
  logAlert,
  getAgentByName
} from "./db.js";
import { evaluateLead } from "./eligibility.js";
import {
  chatwootConversationUrl,
  buildSummary,
  buildMariaPazAlert,
  buildAgentReminder,
  buildClientReminder
} from "./messages.js";
import { sendText, defaultSession, isDryRun } from "./waha-client.js";

export function isLeadAlertsEnabled() {
  return process.env.LEAD_ALERT_ENABLED === "true";
}

function shiftConfig() {
  const weekdays = String(process.env.GABRIELA_SHIFT_WEEKDAYS || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return {
    weekdays,
    startHour: Number(process.env.GABRIELA_SHIFT_START_HOUR || 17),
    endHour: Number(process.env.GABRIELA_SHIFT_END_HOUR || 24)
  };
}

function leadFromRow(row) {
  return {
    conversationId: row.conversation_id,
    nombre: row.nombre,
    procedimiento: row.procedimiento,
    prevision: row.prevision,
    modalidad: row.modalidad,
    imc: row.imc,
    categoriaImc: row.categoria_imc,
    peso: row.peso,
    alturaCm: row.altura_cm,
    telefono: row.telefono || row.whatsapp_phone,
    ciudad: row.ciudad,
    ciudadAtencion: row.ciudad_atencion,
    score: row.score,
    scoreCategory: row.score_category,
    handoffConfirmed: true // ya garantizado por el SQL (stage/handoff_reason)
  };
}

async function sendOnce(conversationId, kind, recipient, text, session) {
  if (!recipient || (await wasSent(conversationId, kind))) return;
  try {
    const r = await sendText({ session, phone: recipient, text });
    await logAlert({ conversationId, kind, recipient, wahaMessageId: r.messageId });
  } catch (err) {
    await logAlert({ conversationId, kind, status: "error", recipient, error: String(err?.message || err) });
  }
}

export async function runLeadAlertsTick({ now = new Date() } = {}) {
  if (!dbEnabled()) return { ran: false, reason: "db_disabled" };
  await ensureLeadAlertSchema();

  const shift = shiftConfig();
  const session = defaultSession();
  const accountId = process.env.CHATWOOT_ACCOUNT_ID || "162472";
  const mariaPazPhone = process.env.LEAD_ALERT_MARIA_PAZ_PHONE || null;
  const agent = await getAgentByName(process.env.LEAD_ALERT_AGENT_NAME || "Gabriela");

  const rows = await findCandidateLeads({
    sinceHours: Number(process.env.LEAD_ALERT_LOOKBACK_HOURS || 24)
  });

  const result = { ran: true, dryRun: isDryRun(), candidates: rows.length, alerted: 0, skipped: [] };

  for (const row of rows) {
    const lead = leadFromRow(row);
    const { eligible, reasons } = evaluateLead({ ...lead, alreadyNotified: false }, { now, shift });
    if (!eligible) {
      result.skipped.push({ conversationId: lead.conversationId, reasons });
      continue;
    }

    const url = chatwootConversationUrl(lead.conversationId, { accountId });
    const summary = buildSummary(lead);

    await sendOnce(lead.conversationId, "maria_paz_alert", mariaPazPhone, buildMariaPazAlert(lead, { url, summary }), session);
    if (agent?.waha_phone) {
      await sendOnce(lead.conversationId, "agent_reminder", agent.waha_phone, buildAgentReminder(lead, { agentName: agent.canonical_name }), session);
    }
    await sendOnce(lead.conversationId, "client_reminder", lead.telefono, buildClientReminder(lead), session);

    result.alerted += 1;
  }

  return result;
}

export function createLeadAlertsRouter() {
  const router = express.Router();

  router.get("/health", (req, res) =>
    res.json({ ok: true, enabled: isLeadAlertsEnabled(), dryRun: isDryRun() })
  );

  router.post("/tick", async (req, res) => {
    const token = process.env.LEAD_ALERT_TICK_TOKEN;
    if (token && req.get("authorization") !== `Bearer ${token}`) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      const out = await runLeadAlertsTick({});
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  return router;
}
