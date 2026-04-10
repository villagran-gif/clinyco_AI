-- ============================================================
-- Migration 009: Marketing costs + leads tracking + KPI params
-- Supports: Google Ads, Meta Ads, agency fees, salaries
-- Enables: CAC, LTV, Payback, Churn, Quick Ratio, NDR, Rule of 40
-- ============================================================

-- Monthly marketing costs (one row per source per month)
CREATE TABLE IF NOT EXISTS marketing_costs (
  id bigserial PRIMARY KEY,
  month date NOT NULL,                          -- First day of month (2026-01-01)
  source text NOT NULL,                         -- 'google_ads','meta_ads','agency','salaries','other'
  description text,                             -- Optional label
  amount_clp integer NOT NULL DEFAULT 0,        -- Cost in CLP
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, source, description)
);

CREATE INDEX IF NOT EXISTS mktcost_month_idx ON marketing_costs (month);
CREATE INDEX IF NOT EXISTS mktcost_source_idx ON marketing_costs (source);

-- Business parameters (editable from dashboard)
CREATE TABLE IF NOT EXISTS business_params (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  label text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default business parameters
INSERT INTO business_params (key, value, label) VALUES
  ('avg_revenue_per_patient', 2500000, 'Ingreso promedio por paciente operado (CLP)'),
  ('gross_margin_pct', 40, 'Margen bruto (%)'),
  ('monthly_churn_pct', 5, 'Churn mensual (%)'),
  ('avg_surgery_price', 3500000, 'Precio promedio cirugia (CLP)'),
  ('revenue_growth_pct', 15, 'Crecimiento de ingresos anual (%)'),
  ('profit_margin_pct', 10, 'Margen de ganancia neta (%)')
ON CONFLICT (key) DO NOTHING;
