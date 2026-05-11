-- Migration 013: Add account_id to meta_ads_billing
-- Allows multiple Meta Ads accounts to coexist (per-account DELETE on re-upload)
ALTER TABLE meta_ads_billing ADD COLUMN IF NOT EXISTS account_id TEXT;
CREATE INDEX IF NOT EXISTS idx_meta_billing_account ON meta_ads_billing(account_id);
