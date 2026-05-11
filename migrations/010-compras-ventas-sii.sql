-- ============================================================
-- Migration 010: Libro de Compras y Ventas (formato SII Chile)
-- Soporta CSV exportado desde portal SII mipyme.sii.cl
-- ============================================================

CREATE TABLE IF NOT EXISTS sii_compras (
  id bigserial PRIMARY KEY,
  nro integer,
  tipo_doc text,
  tipo_compra text,
  rut_proveedor text,
  razon_social text,
  folio text,
  fecha_docto date,
  fecha_recepcion date,
  fecha_acuse date,
  monto_exento integer DEFAULT 0,
  monto_neto integer DEFAULT 0,
  monto_iva_recuperable integer DEFAULT 0,
  monto_iva_no_recuperable integer DEFAULT 0,
  codigo_iva_no_rec text,
  monto_total integer DEFAULT 0,
  monto_neto_activo_fijo integer DEFAULT 0,
  iva_activo_fijo integer DEFAULT 0,
  iva_uso_comun integer DEFAULT 0,
  impto_sin_derecho_credito integer DEFAULT 0,
  iva_no_retenido integer DEFAULT 0,
  tabacos_puros integer DEFAULT 0,
  tabacos_cigarrillos integer DEFAULT 0,
  tabacos_elaborados integer DEFAULT 0,
  nce_nde_sobre_fact_compra integer DEFAULT 0,
  codigo_otro_impuesto text,
  valor_otro_impuesto integer DEFAULT 0,
  tasa_otro_impuesto numeric(5,2) DEFAULT 0,
  -- metadata
  periodo text,                              -- '2026-03' (year-month del CSV)
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  upload_batch_id text,
  UNIQUE (folio, tipo_doc, rut_proveedor, fecha_docto)
);

CREATE INDEX IF NOT EXISTS sii_compras_periodo_idx ON sii_compras (periodo);
CREATE INDEX IF NOT EXISTS sii_compras_fecha_idx ON sii_compras (fecha_docto);
CREATE INDEX IF NOT EXISTS sii_compras_rut_idx ON sii_compras (rut_proveedor);

CREATE TABLE IF NOT EXISTS sii_ventas (
  id bigserial PRIMARY KEY,
  nro integer,
  tipo_doc text,
  tipo_venta text,
  rut_cliente text,
  razon_social text,
  folio text,
  fecha_docto date,
  fecha_recepcion date,
  fecha_acuse_recibo date,
  fecha_reclamo date,
  monto_exento integer DEFAULT 0,
  monto_neto integer DEFAULT 0,
  monto_iva integer DEFAULT 0,
  monto_total integer DEFAULT 0,
  iva_retenido_total integer DEFAULT 0,
  iva_retenido_parcial integer DEFAULT 0,
  iva_no_retenido integer DEFAULT 0,
  iva_propio integer DEFAULT 0,
  iva_terceros integer DEFAULT 0,
  rut_emisor_liquid_factura text,
  neto_comision_liquid_factura integer DEFAULT 0,
  exento_comision_liquid_factura integer DEFAULT 0,
  iva_comision_liquid_factura integer DEFAULT 0,
  iva_fuera_de_plazo integer DEFAULT 0,
  tipo_docto_referencia text,
  folio_docto_referencia text,
  num_ident_receptor_extranjero text,
  nacionalidad_receptor_extranjero text,
  credito_empresa_constructora integer DEFAULT 0,
  impto_zona_franca integer DEFAULT 0,
  garantia_dep_envases integer DEFAULT 0,
  indicador_venta_sin_costo text,
  indicador_servicio_periodico text,
  monto_no_facturable integer DEFAULT 0,
  total_monto_periodo integer DEFAULT 0,
  venta_pasajes_nacional integer DEFAULT 0,
  venta_pasajes_internacional integer DEFAULT 0,
  numero_interno text,
  codigo_sucursal text,
  nce_nde_sobre_fact_compra integer DEFAULT 0,
  codigo_otro_imp text,
  valor_otro_imp integer DEFAULT 0,
  tasa_otro_imp numeric(5,2) DEFAULT 0,
  -- metadata
  periodo text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  upload_batch_id text,
  UNIQUE (folio, tipo_doc, rut_cliente, fecha_docto)
);

CREATE INDEX IF NOT EXISTS sii_ventas_periodo_idx ON sii_ventas (periodo);
CREATE INDEX IF NOT EXISTS sii_ventas_fecha_idx ON sii_ventas (fecha_docto);
CREATE INDEX IF NOT EXISTS sii_ventas_rut_idx ON sii_ventas (rut_cliente);

-- Future API connections config
CREATE TABLE IF NOT EXISTS api_connections (
  id bigserial PRIMARY KEY,
  provider text NOT NULL UNIQUE,            -- 'google_ads', 'meta_ads', 'sii'
  config jsonb NOT NULL DEFAULT '{}',       -- encrypted tokens, account IDs
  is_active boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO api_connections (provider, config) VALUES
  ('google_ads', '{"status":"pending","note":"Requiere OAuth2 + Google Ads API Developer Token"}'),
  ('meta_ads', '{"status":"pending","note":"Requiere Facebook Marketing API access token + ad account ID"}'),
  ('sii', '{"status":"pending","note":"Requiere certificado digital SII + clave tributaria"}')
ON CONFLICT (provider) DO NOTHING;
