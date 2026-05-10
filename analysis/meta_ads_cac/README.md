# Análisis CAC: Meta Ads → Conversiones Zendesk Sell

Calcula el **CAC real** cruzando los leads de Meta Ads con los deals
cerrados en Zendesk Sell. Compara con el CPL reportado por Meta para
entender la brecha entre "alguien dejó datos" y "alguien pagó".

## Estructura

```
analysis/meta_ads_cac/
├─ analyze_cac.py        # Script principal (pandas + rapidfuzz + requests)
├─ requirements.txt      # Dependencias Python
├─ README.md             # Este archivo
└─ out/                  # Generado por el script (gitignored)
   ├─ reporte_cac.xlsx       # Multi-sheet: resumen + matches + breakdowns
   ├─ matches.csv
   ├─ leads_no_convertidos.csv
   ├─ deals_sin_lead.csv
   ├─ anomalias.csv
   ├─ RESUMEN_EJECUTIVO.md   # Para compartir
   └─ metrics.json
```

## Setup

```bash
cd analysis/meta_ads_cac
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Inputs requeridos

### 1. CSV de Meta Lead Center
Descargar de Drive: `META_Ads/leads_enero_mayo.csv`
(`https://drive.google.com/drive/folders/1y98HPfWoT-nmvVt3Zp4N7MELVIr5JdBv`)

Columnas que el script espera (las que ya trae el export):
`Fecha de creación, Nombre, Correo electrónico, Origen, Formulario,
Canal, Etapa, Propietario, Etiquetas, Teléfono, ...`

### 2a. (Recomendado) Token Zendesk Sell para descargar deals via API

```bash
export ZENDESK_SELL_API_TOKEN="<token de api.getbase.com>"
```
El token está en Render env vars del servicio `sell-medinet-backend`
(buscar `ZENDESK_SELL_API_TOKEN`).

### 2b. (Alternativa) Export CSV de deals desde Zendesk Sell UI
Menú Zendesk Sell → Deals → Export. Columnas mínimas:
`id, name, contact_id, email, mobile, phone, value, pipeline_id,
stage_id, stage_name, category, created_at, fecha_cirugia, honorarios`

## Ejecución

```bash
export ZENDESK_SELL_API_TOKEN=xxx
python3 analyze_cac.py \
    --leads-csv ./leads_enero_mayo.csv \
    --gasto-clp 4529962 \
    --periodo-inicio 2026-01-01 \
    --periodo-fin 2026-05-10 \
    --output-dir ./out
```

## Estrategia de matching

Multi-capa con score descendente:

| Score | Regla | Confianza |
|-------|-------|-----------|
| 100 | email normalizado exacto | Alta |
| 90 | teléfono E.164 exacto | Alta |
| 70 | nombre normalizado exacto + ventana ±90d | Media |
| 40 | nombre fuzzy ≥88% + ventana | Baja — validar manual |

Normalización:
- **Email**: lowercase, strip, sin espacios.
- **Teléfono**: solo dígitos → `+569XXXXXXXX` (móvil chileno).
- **Nombre**: lowercase, sin acentos, sin emojis (incluyendo bloques
  Unicode mathematical-alphanum), sin caracteres no-alfanuméricos,
  espacios colapsados.

## Definición de "conversión"

Un deal cuenta como cliente convertido si cumple **una** de:
- `stage.category == "won"` (Zendesk Sell stage categoría Won)
- Custom field `FECHA DE CIRUGÍA` poblado (operación efectivamente realizada)

Valor de la venta = `HONORARIOS` (custom CLP) si existe, sino `value`.

## ⚠️ Limitaciones del CSV de Meta actual

El export `leads_enero_mayo.csv` (1.357 leads) tiene cobertura de
contacto **muy baja**:
- La gran mayoría de leads vienen por **Instagram/Messenger** (origen
  `Pagada`) y solo capturan el **nombre social** del usuario, no email
  ni teléfono.
- Los pocos leads que sí tienen email/teléfono son los del formulario
  "Cirugía Bariátrica" vía correo electrónico.

Consecuencia: la mayoría del matching dependerá de **nombre +
ventana temporal**, lo que produce matches débiles (score 70/40).
Validar manualmente la pestaña `matches` filtrando por `score ≤ 70`
antes de tomar decisiones con el CAC.

Mejor a futuro: en los formularios de IG/Messenger pedir
explícitamente WhatsApp o email; o usar Meta Conversions API con
`event_id` que se propague al CRM.

## Outputs

- **`reporte_cac.xlsx`** — Excel multi-hoja:
  - `resumen`: métricas clave (CAC, CPL, tasa, LTV, ratio LTV/CAC, ciclo)
  - `matches`: cada lead matcheado con su deal, score y regla
  - `leads_no_convertidos`: leads de Meta sin deal asociado → fuga
  - `deals_sin_lead`: clientes que pagaron pero no salieron de Meta →
    canales orgánicos / referidos
  - `by_pipeline`: CAC por Bariátrica/Balón/Plástica/General
  - `by_ad_id`: top anuncios por conversiones (extraído de etiquetas
    `ad_id.XXX` del CSV)
  - `anomalias`: matches donde el deal es anterior al lead (>7d)

- **`RESUMEN_EJECUTIVO.md`** — markdown 1-pager para compartir.
- **`metrics.json`** — métricas en JSON para dashboards o monitoreo CI.

## Hallazgos preliminares (sólo CSV Meta, sin Zendesk aún)

Del CSV `leads_enero_mayo.csv` (revisión manual del primer chunk):

1. **Pico fuerte 18-26 enero**: más del 50% de los leads del trimestre
   se concentran en esa ventana → alguna campaña se prendió ahí.
2. **Canal dominante**: Instagram ≈ 70% / Messenger ≈ 25% / Correo ≈ 5%.
3. **Ad sets identificados** en etiquetas:
   `ad_id.120235729296200044`, `ad_id.120235729186700044`,
   `ad_id.120236558435240044` → distintos anuncios activos.
4. **"Etapa" ya pre-clasifica**: ~15% "Calificado", el resto
   "Registrado". El % calificado puede usarse como upper-bound para
   conversión esperada.
5. **Baja calidad de contacto en leads IG/Messenger**: muchos nombres
   son handles tipo `cositas_figaro`, `Maher 🇻🇪💕🇨🇱` → difíciles
   de matchear con el CRM.
