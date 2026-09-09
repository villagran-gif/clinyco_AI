# Ficha viva de Antonia en notas privadas de Chatwoot

Objetivo: que los agentes puedan retomar una conversación sin volver a preguntar datos ya entregados por el paciente.

## Principio

Antonia mantiene una nota privada consolidada dentro de la conversación. No crear una nota por cada campo. La nota se vuelve a publicar sólo cuando existe información nueva, corregida o relevante para el siguiente agente.

Chatwoot permite crear mensajes privados con `private: true` mediante POST `/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages`.

## Formato inicial

📋 **DATOS EXTRAÍDOS — ANTONIA**

👤 Nombre: Lorena Ríos Echiburú
⚖️ Peso: 88 kg
📏 Estatura: 1,65 m
📊 IMC: 32,3
🏥 Previsión: FONASA
🩺 Cirugía previa: Manga gástrica
📅 Año cirugía previa: 2013
🎯 Motivo principal: Reganancia de peso
🧪 Estudios: Endoscopia hace 2 años
💬 Interés actual: Cirugía revisional / conversión
💰 Preguntó por: valor y financiamiento
📍 Ciudad: pendiente
📞 Próximo paso: pendiente de evaluación / agenda

**No volver a preguntar:** cirugía previa, año, peso, estatura, motivo, estudios.
**Faltantes útiles:** previsión, ciudad, edad (según flujo).

Actualizado automáticamente por Antonia: 20:38.

## Reglas

1. La nota es privada y nunca se envía al paciente.
2. Sólo incluir datos explícitamente aportados o derivados de forma determinista (por ejemplo IMC calculado desde peso y estatura confirmados).
3. No convertir inferencias débiles, reclamos ni lenguaje ambiguo en hechos clínicos.
4. Si el paciente corrige un dato, la versión nueva prevalece y debe quedar indicado como actualizado.
5. Mantener una lista `no_volver_a_preguntar` basada en `questionKey` y campos confirmados.
6. No copiar toda la conversación; la nota debe ser operativa y breve.
7. No escribir RUT completo, diagnósticos sensibles innecesarios ni datos que no ayuden al agente a continuar.
8. Actualizar por cambio de estado, no por cada mensaje. Debounce recomendado: 3–5 s después del último fragmento o al finalizar un turno lógico.
9. Si interviene un humano, congelar la nota automática durante la toma humana, salvo que se implemente un modo explícito de observación no invasiva.
10. La base de datos sigue siendo la fuente estructurada de verdad; la nota privada es una vista para agentes, no un segundo sistema maestro.

## Implementación recomendada

- Generar la ficha desde `state.contactDraft`, `state.measurements`, `state.preevaluation`, `dealDraft` y hechos confirmados.
- Crear una huella hash del contenido normalizado; si no cambia, no publicar otra nota.
- Como Chatwoot no ofrece edición de mensaje en el flujo actual del adaptador, mantener sólo una nota visible reciente y evitar spam; evaluar posteriormente si se puede borrar/sustituir la anterior de forma segura o usar atributos de conversación para estado estable.
- En la primera versión, publicar una nueva nota sólo cuando cambien campos relevantes y como máximo una vez por turno lógico.
- Añadir `source_message_id`/timestamp internamente para trazabilidad, sin mostrarlos necesariamente al agente.

## Criterios de aceptación

- Si el paciente ya dijo peso y estatura, el agente los ve en la nota y Antonia no los vuelve a preguntar.
- Si luego corrige 88 kg por 84 kg, la ficha siguiente muestra 84 kg y el IMC recalculado.
- `Ya respondí` no aparece como motivo clínico.
- `Es un robot?` no aparece como dato clínico.
- Preguntas de precio y financiamiento sí aparecen como intención comercial.
- Un agente puede abrir la conversación y saber en menos de 10 segundos quién consulta, qué busca, qué datos están confirmados y qué falta.
