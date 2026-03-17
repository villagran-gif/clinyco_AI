# Feedback En Google Sheets

Objetivo:

- que el equipo escriba en español simple
- que la hoja muestre de inmediato cómo lo interpretó la IA
- reducir ambigüedades antes de sincronizar al bot

## Qué hace

El script de Google Sheets agrega 3 columnas automáticas:

- `Interpretacion IA`
- `Estado IA`
- `Observaciones IA`

Y tambien prepara la hoja con apoyo visual:

- encabezados congelados
- filtro en la fila 1
- listas desplegables en columnas tipo `SI/NO`
- ayuda guiada en columnas como `Telemedicina`, `Duracion` y `Valor`

Ejemplos:

- `70,000` -> `valor=$70.000 CLP`
- `70mil la consulta` -> `valor=$70.000 CLP`
- `No realiza telemedicina` -> `telemedicina=No`
- `Solo telemedicina` -> `telemedicina=Solo telemedicina`

## Archivo

Usar este archivo en Google Apps Script:

- `google-sheets/clinyco_feedback.gs`

## Pestañas esperadas

- `sedes`
- `profesionales`
- `procedimientos`
- `reglas_de_cobertura`
- `preguntas_frecuentes_seguras`

## Flujo recomendado

1. El equipo edita el Google Sheet
2. La opcion `Clinyco IA > Preparar hoja actual` agrega validaciones simples para evitar formatos raros
3. El Apps Script entrega feedback inmediato
4. Cuando la fila queda clara, se sincroniza al backend
5. El backend vuelve a normalizar para asegurar consistencia

## Regla importante

Aunque la hoja entregue feedback, el bot debe usar siempre la versión normalizada al sincronizar, no el texto libre original como única fuente.
