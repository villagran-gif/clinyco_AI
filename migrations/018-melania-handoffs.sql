-- 018-melania-handoffs.sql
-- Tabla de handoffs entrantes desde sell-medinet-backend/confirmations.
--
-- Recibe los reschedule del módulo MelanIA: cuando el clasificador Haiku
-- 4.5 decide que la respuesta del paciente es "reagendar", el backend
-- en Render hace POST a /melania/start-from-confirmation aquí. Persistir
-- el contexto permite que el handler de /messages despierte MelanIA con
-- los slots correctos cuando llegue el siguiente mensaje del paciente.
--
-- La tabla también se crea automáticamente en melania/handoff-router.js
-- vía CREATE TABLE IF NOT EXISTS (ensureTable), así el módulo funciona
-- en entornos donde estas migraciones numeradas no se aplican manualmente.

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
);

CREATE INDEX IF NOT EXISTS idx_melania_handoffs_phone_pending
  ON melania_handoffs (patient_phone, created_at DESC)
  WHERE consumed_at IS NULL;
