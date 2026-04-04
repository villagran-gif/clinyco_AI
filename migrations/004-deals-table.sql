-- ============================================================
-- Migration 004: Deals table (from Zendesk Sell CSV export)
-- Tracks deal phases per agent for performance review
-- ============================================================

CREATE TABLE IF NOT EXISTS deals (
  id bigserial PRIMARY KEY,
  deal_name text,
  deal_id text UNIQUE,                          -- Zendesk Sell deal ID
  pipeline_phase text,                           -- "CERRADO OPERADO", "SIN RESPUESTA", etc.
  owner_name text,                               -- "Giselle Santander", "Allison Contreras"
  added_at date,
  pipeline text,                                 -- Inferred from deal type
  contact_name text,
  contact_id text,
  contact_email text,
  contact_phone text,
  rut text,
  ciudad text,
  cirugia text,
  fecha_cirugia date,
  sucursal text,
  origen text,
  probabilidad_ganar text,
  fecha_cambio_fase date,
  fecha_cierre date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deals_owner_idx ON deals (owner_name);
CREATE INDEX IF NOT EXISTS deals_phase_idx ON deals (pipeline_phase);
