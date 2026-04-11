-- ============================================================
-- Migration 011: Boletas + Resumen tables for SII
-- RCV_VENTA_BOLETAS (10 cols) separate from ventas (43 cols)
-- RCV_RESUMEN_COMPRA and RCV_RESUMEN_VENTA for verification
-- ============================================================

CREATE TABLE IF NOT EXISTS sii_ventas_boletas (
  id bigserial PRIMARY KEY,
  tipo_doc text,
  rut_receptor text,
  fecha_docto date,
  fecha_venc date,
  indicador_servicio text,
  folio text,
  monto_neto integer DEFAULT 0,
  monto_iva integer DEFAULT 0,
  monto_exento integer DEFAULT 0,
  monto_total integer DEFAULT 0,
  -- metadata
  periodo text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  upload_batch_id text,
  UNIQUE (folio, tipo_doc, rut_receptor, fecha_docto)
);

CREATE INDEX IF NOT EXISTS sii_boletas_periodo_idx ON sii_ventas_boletas (periodo);
CREATE INDEX IF NOT EXISTS sii_boletas_fecha_idx ON sii_ventas_boletas (fecha_docto);

-- Resumen tables (from RCV_RESUMEN_COMPRA / RCV_RESUMEN_VENTA CSVs)
CREATE TABLE IF NOT EXISTS sii_resumen_compras (
  id bigserial PRIMARY KEY,
  periodo text NOT NULL,
  tipo_doc text NOT NULL,
  total_documentos integer DEFAULT 0,
  monto_exento bigint DEFAULT 0,
  monto_neto bigint DEFAULT 0,
  iva_recuperable bigint DEFAULT 0,
  iva_uso_comun bigint DEFAULT 0,
  iva_no_recuperable bigint DEFAULT 0,
  monto_total bigint DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (periodo, tipo_doc)
);

CREATE TABLE IF NOT EXISTS sii_resumen_ventas (
  id bigserial PRIMARY KEY,
  periodo text NOT NULL,
  tipo_doc text NOT NULL,
  total_documentos integer DEFAULT 0,
  monto_exento bigint DEFAULT 0,
  monto_neto bigint DEFAULT 0,
  monto_iva bigint DEFAULT 0,
  monto_total bigint DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (periodo, tipo_doc)
);
