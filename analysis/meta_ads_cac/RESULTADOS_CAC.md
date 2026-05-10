# 📊 Análisis CAC: Meta Ads → Conversiones Zendesk Sell

**Período:** 2026-01-01 → 2026-05-10 (4 meses, 10 días)
**Gasto Meta Ads:** $4,529,962 CLP
**Generado:** 2026-05-10

---

## 🔑 Hallazgo crítico: dos fuentes de leads, datos diferentes

| Fuente | Cantidad | Tiene email | Comentario |
|--------|----------|-------------|------------|
| **Meta Lead Center CSV** | 239 | 0% | Handles IG/Messenger — NO matcheable |
| **Zendesk Sell `FacebookLeads`** | **275** | 100% | Leads reales con emails — **usar este** |

⚠️ La cifra de "1.357 leads" mencionada inicialmente parece venir de métricas
de impresiones/clicks de Meta, NO leads efectivamente registrados en el CRM.

---

## 📉 Embudo real

```
   Meta Ads spend
   $4,529,962 CLP
        ↓
   275 Facebook Leads (CRM)        ← CPL real: $16,473
        ↓
    18 con deal asociado (6.5%)    ← qualification rate
        ↓
     0 cirugías completadas         ← 0 won deals YET (ciclo no terminado)
```

### Distribución de etapas de los 18 deals matcheados:

| Etapa | Cantidad | Categoría |
|-------|----------|-----------|
| CANDIDATO | 3 | incoming |
| EXAMENES PRE-PAD ENVIADOS | 4 | in_progress |
| EXAMENES ENVIADOS | 4 | in_progress |
| PROCESO PREOP | 1 | in_progress |
| SUSPENDIDO | 4 | unqualified |
| SIN RESPUESTA | 2 | lost |
| **CERRADO OPERADO (won)** | **0** | won |

**12 deals están vivos** (incoming + in_progress).
**6 deals murieron** (suspendido + sin respuesta).
**0 deals cerrados ganados**.

---

## 💰 Métricas

| Métrica | Valor | Notas |
|---------|-------|-------|
| Gasto total Meta | $4,529,962 CLP | Período Jan-May 2026 |
| Leads desde Meta (CRM) | 275 | Source `FacebookLeads` (id=2601247) |
| **CPL reportado Meta** | **$16,473** | Costo por lead |
| Deals creados desde leads | 18 (6.5%) | Lead → Qualified prospect |
| Deals cerrados ganados | 0 | Cero cirugías concluidas |
| **CAC real** | **N/A** | (gasto / 0 conversiones = ∞) |
| LTV promedio | N/A | Sin conversiones aún |

---

## 🚨 Problemas detectados

### 1. Fuga masiva en el embudo
**93.5% de los leads no genera siquiera un deal.**
- 275 leads desde Facebook Ads
- Solo 18 (6.5%) tienen un contacto + deal asociado
- 257 leads (93.5%) quedaron sin progreso

**Hipótesis:**
- Leads sin email válido / no responden al outreach
- Falta de seguimiento desde el equipo comercial
- Calidad de leads baja (bots, perfiles incorrectos)

### 2. Ciclo de venta incompleto
0 conversiones a "won" porque:
- Ciclo típico: 60-180 días (lead → cirugía)
- Leads del período se siguen procesando
- **Re-correr análisis en 3-6 meses para ver conversiones reales**

### 3. Source attribution incompleta
Solo 2 fuentes tienen leads recientes:
- `FacebookLeads`: 275
- `Sell Lead Capture Form`: 1

Faltan otras fuentes de tracking (Google Ads, orgánico, referido) o todos los
leads están etiquetados con `FacebookLeads` independiente de su origen real.

---

## ✅ Recomendaciones

### Inmediato
1. **Re-correr este análisis en Septiembre 2026** para capturar conversiones
   reales del período Jan-May (ciclo completo).
2. **Validar manualmente los 18 deals matcheados**:
   - ¿Realmente vinieron de Meta Ads?
   - ¿Hay otros deals que no matchearon por nombre/email distintos?
3. **Investigar la fuga de 257 leads sin deal**:
   - ¿Tienen contactos en Zendesk que no se convirtieron en deal?
   - ¿Hay logs de WhatsApp/conversaciones que indiquen respuesta?

### Corto plazo (1-2 meses)
4. **Mejorar el linking lead → deal** en Zendesk Sell:
   - Cuando un agent crea un deal desde un lead, asegurar que se preserve el
     `source_id=2601247` o un campo custom `lead_origen=Meta`.
5. **Agregar campo "ad_id" a leads** para attribution granular por anuncio.
6. **Implementar Conversions API** desde el deal "won" → Meta Pixel
   con el `event_id` propagado para que Meta optimice por conversiones reales.

### Largo plazo
7. **CRM dashboard de cohorts** con leads por mes vs conversiones a 30/60/90/180d.
8. **A/B testing por ad_id** para identificar campañas de mayor LTV/CAC.

---

## 📁 Outputs generados

```
analysis/meta_ads_cac/out/
├─ metrics.json          # Métricas en JSON
└─ matches.csv           # 275 leads + sus matches (vacío si no hay deal)
```

### Cómo re-ejecutar

```bash
cd analysis/meta_ads_cac
export ZENDESK_SELL_API_TOKEN=xxx   # de Render env vars
python3 analyze_cac_facebookleads.py \
    --gasto-clp 4529962 \
    --periodo-inicio 2026-01-01 \
    --periodo-fin 2026-05-10 \
    --output-dir ./out
```

### Para periodos futuros

Cambiar `--periodo-fin` a una fecha más reciente (ej `2026-09-01`) y ajustar
`--gasto-clp` al gasto acumulado de ese período en Meta Ads Billing.

---

## 🛠️ Notas técnicas

- **Source ID `2601247` = "FacebookLeads"** en Zendesk Sell.
- **Pipelines won**: Bariátrica (CERRADO OPERADO), Balones (CERRADO INSTALADO),
  Plástica (CERRADO OPERADO), General (CERRADO OPERADO).
- **Definición conversión**: `stage.category == "won"` o `FECHA DE CIRUGÍA` poblado.
- **Matching**: lead.email/phone/name → contact.email/phone/name en deals,
  con filtro temporal (deal creado entre -7 y +365 días del lead).
