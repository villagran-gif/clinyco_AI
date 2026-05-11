-- 016-agent-direct-calls.sql
-- WhatsApp call tracking for "best time to call" analytics.
-- Captures call.received / call.accepted / call.rejected events emitted
-- by WAHA (Plus + NOWEB engine supports all three; WEBJS only received/rejected).
--
-- outcome_proxy is derived downstream (not in the webhook handler) by
-- checking whether the client sent ANY message within 60 min after the
-- call ended — used as a proxy for "answered / engaged".

CREATE TABLE IF NOT EXISTS agent_direct_calls (
  id               BIGSERIAL PRIMARY KEY,
  call_id          TEXT UNIQUE NOT NULL,
  conversation_id  BIGINT REFERENCES agent_direct_conversations(id) ON DELETE SET NULL,
  session_name     TEXT NOT NULL,
  client_phone     TEXT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('agent_to_client','client_to_agent')),
  is_video         BOOLEAN DEFAULT false,
  received_at      TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  ring_seconds     INTEGER,
  duration_seconds INTEGER,
  status           TEXT NOT NULL CHECK (status IN ('ringing','answered','rejected','missed','ended')),
  hour_of_day      SMALLINT,
  day_of_week      SMALLINT,
  outcome_proxy    TEXT CHECK (outcome_proxy IN ('answered_engaged','answered_silent','no_answer','unknown')),
  raw_json         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adc_received_at
  ON agent_direct_calls (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_adc_client_phone
  ON agent_direct_calls (client_phone);

CREATE INDEX IF NOT EXISTS idx_adc_conversation
  ON agent_direct_calls (conversation_id);

CREATE INDEX IF NOT EXISTS idx_adc_hour_day
  ON agent_direct_calls (hour_of_day, day_of_week)
  WHERE status = 'answered';

CREATE INDEX IF NOT EXISTS idx_adc_status
  ON agent_direct_calls (status);
