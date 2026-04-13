-- ══════════════════════════════════════════════════════════════
-- sell_deals_cache
-- Snapshot local de deals + contactos de Zendesk Sell, para
-- correlacionar outcomes con las métricas del Agent Observer.
-- Se refresca vía observer/sync-sell-deals.js
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sell_deals_cache (
  deal_id              bigint PRIMARY KEY,
  contact_id           bigint,
  contact_name         text,
  contact_phone        text,           -- normalized (solo dígitos, con country code cuando existe)
  contact_phone_raw    text,           -- como vino de Sell
  contact_email        text,

  deal_name            text,
  stage_id             bigint,         -- ID único de stage en Sell (estable ante renames)
  stage_name           text,           -- "CERRADO OPERADO", "CONTACTADO", etc.
  stage_category       text,           -- 'won' | 'lost' | 'open' (derivado)
  is_closed_won        boolean,        -- stage empieza con "CERRADO" y score >= 50
  outcome_score        integer,        -- 0-100 via getOutcomeScore()

  pipeline_id          bigint,         -- ID único de pipeline en Sell
  pipeline_name        text,           -- "Bariátrica", "Balón", "Plástica"
  pipeline_key         text,           -- 'bariatrica' | 'balon' | 'plastica' | 'general'

  value                numeric,
  currency             text,

  owner_id             bigint,
  owner_name           text,           -- nombre del comercial dueño del deal (NO sirve para atribución)

  -- Atribución real del negocio (Sell custom_fields "Colaborador N (PIPELINE)")
  -- Los nombres son strings libres (ej: "Gabriela", "Danitza", "Carolin Cornejo")
  -- Se matchean contra agent_waha_sessions.agent_name por nombre normalizado.
  colaborador_1        text,           -- CAPTACIÓN — primer contacto con el lead
  colaborador_2        text,           -- SEGUIMIENTO — KPI real de venta (nurturing + conversión)
  colaborador_3        text,           -- CIERRE — operacional (puede ser el mismo del 2)

  created_at_sell      timestamptz,
  updated_at_sell      timestamptz,
  last_synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sell_deals_cache_phone_idx
  ON sell_deals_cache (contact_phone)
  WHERE contact_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS sell_deals_cache_owner_idx
  ON sell_deals_cache (owner_id);

CREATE INDEX IF NOT EXISTS sell_deals_cache_stage_idx
  ON sell_deals_cache (stage_category, outcome_score);

CREATE INDEX IF NOT EXISTS sell_deals_cache_updated_idx
  ON sell_deals_cache (updated_at_sell DESC);

CREATE INDEX IF NOT EXISTS sell_deals_cache_pipeline_id_idx
  ON sell_deals_cache (pipeline_id);

CREATE INDEX IF NOT EXISTS sell_deals_cache_stage_id_idx
  ON sell_deals_cache (stage_id);

-- ── Migración idempotente: agregar columnas de colaborador si no existen ──
-- (En deploys nuevos las columnas ya vienen del CREATE TABLE, pero en deploys
--  existentes el CREATE TABLE IF NOT EXISTS es no-op, así que necesitamos ALTERs.)
ALTER TABLE sell_deals_cache ADD COLUMN IF NOT EXISTS colaborador_1 text;
ALTER TABLE sell_deals_cache ADD COLUMN IF NOT EXISTS colaborador_2 text;
ALTER TABLE sell_deals_cache ADD COLUMN IF NOT EXISTS colaborador_3 text;

-- Los índices van DESPUÉS de los ALTER para que las columnas existan.
CREATE INDEX IF NOT EXISTS sell_deals_cache_colab1_idx
  ON sell_deals_cache (lower(colaborador_1))
  WHERE colaborador_1 IS NOT NULL;

CREATE INDEX IF NOT EXISTS sell_deals_cache_colab2_idx
  ON sell_deals_cache (lower(colaborador_2))
  WHERE colaborador_2 IS NOT NULL;

CREATE INDEX IF NOT EXISTS sell_deals_cache_colab3_idx
  ON sell_deals_cache (lower(colaborador_3))
  WHERE colaborador_3 IS NOT NULL;
