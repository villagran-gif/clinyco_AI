# Análisis CAC: Meta Ads → Conversiones Zendesk Sell

Calcula el **CAC real** cruzando los leads de Meta Ads con los deals
cerrados en Zendesk Sell. Compara con el CPL reportado por Meta para
entender la brecha entre "alguien dejó datos" y "alguien pagó".

## 🆕 Estrategia Multi-Capa (May 2026)

El análisis ahora usa **tres fuentes de datos** para máxima cobertura:

| Capa | Fuente | Script | Estado |
|------|--------|--------|--------|
| **1** | FacebookLeads (Zendesk Sell) | `analyze_cac_facebookleads.py` | ✅ Completado |
| **2** | Zendesk Support (message history) | `analyze_cac_zendesk_support.py` | ✅ Nuevo |
| **3** | Conversions API tracking | (futuro) | ⏳ Planeado |

Ver `ZENDESK_SUPPORT_MATCHING.md` para detalles sobre cómo se complementan las capas.

## Estructura

```
analysis/meta_ads_cac/
├─ analyze_cac_facebookleads.py     # Capa 1: CRM Sell leads (PRINCIPAL)
├─ analyze_cac_zendesk_support.py   # Capa 2: Support history (NUEVO)
├─ analyze_cac.py                   # Legacy: CSV matching (original)
├─ requirements.txt                 # Dependencias Python
├─ README.md                         # Este archivo
├─ ZENDESK_SUPPORT_MATCHING.md      # Estrategia multi-capa
├─ RESULTADOS_CAC.md                # Resultados finales (Capa 1)
├─ APPROACH_COMPARISON.md           # Comparación de enfoques
├─ leads_enero_mayo.csv             # Input: Meta CSV
└─ out/                             # Generado por scripts
   ├─ zendesk_support_matches.json       # Capa 2 output
   ├─ matches.csv                       # Capa 1 matches
   ├─ metrics.json                      # Capa 1 metrics
   └─ reporte_cac.xlsx                  # (legacy) multi-sheet
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

### Opción A: FacebookLeads (Capa 1) — Recomendado como base

```bash
export ZENDESK_SELL_API_TOKEN=xxx
python3 analyze_cac_facebookleads.py \
    --gasto-clp 4529962 \
    --periodo-inicio 2026-01-01 \
    --periodo-fin 2026-05-10 \
    --output-dir ./out
```

Output: `out/matches.csv` + `out/metrics.json`

### Opción B: Zendesk Support (Capa 2) — Complementario

Requiere credenciales de Zendesk Support (diferente de Zendesk Sell):

```bash
export ZENDESK_SUBDOMAIN=clinyco
export ZENDESK_EMAIL=admin@clinyco.com
export ZENDESK_API_TOKEN=xxxxxxxxxxxx

python3 analyze_cac_zendesk_support.py
```

Output: `out/zendesk_support_matches.json`

### Opción C: CSV Matching (legacy) — No recomendado

Solo usa Meta CSV sin integración Zendesk (weak matching):

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

### Capa 1: FacebookLeads (Zendesk Sell)
Multi-capa con score descendente:

| Score | Regla | Confianza | Cobertura |
|-------|-------|-----------|-----------|
| 100 | email normalizado exacto | Alta | ~60% (275 leads tienen email) |
| 90 | teléfono E.164 exacto | Alta | ~20% |
| 70 | nombre normalizado exacto + ventana ±7 a +365d | Media | ~15% |

Normalización:
- **Email**: lowercase, strip, sin espacios.
- **Teléfono**: solo dígitos → `+569XXXXXXXX` (móvil chileno).
- **Nombre**: lowercase, sin acentos, sin emojis, sin caracteres
  especiales, espacios colapsados.

Ventana temporal: deal creado entre **-7 y +365 días** después del lead.
(Leads pueden convertir hasta 1 año después; pero deals ANTES del lead
son falsos positivos).

### Capa 2: Zendesk Support (Message History)
Búsqueda por nombre de perfil:

| Método | Input | Output | Confianza |
|--------|-------|--------|-----------|
| Text search | `text:"Yanina Gissel"` | Tickets con ese nombre | Media |
| User search | `name:Yanina Gissel` | Usuarios en sistema | Media-Alta |
| Normalization | `yanina gissel` | Búsqueda case-insensitive | Media |

Requester encontrado en ticket → Email + Phone → Cross-check con Capa 1.

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
