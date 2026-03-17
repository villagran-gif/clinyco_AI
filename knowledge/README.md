# Knowledge

Esta carpeta no es la fuente diaria de verdad.

Uso recomendado:

- Google Sheets = fuente de verdad para el equipo
- `knowledge/*.json` = copia normalizada para el bot
- `scripts/sync-knowledge-from-sheets.js` = sincroniza desde Google Sheets
- `google-sheets/clinyco_feedback.gs` = feedback inmediato y validaciones en la hoja

Objetivo:

- sacar datos operativos del codigo duro
- permitir que agentes no tecnicos actualicen informacion
- mantener una copia local simple y versionada

Archivos actuales:

- `clinics.json`
- `doctors.json`
- `procedures.json`
- `coverage_rules.json`
- `faq_medical_safe.json`
- `normalizers.js`

Regla importante:

- nada de diagnosticos
- nada de prometer horarios exactos si no estan confirmados
- nada de precios inventados
- cuando un agente escriba texto libre, la version sincronizada debe guardar tambien una interpretacion normalizada
