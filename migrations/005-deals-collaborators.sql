-- ============================================================
-- Migration 005: Add collaborator + commission columns to deals
-- Tracks which agent participated in each phase (1,2,3)
-- and commission values (BAR1-6) in CLP
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  colaborador1 text;                    -- Agent who captured the lead (phase 1)

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  colaborador2 text;                    -- Agent who followed up (phase 2)

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  colaborador3 text;                    -- Agent who closed/coordinated (phase 3)

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  comision_bar1 integer;                -- CLP commission for colaborador1

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  comision_bar2 integer;                -- CLP commission for colaborador2

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  comision_bar3 integer;                -- CLP commission for colaborador3

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  comision_bar4 integer;                -- CLP bonus for colaborador1 (if <=75 days)

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  comision_bar5 integer;                -- CLP bonus for colaborador2 (if <=75 days)

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  comision_bar6 integer;                -- CLP bonus for colaborador3 (if <=75 days)

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  dias_added_cirugia integer;           -- Days between added_at and fecha_cirugia

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  bono_75_dias boolean NOT NULL DEFAULT false;  -- True if <=75 days (bonus earned)
