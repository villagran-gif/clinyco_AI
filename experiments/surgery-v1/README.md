# Antonia: cirugía bariátrica — prioridad comercial 1

Fecha: 2026-09-09. Base revisada: `89909b5c6be4efc0b4f5cf7f2aca0ca63f255d98`.
Rama de trabajo: `feat/antonia-cirugia-bariatrica`.

## Estado real

Prototipo aislado, no importado por `server.js` y no desplegado. No modifica la atención actual ni hace solicitudes reales en sus pruebas. `delivery.mjs` exige `enabled=true` y `foundationReady=true`; por defecto no envía. El adaptador de escritura está en simulación y exige verificación visual del canal. La migración SQL está preparada, NO ejecutada. No están implementados todavía el trabajador durable, el agrupador de turnos ni la memoria incremental.

Validación local: `node --test experiments/surgery-v1/prototype.test.mjs` — 19 pruebas aprobadas en Node 22.16.0; sólo este prototipo, no toda la aplicación ni el WhatsApp real.

## Objetivo

Priorizar conversaciones quirúrgicas útiles que progresen hacia una evaluación informada y, cuando corresponda clínicamente y el paciente lo decida, a cirugía. Mejorar conversión sin presión, sin falsas garantías y sin convertir cada consulta en un interrogatorio. Agendas es la segunda línea de desarrollo, no un motivo para distraer esta prioridad.

## Cobertura y límites

Manga gástrica, bypass Roux-en-Y, conversión manga a bypass, revisional después de manga, revisional después de bypass y otras técnicas bariátricas. Consultas sobre OAGB, SADI-S, switch duodenal, reversiones u otras técnicas se reconocen como categorías por desarrollar y se validan con el equipo; reconocer un término NO acredita que Clinyco lo ofrezca ni que esté indicado. Balón es una ruta endoscópica/no quirúrgica adyacente: no llamarlo cirugía. No aplicar esta política a consultas generales, urgencias o agendas puras. La detección clínica y el traspaso humano tienen prioridad sobre objetivos comerciales.

## Estructura estable, redacción variable

Responder la duda → aprovechar el contexto conocido → orientación aprobada relevante → resolver objeción → un siguiente paso.

No son cinco mensajes obligatorios. Se omiten pasos satisfechos. Máximo una pregunta útil por turno y normalmente 1–3 burbujas. No repetir como eco lo que acaba de decir el paciente. No abrir siempre con «Perfecto» ni fragmentar «ya» como una burbuja sin información. La variante se fija por conversación y `questionKey`; un reintento no cambia la redacción para esquivar el antirepetidor. Cambiar palabras no permite volver a pedir el mismo dato.

Antes de preguntar, leer hechos confirmados y el registro de preguntas. Una pregunta ya hecha, pendiente, diferida o rechazada no vuelve a emitirse automáticamente. Registrar la pregunta únicamente después de un envío confirmado. `Gracias` no reinicia el cuestionario. `Ya respondí` requiere reconciliar historial, no guardar la queja como motivo clínico. Si preguntan si es un robot, declarar que es asistente virtual.

## Persuasión por intención

- Precio/financiamiento: responder ambos primero. Usar valores y condiciones sólo desde una fuente comercial revisada y vigente. Cuando falten, explicar lo pendiente y facilitar su revisión, sin inventar precios, cuotas, descuentos ni cobertura. No bloquear esta respuesta con 12 preguntas médicas.
- Miedo o dudas: ayudar a formular la preocupación y facilitar evaluación con el cirujano. No minimizar riesgos ni asegurar resultados. No promover una técnica como superior para esa persona antes de la evaluación.
- Revisional: reconocer intervención previa y objetivo, pero no asumir que toda revisional es una manga o que todos tienen reflujo. Usar los datos ya aportados aunque lleguen en varios mensajes.
- Preparado para avanzar: ofrecer coordinar evaluación. Si el paciente acepta o pide hora, transferir los datos a agenda, sin completar preguntas comerciales innecesarias.
- Petición de humano o de detener contacto: respetarla; no seguir intentando cerrar. Una derivación solicitada no se comunica como completada hasta confirmación del backend.

El prototipo recibe `known` y `approved` del servidor confiable, nunca desde JSON enviado por el paciente. La aprobación comercial exige `approved=true`, texto revisado y `validUntil` futuro. Los importes, condiciones y hechos médicos no se aleatorizan. Las infografías futuras se usan contextualizadas, máximo una por vez.

## Ritmo y «escribiendo»

Pausas del prototipo: primera burbuja desde 700 ms; intermedias desde 600 ms; máximo 1.600 ms por pausa, presupuesto total de pausas 4.000 ms. Si el procesamiento ya tomó 3 segundos o el turno es urgente, no añade espera artificial. Estos valores son configuración inicial a medir, no evidencia de mejora comercial.

Cada envío comprueba `isCurrent()` antes y después de la pausa: el integrador debe comprobar generación del turno, mensajes nuevos y toma humana. Un evento nuevo debe invalidar el turno ANTES del mutex. El indicador se apaga en `finally`, incluidos errores. El adaptador Chatwoot tiene timeout de 800 ms y no imprime credenciales. Una respuesta HTTP 200 prueba aceptación de la llamada, no visibilidad en WhatsApp.

Pendiente: medir el indicador en un teléfono de pruebas autorizado. Chatwoot puede mostrar escritura internamente sin transmitirla al destinatario WhatsApp; no activar por asumir equivalencia. Si el inbox no propaga el evento, implementar un adaptador Meta/Cloud API compatible, usando `wamid` real, configuración del inbox y credenciales del servidor, sin alterar el transporte de mensajes de Chatwoot. El indicador de WhatsApp está asociado al marcado como leído y puede expirar antes de completar una operación larga; no mantenerlo engañosamente durante retrasos.

Fuentes de implementación revisadas el 2026-09-09:
- https://developers.chatwoot.com/api-reference/conversations/toggle-typing-status
- https://github.com/chatwoot/chatwoot/issues/13984
- https://github.com/chatwoot/chatwoot/pull/14236
- https://docs.360dialog.com/docs/messaging/overview/typing-indicators

## Requisito técnico antes de activar: P0 de latencia y repeticiones

1. Aplicar y verificar el índice preparado en `ops/sql/20260909_chatwoot_history_index.sql`, bajo revisión operacional. No ejecutarlo en arranque ni dentro de una transacción. No repetir consultas pesadas de diagnóstico en una DB saturada.
2. Ingreso durable: validar cuenta/firmas, deduplicar por cuenta+inbox+message_id, persistir evento y trabajo de cola, actualizar último mensaje recibido y responder HTTP 200. Sólo ACK después de escritura durable. No usar `setTimeout` en memoria como sustituto de una cola recuperable.
3. Agrupar ráfagas con ventana móvil inicial de 2 segundos y espera máxima de 6 segundos. Todo fragmento se conserva; se suprimen respuestas obsoletas, NO datos entrantes. Estos rangos son propuestas, el agregador todavía no está implementado.
4. Memoria normalizada/incremental con cursores, tratamiento de eventos tardíos, deduplicación y aislamiento por cuenta. No confiar únicamente en `id > cursor` sin resolver orden de commit y entregas tardías. Guardar timestamp del proveedor separado del de recepción y persistencia.
5. Estado por `questionKey`, validadores por campo y prioridad de preguntas directas. Un `sí` se asocia a la pregunta realmente enviada; no inferir por el texto de un anuncio. No interpretar quejas como antecedentes clínicos.
6. Trabajador recuperable, idempotencia de salida, registro de IDs entregados y reconciliación en timeout ambiguo. Generación del turno y propiedad del indicador evitan que un turno obsoleto apague la escritura de uno nuevo.
7. Instrumentar `ingressMs`, `queueWaitMs`, `historyQueryMs`, `modelMs`, `deliveryMs`, `duplicateQuestionBlocked` y `staleReplyCancelled`; sin texto clínico ni identificadores personales en logs nuevos.

No cambiar `main`, no fusionar automáticamente, no modificar planes de Render, no ejecutar SQL ni usar pacientes reales para probar sin revisión.

## Pruebas de aceptación previas a integración

El caso sintético inspirado en 11142 debe agrupar precio+financiamiento; capturar manga y año desde mensajes fragmentados; contestar «ya respondí» y «es un robot» adecuadamente; no repetir datos; respetar toma humana; recuperar tras reinicio. Las 19 pruebas actuales cubren política/entrega local, no prueban todavía cola, extracción completa ni persistencia. Incluir pruebas de integración de estas capas antes de producción.

## Métricas comerciales por desarrollar

Consulta resuelta, aceptación de evaluación, evaluación agendada, asistencia, evaluación quirúrgica y cirugía realizada como etapas distintas. No contar programación como cirugía realizada. Medir abandono, repeticiones y solicitudes de humano como contrapesos. Variantes A/B por conversación, sin cambiar información clínica, elegibilidad, riesgos, precios ni coberturas. No prometer aumento de conversión antes de medirlo.
