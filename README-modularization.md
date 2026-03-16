# Modularización propuesta para Antonia

Este paquete toma el repo actual como base y agrega una estructura para sacar de `server.js` todo lo que cambiará seguido:
- configuración conversacional
- prompts
- etapas conversacionales
- faltantes de ficha
- limpieza de Support
- selección de ejemplos curados

## Estado
- `server.js` actual se deja intacto para no romper lo live.
- La estructura nueva queda lista para integrar por etapas.

## Carpetas nuevas
- `config/`
- `prompts/`
- `conversation/`
- `extraction/`
- `memory/`
- `support/`
- `sell/`
- `examples/`
- `scripts/`

## Orden recomendado de integración
1. `config/conversation-config.js`
2. `memory/state-schema.js`
3. `memory/state-summary.js`
4. `extraction/*`
5. `conversation/getConversationStage.js`
6. `conversation/getNextMissingFichaField.js`
7. `conversation/response-strategy.js`
8. `prompts/*`
9. `support/support-cleaning.js`
10. `examples/*`

## Meta
Usar la DB para memoria real y usar OpenAI como redactor amable, no como cerebro caótico del flujo.
