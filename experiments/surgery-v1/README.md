# Antonia: cirugía bariátrica — prioridad comercial 1

Fecha: 2026-09-09. Base revisada: `89909b5c6be4efc0b4f5cf7f2aca0ca63f255d98`.
Rama de trabajo: `feat/antonia-cirugia-bariatrica`.

## Ajustes solicitados el 9 de septiembre

Pausas de 2,5–5 segundos, con variación acotada según longitud. Eliminar la presentación y el discurso de disculpa al detectar repeticiones. Dejar «escribiendo» para después. Recordatorio persistente: https://github.com/villagran-gif/clinyco_AI/issues/216 (sin fecha ni alarma programada).

## Estado real

Prototipo aislado, no importado por `server.js` y no desplegado. No modifica la atención actual ni hace solicitudes reales en sus pruebas. `delivery.mjs` exige `enabled=true` y `foundationReady=true`; por defecto no envía. El indicador de escritura está aplazado: no se invoca el callback y el adaptador es una función inactiva, sin HTTP, incluso con opciones antiguas de activación. La migración SQL está preparada, NO ejecutada. No están implementados todavía el trabajador durable, el agrupador de turnos ni la memoria incremental.

Validación local: `node --test experiments/surgery-v1/prototype.test.mjs` — 25 pruebas aprobadas en Node 22.16.0; sólo este prototipo, no toda la aplicación ni el WhatsApp real.

## Objetivo

Priorizar conversaciones quirúrgicas útiles que progresen hacia una evaluación informada y, cuando corresponda clínicamente y el paciente lo decida, a cirugía. Mejorar conversión sin presión, sin falsas garantías y sin convertir cada consulta en un interrogatorio. Agendas es la segunda línea de desarrollo, no un motivo para distraer esta prioridad. «Escribiendo» tampoco es requisito para entregar estas mejoras.

## Cobertura y límites

Manga gástrica, bypass Roux-en-Y, conversión manga a bypass, revisional después de manga, revisional después de bypass y otras técnicas bariátricas. Consultas sobre OAGB, SADI-S, switch duodenal, reversiones u otras técnicas se reconocen como categorías por desarrollar y se validan con el equipo; reconocer un término NO acredita que Clinyco lo ofrezca ni que esté indicado. Balón es una ruta endoscópica/no quirúrgica adyacente: no llamarlo cirugía. No aplicar esta política a consultas generales, urgencias o agendas puras. La detección clínica y el traspaso humano tienen prioridad sobre objetivos comerciales.

## Estructura estable, redacción variable

Responder la duda → aprovechar el contexto conocido → orientación aprobada relevante → resolver objeción → un siguiente paso.

No son cinco mensajes obligatorios. Se omiten pasos satisfechos. Máximo una pregunta útil por turno y normalmente 1–3 burbujas. No repetir como eco lo que acaba de decir el paciente. No abrir siempre con «Perfecto» ni fragmentar «ya» como una burbuja sin información. La variante se fija por conversación y `questionKey`; un reintento no cambia la redacción para esquivar el antirepetidor. Cambiar palabras no permite volver a pedir el mismo dato.

Antes de preguntar, leer hechos confirmados y el registro de preguntas. Una pregunta ya hecha, pendiente, diferida o rechazada no vuelve a emitirse automáticamente. Registrar la pregunta únicamente después de un envío confirmado. `Gracias` no reinicia el cuestionario. `Ya respondí` solicita reconciliación INTERNA sin burbuja de presentación, disculpa prefabricada ni anuncio de que se revisará luego. El integrador debe recuperar el dato y continuar con una respuesta útil; no dejar a la persona sin respuesta ni guardar la queja como motivo clínico. La recuperación efectiva aún requiere integración.

No insertar explicaciones de identidad en consultas normales o reclamos de repetición. Sólo ante una pregunta explícita de identidad, responder breve y verazmente: «Soy una asistente de IA», sin agregar el discurso rechazado.

## Persuasión por intención

- Precio/financiamiento: responder ambos primero. Usar valores y condiciones sólo desde una fuente comercial revisada y vigente. Cuando falten, explicar lo pendiente y facilitar su revisión, sin inventar precios, cuotas, descuentos ni cobertura. No bloquear esta respuesta con 12 preguntas médicas.
- Miedo o dudas: ayudar a formular la preocupación y facilitar evaluación con el cirujano. No minimizar riesgos ni asegurar resultados. No promover una técnica como superior para esa persona antes de la evaluación.
- Revisional: reconocer intervención previa y objetivo, pero no asumir que toda revisional es una manga o que todos tienen reflujo. Usar los datos ya aportados aunque lleguen en varios mensajes.
- Preparado para avanzar: ofrecer coordinar evaluación. Si el paciente acepta o pide hora, transferir los datos a agenda, sin completar preguntas comerciales innecesarias.
- Petición de humano o de detener contacto: respetarla; no seguir intentando cerrar. Una derivación solicitada no se comunica como completada hasta confirmación del backend.

El prototipo recibe `known` y `approved` del servidor confiable, nunca desde JSON enviado por el paciente. La aprobación comercial exige `approved=true`, texto revisado y `validUntil` futuro. Los importes, condiciones y hechos médicos no se aleatorizan. Las infografías futuras se usan contextualizadas, máximo una por vez.

## Ritmo actualizado

Primera burbuja e intermedias: objetivo entre 2.500 y 5.000 ms. El objetivo depende de longitud y una variación aleatoria acotada; no se envían todas con una cadencia idéntica. En la primera se descuenta el tiempo ya consumido preparando la respuesta. En las siguientes se aplica el intervalo entre burbujas. Presupuesto total de pausas añadidas: 15.000 ms para permitir hasta tres burbujas normales; no se agrega ese tiempo siempre. Si el procesamiento inicial ya tomó 5 segundos o el turno es urgente, no se añade ninguna pausa artificial. Son parámetros solicitados para probar, no una garantía de mayor conversión.

Cada envío comprueba `isCurrent()` antes y después de la pausa: el integrador debe comprobar generación del turno, mensajes nuevos y toma humana. Un evento nuevo debe invalidar el turno ANTES del mutex. El módulo no llama a `setTyping`, aunque un llamador antiguo lo entregue. El export `createChatwootTypingAdapter` se conserva por compatibilidad y sólo devuelve `typing_deferred_issue_216`.

## Recordatorio «escribiendo» — fuera de esta entrega

Seguimiento: issue #216. Pendiente de retomar después de la base técnica y el flujo quirúrgico prioritario, sin activar sobre pacientes. En esa tarea futura habrá que validar soporte del proveedor, visibilidad en un teléfono autorizado, cancelación y límites de tiempo. Una futura aceptación HTTP no será prueba suficiente de visibilidad. No usar escritura para disimular retrasos.

Referencias conservadas de la investigación anterior; no se revalidan ni integran en este ajuste:
- https://developers.chatwoot.com/api-reference/conversations/toggle-typing-status
- https://github.com/chatwoot/chatwoot/issues/13984
- https://github.com/chatwoot/chatwoot/pull/14236
- https://docs.360dialog.com/docs/messaging/overview/typing-indicators

## Requisito técnico antes de activar: P0 de latencia y repeticiones

1. Aplicar y verificar el índice preparado en `ops/sql/20260909_chatwoot_history_index.sql`, bajo revisión operacional. No ejecutarlo en arranque ni dentro de una transacción. No repetir consultas pesadas de diagnóstico en una DB saturada.
2. Ingreso durable: validar cuenta/firmas, deduplicar por cuenta+inbox+message_id, persistir evento y trabajo de cola, actualizar último mensaje recibido y responder HTTP 200. Sólo ACK después de escritura durable. No usar `setTimeout` en memoria como sustituto de una cola recuperable.
3. Agrupar ráfagas; todo fragmento se conserva y se suprimen respuestas obsoletas, NO datos entrantes. El agrupador todavía no está implementado: sus tiempos no deben confundirse con las pausas de salida de 2,5–5 segundos de este ajuste.
4. Memoria normalizada/incremental con cursores, tratamiento de eventos tardíos, deduplicación y aislamiento por cuenta. No confiar únicamente en `id > cursor` sin resolver orden de commit y entregas tardías. Guardar timestamp del proveedor separado del de recepción y persistencia.
5. Estado por `questionKey`, validadores por campo y prioridad de preguntas directas. Un `sí` se asocia a la pregunta realmente enviada; no inferir por el texto de un anuncio. No interpretar quejas como antecedentes clínicos. Conectar la reconciliación silenciosa con continuación efectiva.
6. Trabajador recuperable, idempotencia de salida, registro de IDs entregados y reconciliación en timeout ambiguo. La generación del turno debe detener respuestas desactualizadas. La propiedad/cancelación del indicador se retoma en #216.
7. Instrumentar `ingressMs`, `queueWaitMs`, `historyQueryMs`, `modelMs`, `deliveryMs`, `duplicateQuestionBlocked` y `staleReplyCancelled`; sin texto clínico ni identificadores personales en logs nuevos.

No cambiar `main`, no fusionar automáticamente, no modificar planes de Render, no ejecutar SQL ni usar pacientes reales para probar sin revisión.

## Pruebas de aceptación previas a integración

El caso sintético inspirado en 11142 debe agrupar precio+financiamiento; capturar manga y año desde mensajes fragmentados; resolver «ya respondí» sin discursos; no repetir datos; respetar toma humana; recuperar tras reinicio. Las 25 pruebas actuales cubren política/entrega local, rango de pausas, variación, cancelación y ausencia de llamadas de escritura. No prueban todavía cola, extracción completa ni persistencia. Incluir pruebas de integración de estas capas antes de producción.

## Métricas comerciales por desarrollar

Consulta resuelta, aceptación de evaluación, evaluación agendada, asistencia, evaluación quirúrgica y cirugía realizada como etapas distintas. No contar programación como cirugía realizada. Medir abandono, repeticiones y solicitudes de humano como contrapesos. Variantes A/B por conversación, sin cambiar información clínica, elegibilidad, riesgos, precios ni coberturas. No prometer aumento de conversión antes de medirlo.
