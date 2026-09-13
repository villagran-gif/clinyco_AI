# Proveedor de Antonia

Antonia se ejecuta en **clinyco_AI / Render** (`srv-d6r082fkijhs73bdsejg`). El gateway sell-medinet-backend entrega eventos; el VPS mantiene Medinet. Cambiar el proveedor no requiere desplegar el worker del VPS ni modificar Eugenia.

| Variable del core | Activación Claude | Reversión |
| --- | --- | --- |
| ANTONIA_AI_PROVIDER | anthropic | openai |
| ANTONIA_CLAUDE_MODEL | claude-sonnet-5 | se ignora |
| ANTHROPIC_API_KEY | clave existente de Render | se conserva para Eugenia |
| OPENAI_MODEL / OPENAI_API_KEY | se conservan para otros consumidores | configuración anterior |

El proveedor por defecto sigue siendo OpenAI para no cambiar instalaciones antiguas por un pull. La activación de producción es explícita mediante las variables anteriores. No existe fallback automático entre proveedores. Al arrancar se registra proveedor, modelo y presencia del cliente, nunca la clave.

`analysis/antonia-provider.js` convierte los mensajes existentes a Messages API: instrucciones en `system`, historial con sus roles, imágenes por URL. Sonnet 5 usa `thinking: disabled`; no recibe temperature, reasoning_effort ni response_format de OpenAI. SDK existente, timeout 45 s, sin reintentos automáticos. La evaluación de mejoras usa el mismo proveedor, valida JSON y mantiene pendientes los fallos.

Se conserva el prompt de negocio, la memoria, la ficha privada y las verificaciones de agenda/entrega. Se añade español chileno natural sin forzar jerga. La voz sigue en su cliente TTS separado de OpenAI: esta migración cubre texto e imágenes, no síntesis de audio. Un fallo de TTS conserva el envío de texto existente.

El monitor `ai_usage_events` registra provider=anthropic, modelo, propósito y tokens. En Anthropic, `input_tokens` excluye lecturas/escrituras de caché; el contador total las suma una sola vez. Tarifas estándar verificadas 13-09-2026: Sonnet 5 entrada USD 2/M, salida 10/M, lectura caché 0,20/M, escritura 5 min 2,50/M y 1 hora 4/M. Son estimaciones, no el saldo de la cuenta.

Fuentes: https://platform.claude.com/docs/en/models/sonnet-5/overview y https://platform.claude.com/docs/en/about-claude/pricing

## Verificación

`node --test tests/antonia-provider.test.mjs tests/ai-usage.test.mjs`

La suite de mejoras también prueba persistencia, autenticación, exclusión mutua y reintentos cada media hora (ver `antonia-improvements.md`). Una prueba real y sintética con el SDK instalado y la clave existente del VPS obtuvo Sonnet 5, 199 tokens de entrada y 60 de salida en 1,73 s; comprendió «pega», «tomar hora», «al tiro», «lucas» sin inventar precio ni reserva. No se enviaron mensajes a pacientes. Esta prueba demuestra compatibilidad del SDK y modelo; la activación de Render se verifica por separado con el despliegue, su registro de proveedor y uso posterior en PostgreSQL.
