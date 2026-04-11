-- Migration 012: Meta Ads Billing + Exchange Rates
-- Stores raw Meta billing transactions with USD→CLP conversion
-- using Dolar Observado from mindicador.cl

-- Exchange rate cache (Dolar Observado)
CREATE TABLE IF NOT EXISTS exchange_rates (
  id SERIAL PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'USD',
  date DATE NOT NULL,
  rate NUMERIC(10,2) NOT NULL,
  source TEXT DEFAULT 'mindicador',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(currency, date)
);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(date);

-- Meta Ads raw billing transactions
CREATE TABLE IF NOT EXISTS meta_ads_billing (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  transaction_id TEXT,
  description TEXT,
  payment_method TEXT,
  amount_usd NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  tipo TEXT DEFAULT 'charge',
  dolar_observado NUMERIC(10,2),
  amount_clp INT,
  iva_clp INT DEFAULT 0,
  total_clp INT,
  periodo TEXT,
  billing_period TEXT,
  upload_batch_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_billing_periodo ON meta_ads_billing(periodo);
CREATE INDEX IF NOT EXISTS idx_meta_billing_fecha ON meta_ads_billing(fecha);
