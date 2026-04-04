-- ============================================================
-- Migration 007: Audit log tables + deals pipeline_id column
-- Tracks collaborator changes + deleted deals
-- ============================================================

-- 1. Add pipeline tracking to deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_id integer;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_name text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_id integer;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rut_normalizado text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS url_medinet text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS synced_at timestamptz;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS sell_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS deals_rut_norm_idx ON deals (rut_normalizado) WHERE rut_normalizado IS NOT NULL;
CREATE INDEX IF NOT EXISTS deals_synced_idx ON deals (synced_at);

-- 2. Audit log: tracks changes to collaborator and commission fields
CREATE TABLE IF NOT EXISTS deal_audit_log (
  id bigserial PRIMARY KEY,
  deal_id text NOT NULL,                        -- Zendesk Sell deal ID
  deal_name text,
  rut_normalizado text,
  field_name text NOT NULL,                     -- 'colaborador1', 'comision_bar3', 'pipeline_phase', etc.
  old_value text,
  new_value text,
  owner_name text,                              -- Deal owner at time of change
  detected_at timestamptz NOT NULL DEFAULT now(),
  sync_batch_id text                            -- Groups changes from same sync run
);

CREATE INDEX IF NOT EXISTS deal_audit_deal_idx ON deal_audit_log (deal_id);
CREATE INDEX IF NOT EXISTS deal_audit_rut_idx ON deal_audit_log (rut_normalizado) WHERE rut_normalizado IS NOT NULL;
CREATE INDEX IF NOT EXISTS deal_audit_field_idx ON deal_audit_log (field_name);
CREATE INDEX IF NOT EXISTS deal_audit_date_idx ON deal_audit_log (detected_at);

-- 3. Deletion log: snapshot of deals that disappeared between syncs
CREATE TABLE IF NOT EXISTS deal_deletions_log (
  id bigserial PRIMARY KEY,
  deal_id text NOT NULL,
  deal_name text,
  rut_normalizado text,
  pipeline_phase text,
  owner_name text,
  colaborador1 text,
  colaborador2 text,
  colaborador3 text,
  comision_bar1 integer,
  comision_bar2 integer,
  comision_bar3 integer,
  comision_bar4 integer,
  comision_bar5 integer,
  comision_bar6 integer,
  added_at date,
  fecha_cirugia date,
  contact_name text,
  contact_phone text,
  snapshot_json jsonb,                          -- Full deal record at deletion time
  detected_at timestamptz NOT NULL DEFAULT now(),
  sync_batch_id text
);

CREATE INDEX IF NOT EXISTS deal_del_rut_idx ON deal_deletions_log (rut_normalizado) WHERE rut_normalizado IS NOT NULL;
CREATE INDEX IF NOT EXISTS deal_del_date_idx ON deal_deletions_log (detected_at);
