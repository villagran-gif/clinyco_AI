-- ============================================================
-- Migration 009: Marketing costs + leads tracking
-- Supports: Google Ads, Meta Ads, agency fees, salaries
-- Enables: CAC, LTV:CAC ratio, conversion %, leads/day/month
-- ============================================================

-- Monthly marketing costs (one row per source per month)
CREATE TABLE IF NOT EXISTS marketing_costs (
  id bigserial PRIMARY KEY,
  month date NOT NULL,                          -- First day of month (2026-01-01)
  source text NOT NULL,                         -- 'google_ads','meta_ads','agency','salaries','other'
  description text,                             -- Optional label ("Agencia Redes Sociales", "Sueldo Gabriela")
  amount_clp integer NOT NULL DEFAULT 0,        -- Cost in CLP
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, source, description)
);

CREATE INDEX IF NOT EXISTS mktcost_month_idx ON marketing_costs (month);
CREATE INDEX IF NOT EXISTS mktcost_source_idx ON marketing_costs (source);

-- Leads daily snapshot (synced from Zendesk Sell or manual)
CREATE TABLE IF NOT EXISTS leads_daily (
  id bigserial PRIMARY KEY,
  day date NOT NULL,
  new_leads integer NOT NULL DEFAULT 0,         -- New leads created that day
  new_deals integer NOT NULL DEFAULT 0,         -- Leads that became deals that day
  source text DEFAULT 'zendesk_sell',           -- Origin of data
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, source)
);

CREATE INDEX IF NOT EXISTS leads_day_idx ON leads_daily (day);

-- Business parameters (editable from dashboard)
CREATE TABLE IF NOT EXISTS business_params (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  label text,                                   -- Human-readable label
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default business parameters
INSERT INTO business_params (key, value, label) VALUES
  ('avg_revenue_per_patient', 2500000, 'Ingreso promedio por paciente operado (CLP)'),
  ('gross_margin_pct', 40, 'Margen bruto (%)'),
  ('monthly_churn_pct', 5, 'Churn mensual (%)'),
  ('avg_surgery_price', 3500000, 'Precio promedio cirugía (CLP)')
ON CONFLICT (key) DO NOTHING;
