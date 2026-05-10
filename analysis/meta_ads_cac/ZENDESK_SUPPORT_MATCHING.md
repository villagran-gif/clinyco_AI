# 🔍 Meta Ads → Zendesk Support Message History Matching

## Situación

El CSV de Meta Ads **originalmente tenía emails** pero ahora **solo contiene nombres de perfiles** de Instagram/Messenger. Para complementar el análisis de FacebookLeads (que usa emails), hemos implementado una **segunda fuente**: el historial de mensajes en Zendesk Support.

### Antes vs Ahora

| Período | Fuente de datos | Información disponible |
|---------|-----------------|----------------------|
| **Jan-May 2026 (anterior)** | Meta CSV | email (100%), nombre, teléfono |
| **Ahora** | Meta CSV | ~~email~~ ❌, nombre (IG/Messenger), teléfono parcial |

---

## Estrategia de matching: Tres capas

### Capa 1️⃣: FacebookLeads Source (Zendesk Sell) — YA IMPLEMENTADO
- **Qué**: Leads pre-importados en Zendesk Sell con source_id=2601247
- **Datos**: 275 leads con 100% email coverage
- **Matching**: email/phone/nombre + ventana temporal (±7 a +365 días)
- **Resultado**: 18 deals (6.5%), 0 won conversions
- **Script**: `analyze_cac_facebookleads.py` ✅

### Capa 2️⃣: Zendesk Support Message History — NUEVO
- **Qué**: Tickets y conversaciones donde clientes mencionan el nombre del perfil
- **Datos**: Requester names, emails, phones del historial de soporte
- **Matching**: perfil_name → tickets/comments → requester_id → contact
- **Valor**: Detecta leads que RESPONDIERON POR SOPORTE (pre-sales inquiry)
- **Script**: `analyze_cac_zendesk_support.py` 🆕

### Capa 3️⃣: Meta Ads Pixel Tracking (futuro)
- **Qué**: Conversions API events propagados desde Zendesk Sell deals
- **Datos**: event_id, timestamp, deal status
- **Matching**: A nivel de evento, sin fuzzy matching
- **Valor**: Retroalimentación a Meta Ads para optimización
- **Status**: ⏳ Planeado

---

## Casos de uso

### Caso A: Lead existente en FacebookLeads + support ticket
**Ejemplo**: María creó un lead en Instagram el 2026-01-15 → apareció en FacebookLeads source.
El 2026-01-20 escribió a Zendesk Support preguntando por precios.

**Resultado actual**: Matcheado por email en FacebookLeads ✓
**Beneficio de Capa 2**: Confirma que María interactuó con soporte, analizar lead quality

### Caso B: Lead solo en Meta CSV + soporte directo
**Ejemplo**: Juan tiene un perfil en Meta pero NO fue capturado en FacebookLeads (no rellenó el formulario).
Sin embargo, el 2026-02-10 escribió por soporte directamente.

**Resultado actual**: No apareció en FacebookLeads ❌
**Beneficio de Capa 2**: Juan es detectable en Zendesk Support → enriquece análisis CAC

### Caso C: Lead sin soporte
**Ejemplo**: Claudia vio el ad en Instagram pero no respondió ni escribió a soporte.

**Resultado actual**: En FacebookLeads pero sin deal
**Beneficio de Capa 2**: Confirma que no hubo interacción de soporte (lead dormido/baja calidad)

---

## Implementación: `analyze_cac_zendesk_support.py`

### Requisitos
```bash
export ZENDESK_SUBDOMAIN=clinyco
export ZENDESK_EMAIL=admin@clinyco.com
export ZENDESK_API_TOKEN=xxxxxxxxxxxx
```

### Uso

**Análisis de muestra (30 primeros leads)**:
```bash
cd /home/user/clinyco_AI/analysis/meta_ads_cac
python3 analyze_cac_zendesk_support.py
```

**Output esperado**:
- `out/zendesk_support_matches.json` — matches encontrados
- Console report con tasa de cobertura

### Algoritmo

1. **Cargar CSV Meta** → 239 leads con nombres de perfil
2. **Normalizar nombres** → lowercase, sin acentos (e.g., "Yanina Gissel" → "yanina gissel")
3. **Para cada lead**:
   - Buscar en Zendesk Support: `/search.json?query=text:"Yanina Gissel"`
   - Buscar usuario: `/users/search.json?query=name:Yanina Gissel`
   - Si hay match: extraer requester_id, email, teléfono
4. **Guardar matches** → JSON con detalles

---

## Limitaciones y consideraciones

| Limitación | Impacto | Mitigación |
|------------|--------|-----------|
| Nombres incompletos en Meta CSV | Fuzzy matching débil | Normalización + búsqueda por palabras |
| Zendesk Support requiere exactitud de nombre | Falsos negativos | Búsqueda amplia + revisión manual |
| Requester en soporte ≠ requester en LinkedIn/Instagram | Falsos positivos | Cross-validate con email/phone |
| Histórico incompleto (tickets deletados) | Cobertura baja | Usar backup de Zendesk si existe |

---

## Comparación: Capa 1 vs Capa 2

### FacebookLeads (Capa 1) — Directo del CRM

✅ **Ventajas**:
- Email 100% poblado → matching preciso
- Ya importados a Zendesk Sell → fácil de listar
- Timestamp exacto de capture
- Directo link a deals si existen

❌ **Desventajas**:
- Solo 275 leads (vs 239 en CSV original) — ¿dónde están los otros?
- Requiere que el lead haya llenado formulario en-site
- No visible si no convierte a deal rápido

### Zendesk Support (Capa 2) — Del historial de tickets

✅ **Ventajas**:
- Captura leads que escribieron a soporte PRIMERO (antes de form)
- Detecta leads dormidos sin soporte interaction
- Valida calidad de lead (si interactuó con equipo)
- Información de emails/phones desde tickets

❌ **Desventajas**:
- Requiere búsqueda por nombre (fuzzy, propenso a errores)
- Requester_id ≠ contact_id (need relational mapping)
- Soporte acesso histórico limitado
- Require API token con acceso read

---

## Próximos pasos

### Corto plazo (esta semana)
1. **Ejecutar** `analyze_cac_zendesk_support.py` con credenciales reales
2. **Validar** matches encontrados vs FacebookLeads matches
3. **Crear** reporte de Venn diagram: leads en Capa1 ∪ Capa2 ∪ Capa3
4. **Investigar** los ~85% de leads sin ticket en soporte

### Mediano plazo (mes próximo)
5. **Implementar** link automático requester_id → contact_id en Zendesk Sell
6. **Agregar** Capa 3: Conversions API tracking desde deals
7. **Crear** dashboard de cohorts: leads/month vs support interactions vs conversions
8. **A/B test** por canal (Instagram vs Messenger) para ver diferencias de CAC/LTV

### Largo plazo
9. **Implementar** Conversions API en Zendesk Sell (deal won → Meta Pixel)
10. **Migrar** a lead tracking con pixel + Conversions API (eliminar CSV matching)
11. **Optimizar** Meta Ads campaigns basado en CAC real por ad_id

---

## Referencia técnica

### Zendesk Support API endpoints usados

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/search.json?query=text:"..."` | GET | Buscar tickets por nombre |
| `/users/search.json?query=name:...` | GET | Buscar usuarios por nombre |
| `/users/{id}.json` | GET | Obtener detalles de usuario |
| `/tickets/{id}.json` | GET | Obtener detalles de ticket |
| `/tickets/{id}/comments.json` | GET | Obtener comentarios de ticket |

### Auth
```
Authorization: Basic {base64(email/token:api_token)}
```

### Rate limiting
- Zendesk Support API: 200 req/min per token
- Implementar exponential backoff si se alcanza 429 (Too Many Requests)

---

## FAQ

**P: ¿Cuál debería usar, Capa 1 o Capa 2?**
A: **Ambas**. Son complementarias. Usa Capa 1 como base confiable y Capa 2 para validación/enriquecimiento.

**P: ¿Qué pasa si un requester en soporte tiene nombre diferente al perfil de Instagram?**
A: Será un falso negativo. Revisa el email/phone en el ticket vs el lead para confirmar.

**P: ¿Debo re-importar Meta leads a Zendesk Sell?**
A: No necesario si usas Zendesk Support API. Pero sí sería útil para centralizar datos.

**P: ¿Cuándo debo reporte este análisis?**
A: En Septiembre 2026 (3 meses después) para capturar conversiones reales del período Jan-May.

---

## Archivos del proyecto

```
analysis/meta_ads_cac/
├── analyze_cac_facebookleads.py      ← Capa 1: CRM Sell FacebookLeads
├── analyze_cac_zendesk_support.py    ← Capa 2: Support message history
├── analyze_cac.py                     ← Original CSV matching (legacy)
├── leads_enero_mayo.csv              ← Input: Meta CSV con nombres
├── RESULTADOS_CAC.md                 ← Results: Capa 1 findings
└── out/
    ├── zendesk_support_matches.json   ← Output: Capa 2 findings
    ├── matches.csv                    ← Capa 1 detailed matches
    └── metrics.json                   ← Capa 1 metrics
```

---

**Generado**: 2026-05-10
**Última actualización**: Agregada Capa 2 (Zendesk Support matching)
