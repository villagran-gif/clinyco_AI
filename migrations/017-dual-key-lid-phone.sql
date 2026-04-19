-- 017-dual-key-lid-phone.sql
-- Adds dual-key identity (LID + phone) to WhatsApp tables.
-- WhatsApp's internal LID is needed for message continuity;
-- the real phone number is needed for Zendesk/CRM matching.
--
-- Also adds source + contact_name to calls for Mac desktop import.

-- ── 1. LID ↔ Phone mapping table ──

CREATE TABLE IF NOT EXISTS whatsapp_lid_phone_map (
  id          BIGSERIAL PRIMARY KEY,
  lid         TEXT NOT NULL UNIQUE,
  phone       TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'waha',
  full_name   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wlpm_phone
  ON whatsapp_lid_phone_map (phone);

-- ── 2. Conversations: add client_lid ──

ALTER TABLE agent_direct_conversations
  ADD COLUMN IF NOT EXISTS client_lid TEXT;

CREATE INDEX IF NOT EXISTS idx_adc_client_lid
  ON agent_direct_conversations (client_lid)
  WHERE client_lid IS NOT NULL;

-- ── 3. Calls: add source, contact_name, client_lid ──

ALTER TABLE agent_direct_calls
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'waha',
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS client_lid TEXT;

CREATE INDEX IF NOT EXISTS idx_adc_source
  ON agent_direct_calls (source);

-- ── 4. Backfill existing conversations that have LID-format phones ──
-- LIDs are 15-digit numbers that don't start with country codes.
-- Chilean phones: +56XXXXXXXXX (11 digits with prefix).
-- We mark them so they can be resolved later.

-- (No data migration here — the Mac extractor and LID resolver
--  will populate these fields going forward.)
