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
  owner_name           text,           -- nombre del comercial dueño del deal

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
