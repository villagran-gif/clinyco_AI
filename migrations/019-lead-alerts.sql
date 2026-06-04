-- ============================================================
-- Migration 019: Lead Alerts (notificador a María Paz vía WAHA)
-- ============================================================
-- Tabla propia de idempotencia del módulo lead-alerts/. Additiva:
-- NO altera el esquema compartido (structured_leads / conversations).
--
-- La "ciudad de atención" NO necesita columna nueva: se persiste en
-- structured_leads.source_json -> 'contactDraft' ->> 'c_ciudad_atencion'
-- (lo escribe el cerebro de Antonia al preguntar la ciudad de atención).
-- La "residencia" ya existe como structured_leads.ciudad (= contactDraft.c_comuna).
--
-- El módulo también crea esta tabla solo al arrancar (ensureLeadAlertSchema),
-- así que esta migración es opcional/idempotente; queda para que el dueño del
-- schema la corra explícitamente si lo prefiere.

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
