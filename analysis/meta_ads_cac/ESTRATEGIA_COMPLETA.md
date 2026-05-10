# 📋 Estrategia Completa: CAC Analysis Meta Ads (May 2026)

## Resumen Ejecutivo

Implementamos un **análisis CAC multi-capa** para entender el costo de adquisición real (CAC) de los pacientes provenientes de Meta Ads.

**Período**: Enero 1 - Mayo 10, 2026  
**Gasto**: $4,529,962 CLP  
**Leads identificados**: 275 (desde Zendesk Sell FacebookLeads source)  
**Deals creados**: 18 (6.5% conversion)  
**Conversiones won**: 0 (ciclo aún incompleto)

---

## 🏗️ Arquitectura de 3 Capas

### Capa 1️⃣: FacebookLeads (Zendesk Sell) — YA COMPLETADO

**Objetivo**: Matchear leads Meta que fueron importados a Zendesk Sell con deals cerrados.

**Fuente de datos**:
- **Zendesk Sell Leads Module**: Source ID `2601247` (FacebookLeads)
- **275 leads** con email 100% poblado
- Pre-importados automáticamente (¿vía Zapier? → verificar)

**Estrategia de matching**:
```
Lead (email, phone, name, created_at)
        ↓
    [Score: 100 si email exacto, 90 si phone, 70 si nombre + ventana]
        ↓
Deal (contact_email, stage.category, FECHA DE CIRUGÍA)
        ↓
    CAC = gasto / conversions
```

**Ventana temporal**: Deal debe crearse entre **-7 y +365 días** después del lead.

**Resultados** (ver `RESULTADOS_CAC.md`):
- ✅ 275 leads con email válido
- ✅ 18 deals matcheados (6.5%)
- ✅ 0 conversiones won (sales cycle incomplete)
- ❌ 257 leads (93.5%) sin deal → fuga masiva
- **CAC real**: N/A (sin conversiones)

**Script**: `analyze_cac_facebookleads.py`

```bash
export ZENDESK_SELL_API_TOKEN=xxx
python3 analyze_cac_facebookleads.py \
    --gasto-clp 4529962 \
    --periodo-inicio 2026-01-01 \
    --periodo-fin 2026-05-10
```

---

### Capa 2️⃣: Zendesk Support (Message History) — NUEVO

**Objetivo**: Enriquecer la Capa 1 con interacciones de soporte pre-venta.

**Situación actual**: El CSV Meta original tenía emails, pero la **versión actual solo tiene nombres de perfil** (Instagram/Messenger handles).

**Fuente de datos**:
- **Zendesk Support API**: `/search.json` (tickets + comments + users)
- **Meta CSV names**: Nombres del perfil (e.g., "Yanina Gissel")
- **239 leads** del CSV Meta a buscar

**Estrategia de matching**:
```
Meta CSV profile name (e.g., "Yanina Gissel")
        ↓
    [Búsqueda en Zendesk Support: text:"Yanina Gissel"]
        ↓
    Ticket found con requester_id
        ↓
    Extraer requester email/phone/name
        ↓
    [Cross-validate con Capa 1 por email/phone]
```

**Casos de uso**:
- **Caso A**: Lead que escribió a soporte PRE-venta (calidad validation) ✓
- **Caso B**: Lead sin email en Meta CSV pero SÍ en soporte (enriquecimiento) ✓
- **Caso C**: Lead que nunca escribió a soporte (lead dormido/baja calidad) ✓

**Script**: `analyze_cac_zendesk_support.py`

```bash
export ZENDESK_SUBDOMAIN=clinyco
export ZENDESK_EMAIL=admin@clinyco.com
export ZENDESK_API_TOKEN=xxxxxx

python3 analyze_cac_zendesk_support.py
```

---

### Capa 3️⃣: Conversions API (Futuro)

**Objetivo**: Feedback loop a Meta Ads para que optimice por conversiones reales.

**Flujo**:
```
Deal won (stage.category == "won")
    ↓
[POST event a Meta Conversions API]
    ↓
Meta recibe: event_id, value, lead source
    ↓
Meta optimiza futuros ads por conversiones reales (no clicks/leads)
```

**Status**: ⏳ Planeado para Q2 2026

**Beneficios**:
- Meta dejará de optimizar por CPL (cost per lead)
- Pasará a CAC real (cost per acquired patient)
- Impacto directo en ROI de campaña

---

## 🔄 Integración: `integrate_layers.py`

Compara Capa 1 + Capa 2 para generar estadísticas tipo Venn diagram:

```
                 Capa 1            Capa 2
              FacebookLeads     Zendesk Support
              (275 leads)       (X leads found)
                    ∩
                    ↓
         [X% overlap]
         [Y% nuevos leads]
```

**Script**: `integrate_layers.py`

```bash
python3 integrate_layers.py
```

**Output**:
- `out/integration_report.json` con estadísticas Venn
- Identificación de nuevos leads en soporte no en CRM
- Recomendaciones de enriquecimiento

---

## 📊 Flujo Completo: Cómo Ejecutar Todo

### Paso 1: Ejecutar Capa 1 (base confiable)

```bash
cd /home/user/clinyco_AI/analysis/meta_ads_cac

export ZENDESK_SELL_API_TOKEN=<token de Zendesk Sell API>

python3 analyze_cac_facebookleads.py \
    --gasto-clp 4529962 \
    --periodo-inicio 2026-01-01 \
    --periodo-fin 2026-05-10 \
    --output-dir ./out
```

**Output esperado**:
- `out/matches.csv` — 275 leads + 18 deals matcheados
- `out/metrics.json` — CAC/CPL/conversión rates

### Paso 2: Ejecutar Capa 2 (enriquecimiento)

```bash
export ZENDESK_SUBDOMAIN=clinyco
export ZENDESK_EMAIL=admin@clinyco.com
export ZENDESK_API_TOKEN=<token de Zendesk Support API>

python3 analyze_cac_zendesk_support.py
```

**Output esperado**:
- `out/zendesk_support_matches.json` — X leads + requester names/emails

### Paso 3: Integrar resultados

```bash
python3 integrate_layers.py
```

**Output esperado**:
- `out/integration_report.json` — Venn diagram + estadísticas
- Console report con findings

### Paso 4: Generar reporte ejecutivo

Ver `RESULTADOS_CAC.md` (generado en Paso 1).

---

## 🎯 Hallazgos Clave (Capa 1 — Completado)

### Embudo Real

```
$4,529,962 CLP (Meta Ads spend)
         ↓
   275 Facebook Leads
    (CPL: $16,473)
         ↓
    18 deals created (6.5%)
         ↓
     0 conversions (0%)
        [Ciclo incompleto]
```

### Problemas Identificados

1. **Fuga masiva 93.5%**: 257 de 275 leads no crearon deal
   - Hipótesis: Leads sin email válido / no responden / poor quality
   - Acción: Investigar si tienen contactos en CRM sin deal linkado

2. **Ciclo de venta incompleto**: 0 conversiones en período Jan-May
   - Razón: Lead → Deal toma 60-180 días, pero seguimiento está activo
   - Acción: Re-ejecutar análisis en Septiembre 2026

3. **Source attribution incompleta**: ¿Dónde están los otros 239 leads del CSV?
   - FacebookLeads source tiene 275 pero Meta CSV tiene 239 (diferencia)
   - Teoría: Pueden haber sido importados con source diferente o en batch posterior

---

## 💡 Recomendaciones

### Inmediato (esta semana)
1. ✅ Ejecutar Capa 1 + Capa 2 (scripts listos)
2. ✅ Validar manualmente los 18 deals matcheados
3. ✅ Investigar la fuga de 257 leads sin deal

### Corto plazo (1-2 meses)
4. Mejorar linking lead → deal en Zendesk Sell (añadir custom field `lead_origen`)
5. Agregar `ad_id` a cada lead para A/B testing por anuncio
6. Implementar Capa 3 (Conversions API feedback)

### Largo plazo
7. CRM dashboard de cohorts (leads/month vs conversions @30/60/90/180d)
8. Eliminar CSV matching, usar solo API sources

---

## 🗂️ Archivos del Proyecto

```
analysis/meta_ads_cac/
├── 📄 README.md                           ← Instrucciones setup
├── 📄 ESTRATEGIA_COMPLETA.md              ← Este archivo
├── 📄 ZENDESK_SUPPORT_MATCHING.md         ← Detalles Capa 2
├── 📄 RESULTADOS_CAC.md                   ← Hallazgos Capa 1
├── 📄 APPROACH_COMPARISON.md              ← Comparación enfoques
├──
├── 🐍 analyze_cac_facebookleads.py        ← Capa 1 [PRODUCCIÓN]
├── 🐍 analyze_cac_zendesk_support.py      ← Capa 2 [NUEVO]
├── 🐍 integrate_layers.py                 ← Integración
├── 🐍 analyze_cac.py                      ← Legacy (no usar)
├──
├── 📊 leads_enero_mayo.csv                ← Input Meta CSV
├── 📋 requirements.txt                    ← Dependencies
├──
└── out/                                   ← Generado
    ├── matches.csv                        ← Capa 1 output
    ├── metrics.json                       ← Capa 1 metrics
    ├── zendesk_support_matches.json       ← Capa 2 output
    └── integration_report.json            ← Integración
```

---

## ⏰ Timeline: Próximo Re-análisis

**Fecha actual**: 2026-05-10  
**Período analizado**: 2026-01-01 → 2026-05-10

**Cuándo re-ejecutar**: **Septiembre 1, 2026** (4 meses después)
- Ciclo de venta típico: 60-180 días
- La mayoría de leads de Enero-Mayo habrán convertido o perdido
- Podremos medir CAC real vs predicción actual

**Cómo re-ejecutar**:
```bash
python3 analyze_cac_facebookleads.py \
    --gasto-clp <gasto acumulado Enero-Septiembre en Meta Billing> \
    --periodo-inicio 2026-01-01 \
    --periodo-fin 2026-09-01 \
    --output-dir ./out/2026-09-01
```

---

## 🔗 Referencias Externas

- **Zendesk Sell API docs**: https://getbase.readme.io/v2.0/
- **Zendesk Support API docs**: https://developer.zendesk.com/api-reference/
- **Meta Conversions API**: https://developers.facebook.com/docs/marketing-api/conversions-api
- **Google Drive Meta CSV**: https://drive.google.com/drive/folders/1y98HPfWoT-nmvVt3Zp4N7MELVIr5JdBv

---

**Documento**: ESTRATEGIA_COMPLETA.md  
**Generado**: 2026-05-10  
**Versión**: 1.1 (Multi-capa)  
**Status**: ✅ Documentado, 🚀 Listo para ejecutar

