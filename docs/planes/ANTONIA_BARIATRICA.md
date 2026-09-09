# AntonIA — prioridad cirugía bariátrica y conversación natural

Fecha: 2026-09-09
Rama: `mejoras/antonia-cirugia-bariatrica`
Repositorio: `villagran-gif/clinyco_AI`
Base: `89909b5c6be4efc0b4f5cf7f2aca0ca63f255d98` (PR #215).
Rama hermana: `mejoras/melania-agendas`.

## Estado de este primer incremento

Implementados como módulos aislados: planificación de pausas, entrega serial con comprobación de turno vigente, interfaz abortable de indicador de escritura, variantes con questionKey estable, bloqueo de preguntas ya respondidas o ya formuladas, señales de interrupción y parser acotado de cirugía previa. Hay 28 pruebas unitarias, ejecutadas localmente con Node 22: 28 aprobadas, cero fallos.

IMPORTANTE: `server.js` NO importa todavía estos módulos. No se ha conectado el proveedor real de escritura, cambiado Render, creado índices en producción ni hecho merge/despliegue. Las pruebas usan adaptadores simulados, no Chatwoot ni Medinet reales. Este incremento NO declara resuelto el incidente 11142 ni todos los escenarios clínicos.

## Prioridad y alcance

Prioridad comercial: cirugía bariátrica en sus variantes. Modelar rutas de manga primaria, bypass en Y de Roux primario, evaluación metabólica, conversión de manga a bypass, revisión después de manga, revisión después de bypass y otras revisiones. Procedimientos menos frecuentes deben identificarse sin prometer que se ofrecen ni decidir indicación por chat; derivación clínica cuando corresponda. Soporte postoperatorio no es un nuevo embudo comercial. Balón es una ruta complementaria NO quirúrgica; no confundirlo con cirugía. Conservar otros servicios existentes sin forzarlos al cuestionario bariátrico.

## Pausas

`conversation/reply-pacing.mjs`:
- Primera respuesta: objetivo 900–2800 ms según longitud y variación acotada, descontando el tiempo real de generación. Si el sistema ya demoró, no sumar otra pausa inicial.
- Entre burbujas: 600–1100 ms.
- Máximo de espera artificial añadida: 6000 ms por respuesta, no por cada burbuja.
- Urgencias: sin demora artificial y sin esperar indicador.
- Revalidar turno e intervención humana antes y después de las esperas; cortar burbujas restantes cuando cambie el turno.
- Fallos de escritura no bloquean el texto: timeout 700 ms y señal de cancelación para el adaptador.

Pendiente: agrupador de mensajes entrantes con ventana inicial de 2 segundos desde el último fragmento y máximo absoluto de 5 segundos desde el primero; ajustar mediante pruebas. No mantener el webhook abierto para implementar esta espera. No equivale a esperar 5 segundos adicionales siempre.

## Indicador escribiendo

El indicador interno de Chatwoot y la visibilidad en WhatsApp son cosas distintas. El endpoint `toggle_typing_status` existe, pero la propagación a WhatsApp Cloud aparece pendiente en el issue #13984 y PR #14236 de Chatwoot consultados el 2026-09-09.

Verificar proveedor de la bandeja y credenciales autorizadas; integrar su API de escritura con el ID del mensaje entrante y validación visual desde un teléfono de prueba. En proveedores WhatsApp que usan mark-as-read, el indicador también marca leído; la interfaz puede mostrar puntos animados y no una frase literal. No publicar tokens. No activar sobre conversaciones de pacientes para hacer una prueba.

El módulo admite un adaptador `typing(on, {signal})`, pero no contiene credenciales ni llama a una API real. Un resultado aceptado por API no demuestra que el paciente haya visto el indicador. Limitar su uso a una respuesta realmente en preparación; no utilizarlo para disimular bloqueos.

Fuentes técnicas:
- https://developers.chatwoot.com/api-reference/conversations/toggle-typing-status
- https://github.com/chatwoot/chatwoot/issues/13984
- https://github.com/chatwoot/chatwoot/pull/14236
- https://docs.360dialog.com/docs/waba-messaging/overview

## Estructura fija, redacción variable

Secuencia lógica: entender solicitud → responder duda inmediata → recoger sólo faltantes pertinentes → presentar siguiente paso → transferir a agenda o equipo adecuado. No bloquear precios, financiación, dirección o agenda detrás de una ficha clínica completa.

Persistir `questionKey`, `proposition`, `variantId`, `sourceMessageId`, fecha del hecho, origen y estado de respuesta. Seleccionar variante estable por turno, no cambiarla en reintentos de entrega. El parser no puede depender de que el texto diga exactamente «ya tienes una manga».

`presentBariatricQuestion` devuelve:
- `skip_known` si existe respuesta; false y cero son datos válidos.
- `repair_or_wait` si la pregunta ya se formuló: resolver duda/interrupción o aclarar de manera auditada, nunca cambiar sinónimos para insistir.
- `ask` con clave estable y una variante si corresponde una pregunta nueva.

El llamador debe registrar askedKeys sólo tras envío confirmado, manejar explícitamente `repair_or_wait` y persistir respuestas. Este módulo no sustituye la memoria durable.

«Ya respondí», «Ya le contesté», «Es un robot?» y solicitudes de persona se atienden antes del cuestionario. Respuesta de identidad transparente: «Soy Antonia, la asistente virtual de Clinyco». No guardar reclamos, agradecimientos o consultas comerciales como antecedentes clínicos. Los detectores son una base acotada, no un clasificador exhaustivo de lenguaje natural.

## P0 pendiente antes de activar pausas en producción

1. Índice de historial por cuenta/conversación/fecha y consulta correspondiente. Crear índices concurrentemente fuera de una transacción de migración; medir con plan de consulta sin repetir cargas pesadas innecesarias.
2. Lectura incremental durable; no volver a escanear todo raw_events cada turno. Conservar mensajes humanos y excluir notas privadas de respuestas al paciente.
3. Ingreso idempotente durable y ACK HTTP rápido. Persistir primero; no responder 200 dejando sólo una Promise volátil. Objetivo p95 de ACK <200 ms sujeto a medición, no garantía actual.
4. Registrar latestReceivedRevision al recibir, antes del mutex; procesar todos los hechos de los fragmentos aunque se suprima una respuesta vieja. No simplemente descartar mensajes antiguos.
5. Agrupar ráfagas; verificar último turno nuevamente en el adaptador de envío y usar outbox/idempotencia. El módulo de pausas no arregla por sí mismo la cola.
6. Integrar claves semánticas, interrupciones y redacción variable. Mantener la estructura de selección sin cuestionarios obligatorios para consultas generales.
7. Validar takeover, callbacks tardíos, reinicio, dos workers, timeouts e idempotencia.

## Agenda y datos comerciales

Transferir a Melania sin reiniciar preguntas y mantener políticas del PR #215: sólo prestaciones/cupos publicados y sin reserva automática de endoscopia. Los precios, rangos, coberturas, inclusiones y financiación deben provenir de información vigente aprobada, nunca de variación creativa. Un presupuesto formal no es garantía de cobertura. Solicitar datos sólo cuando la intención lo requiera y distinguir nombre conversacional de identidad clínica.

## Validación

Ejecutar:
`node --test tests/reply-pacing.test.mjs tests/bariatric-dialogue.test.mjs`

Pruebas iniciales: límites de pausas; descuento por latencia; urgencia; takeover; mensaje nuevo; fallo/timeout del indicador; limpieza tras fallo de envío; variantes con la misma clave; manga y año ya informados; respuestas negativas/cero; precio + financiamiento en mensajes fragmentados; reclamos e identidad; dirección; agenda y derivación humana.

Pendiente: integración contra el flujo real, replay anonimizado de 11142 en staging, regresiones de preevaluación y agendas, prueba visual de escritura con número autorizado. Desplegar sólo tras revisión; no crear dos Antonias simultáneas.