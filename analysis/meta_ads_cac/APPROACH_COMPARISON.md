# Enfoque de análisis CAC: Comparación

Tu feedback fue "pero en crm sell ta bien hay un modulo leads" — esto sugiere que debería usar el módulo de leads que ya existe en lugar de fuzzy-matching el CSV de Meta. Pero necesito confirmar la estrategia correcta.

## Situación actual

Tienes:
- **1.357 leads de Meta Ads** (enero-mayo 2026)
- **$4.529.962 CLP** invertidos
- **CPL reportado**: ~$3.338 / lead
- **CAC real desconocido**: depende de cuántos leads se convirtieron a pacientes

## Dos enfoques posibles

### ✅ Enfoque 1: CSV Matching (actual en PR #146)

**Qué hace:**
1. Carga CSV de Meta Lead Center (1.357 registros)
2. Descarga deals "won" de Zendesk Sell API
3. Matchea por: email → teléfono → nombre (fuzzy) + ventana temporal
4. Calcula CAC = gasto / conversiones matcheadas

**Ventajas:**
- ✓ Funciona ahora mismo (no requiere datos pre-importados)
- ✓ Robusta a datos incompletos (Meta CSV tiene pocos emails/phones)
- ✓ Scripts ya listos (analyze_cac.py está 90% completo)

**Desventajas:**
- ✗ Fuzzy matching débil (~70% de matches son nombre+ventana)
- ✗ Requiere validación manual de matches score ≤ 70
- ✗ Depende de que la ventana temporal (±90d) sea correcta

**¿Cuándo usar?: Ahora, si Meta leads NO están en Zendesk Sell leads module.**

---

### 🆕 Enfoque 2: Leads Module (que sugeriste)

**Qué hace:**
1. Consulta `/v2/leads` en Zendesk Sell API
2. Filtra por `source` = "Meta Ads" (u otro indicador)
3. Para cada lead, detecta si tiene un deal asociado (win)
4. Calcula CAC = gasto / leads convertidos

**Ventajas:**
- ✓ Datos más limpios (ya están en el CRM)
- ✓ No requiere fuzzy matching
- ✓ Source field identifica origen automáticamente
- ✓ Potentially más preciso si leads→deals están bien linkeados

**Desventajas:**
- ✗ **Requiere que Meta leads YA ESTÉN en Zendesk Sell** (pre-importados)
- ✗ Requiere que tengan campo `source` poblado
- ✗ Requiere que haya link lead→deal (Zendesk Sell no lo hace automáticamente)

**¿Cuándo usar?: Si Meta leads están siendo importados a Zendesk Sell con source tracking.**

---

## Investigación realizada

### ¿Están los Meta leads en Zendesk Sell leads module?

Busqué evidencia de un proceso de importación de Meta leads:

```
clinyco_AI/ZAPS/meta-conversion-leads/    ← SOLO envía conversiones A Facebook
sell-medinet-backend/sell-service/routes/leads.js  ← API para CRUD de leads
migration/import-from-zendesk.py                   ← Importa desde Zendesk (no Meta)
```

**Resultado:** No encontré evidencia de que Meta leads estén siendo importados 
automáticamente a Zendesk Sell.

### Campos disponibles en CRM Lead (Frappe)

El schema tiene:
- `first_name`, `last_name`, `email`, `phone`, `mobile_no`
- 79 campos `zd_*` (datos médicos chilenos)
- **SÍ hay campo `source`** (mencionado en comentarios, pero no está mapeado en leads.js)
- **NO hay campo `converted_to_deal_id`** (leads ↔ deals no se linkean automáticamente)

---

## Recomendación

**Mi propuesta: Usa Enfoque 1 (CSV Matching) AHORA**

Razón: No hay evidencia de que Meta leads estén siendo importados a Zendesk Sell 
con source tracking.  Pero Enfoque 1 YA FUNCIONA con el CSV de Meta que tienes.

**Luego: Considera migrar a Enfoque 2**

Si en el futuro implementas:
- Zapier automation que importe Meta leads → Zendesk Sell leads con source="Meta Ads"
- Link automático entre lead y su deal convertido
- Então puedes usar analyze_cac_leads_based.py para un análisis más limpio

---

## Qué necesito de ti

¿Puedes confirmar?

1. **¿Meta leads están siendo importados a Zendesk Sell?**  
   - Sí → dame detalles de cómo  
   - No → confirmamos que CSV matching es el enfoque correcto

2. **¿El CSV `leads_enero_mayo.csv` contiene todos los leads que necesitas?**  
   - Sí → procedemos con analyze_cac.py  
   - Necesito otra fuente → ¿cuál?

3. **¿Cuál es el token Zendesk Sell** que puedo usar para descargar deals?  
   - O prefiero pasar un CSV export manualmente?

Una vez confirmes, corro el análisis y te entrego:
- `reporte_cac.xlsx` (con todos los detalles del embudo)
- `RESUMEN_EJECUTIVO.md` (1-pager con CAC real vs CPL Meta)
- `anomalias.csv` (matches cuestionables para validar manualmente)

