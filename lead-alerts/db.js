// lead-alerts/db.js
//
// Consultas del notificador. Lee SOLO la DB compartida (structured_leads, conversations,
// agent_registry) + una tabla propia de idempotencia (lead_alert_log) que el módulo crea
// solo (additivo, no toca el esquema compartido).
//
// La "ciudad de atención" se lee de structured_leads.source_json -> contactDraft.c_ciudad_atencion
// (sin DDL sobre la tabla compartida). La "residencia" es structured_leads.ciudad (c_comuna).

import { getPool } from "../db.js";

// Estados del resolver que implican "lead calificado + confirmó contacto".
const HANDOFF_STAGES = ["ready_for_handoff", "handoff_without_call", "agenda_without_direct_access"];

export async function ensureLeadAlertSchema() {
  await getPool().query(`
    create table if not exists lead_alert_log (
      id bigserial primary key,
      conversation_id text not null,
      kind text not null,                       -- maria_paz_alert | client_reminder | agent_reminder
      status text not null default 'sent',      -- sent | error
      recipient text,
      waha_message_id text,
      error text,
      created_at timestamptz not null default now()
    );
    create unique index if not exists lead_alert_log_unique_sent
      on lead_alert_log (conversation_id, kind) where status = 'sent';
    create index if not exists lead_alert_log_conversation_idx
      on lead_alert_log (conversation_id, created_at desc);
  `);
}

export async function findCandidateLeads({ sinceHours = 24, limit = 50 } = {}) {
  const { rows } = await getPool().query(
    `
    select
      sl.conversation_id,
      sl.nombre, sl.procedimiento, sl.prevision, sl.modalidad,
      sl.imc, sl.categoria_imc, sl.peso, sl.altura_cm,
      sl.telefono, sl.ciudad, sl.score, sl.score_category,
      sl.source_json -> 'contactDraft' ->> 'c_ciudad_atencion' as ciudad_atencion,
      c.whatsapp_phone,
      c.handoff_reason,
      coalesce(c.state_json -> 'identity' ->> 'lastResolvedStage', '') as last_stage
    from structured_leads sl
    join conversations c on c.conversation_id = sl.conversation_id
    where sl.updated_at > now() - ($1 || ' hours')::interval
      and (
        c.handoff_reason is not null
        or coalesce(c.state_json -> 'identity' ->> 'lastResolvedStage', '') = any($2)
      )
      and not exists (
        select 1 from lead_alert_log la
        where la.conversation_id = sl.conversation_id
          and la.kind = 'maria_paz_alert'
          and la.status = 'sent'
      )
    order by sl.updated_at desc
    limit $3
    `,
    [String(sinceHours), HANDOFF_STAGES, limit]
  );
  return rows;
}

export async function wasSent(conversationId, kind) {
  const { rows } = await getPool().query(
    `select 1 from lead_alert_log
     where conversation_id = $1 and kind = $2 and status = 'sent' limit 1`,
    [conversationId, kind]
  );
  return rows.length > 0;
}

export async function logAlert({ conversationId, kind, status = "sent", recipient = null, wahaMessageId = null, error = null }) {
  await getPool().query(
    `insert into lead_alert_log (conversation_id, kind, status, recipient, waha_message_id, error)
     values ($1, $2, $3, $4, $5, $6)`,
    [conversationId, kind, status, recipient, wahaMessageId, error]
  );
}

// Busca un agente activo del registro por nombre (p.ej. "Gabriela") → su WAHA phone.
export async function getAgentByName(canonicalNameLike) {
  if (!canonicalNameLike) return null;
  const { rows } = await getPool().query(
    `select canonical_name, waha_phone, waha_session_name
     from agent_registry
     where is_active = true and upper(canonical_name) like upper($1)
     order by id asc limit 1`,
    [`%${canonicalNameLike}%`]
  );
  return rows[0] || null;
}
