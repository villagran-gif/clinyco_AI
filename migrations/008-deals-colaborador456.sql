-- ============================================================
-- Migration 008: Add colaborador4, colaborador5, colaborador6
-- Custom fields from Zendesk Sell
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  colaborador4 text;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  colaborador5 text;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  colaborador6 text;

ALTER TABLE deal_deletions_log ADD COLUMN IF NOT EXISTS
  colaborador4 text;

ALTER TABLE deal_deletions_log ADD COLUMN IF NOT EXISTS
  colaborador5 text;

ALTER TABLE deal_deletions_log ADD COLUMN IF NOT EXISTS
  colaborador6 text;
