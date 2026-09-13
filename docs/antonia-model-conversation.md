# Conversación de Antonia dirigida por el modelo

Base: main 66fd7cfa9253923712d63dbf56b149157ecb42d4. Este cambio conserva la pausa humana de PR 252.

Retira del webhook el cuestionario PAD, formularios de confirmación prematuros, bucles de medidas, menú de ayuda, preguntas forzadas del resolver, cierres nocturnos del chat y menús conversacionales de MelanIA. También retira la proyección general por regex de cualquier frase sobre el contacto/deal. Los módulos históricos que sirven a otras herramientas no se eliminan del repositorio.

El prompt deriva del propósito y tono del anterior, reutiliza `buildKnowledgePromptContext()` y elimina la obligación de 18 palabras y el orden fijo de preguntas. Prioriza la solicitud actual, correcciones, negaciones, fragmentos y la diferencia entre interlocutor y paciente. Limita afirmaciones al conocimiento autorizado, exige reconocer ausencias y prohíbe presentar texto generado como comprobante de acciones.

`conversation/model-conversation.js` valida el contrato JSON y registra hechos con cita literal, sujeto, aproximación y mensaje de origen. Sólo hechos del interlocutor en un turno sobre sí mismo se proyectan a su ficha. Las medidas invalidan IMC/categoría y evaluación PAD anteriores; no se recalcula candidatura clínica. Antecedentes e interés comercial tienen campos separados. La atribución semántica depende del modelo: las validaciones no prueban por sí solas comprensión ni eliminan toda alucinación.

`conversation/model-booking.js` sustituye los menús: el modelo propone buscar, seleccionar, preparar o confirmar. El servidor usa índices de cupos reales y nunca un payload de reserva inventado. Conserva el catálogo publicado, validación de paciente existente, revalidación exacta del cupo y un solo POST. Una reserva requiere resumen efectivamente enviado, confirmación explícita posterior y datos idénticos; una corrección o diez minutos de espera invalidan esa confirmación. No hay cancelación de citas: abandonar un borrador sólo elimina la preparación local.

Las pausas, revisiones de autoridad, deduplicación de entrada y controles entre burbujas continúan activos. Una petición de atención humana deja pausa persistente; no equivale a asignar un agente. Una reserva incierta queda bloqueada y necesita conciliación humana de Medinet y del estado, igual que los envíos inciertos del control persistente. No se ofrece un reinicio automático de ese bloqueo.

## Modelo y configuración

Para el proveedor Anthropic existente, la conversación usa `claude-opus-5` con pensamiento adaptativo y esfuerzo bajo. `ANTONIA_CONVERSATION_MODEL` permite elegir explícitamente otro modelo. No modifica el modelo de las revisiones de mejoras ni el de audio. `ANTONIA_MAX_COMPLETION_TOKENS` tiene valor predeterminado 4096, compartido entre razonamiento y respuesta. Un valor de entorno anterior más bajo sigue prevaleciendo: revisarlo antes de activar.

Referencias verificadas: [modelos](https://platform.claude.com/docs/en/models/overview), [migración a Opus 5](https://platform.claude.com/docs/en/models/opus-5/migration-guide). La disponibilidad documental no confirma acceso con la clave de esta cuenta. La instrumentación conserva uso/modelo; si no hay tarifa configurada para un modelo, el costo queda nulo en vez de inventarlo.

## Validación y límites

`npm run test:antonia-conversation` prueba el handler real con dependencias simuladas, validación/proyección de hechos, contrato de proveedor, consentimiento de reserva, idempotencia y controles existentes de autoridad/catálogo. Son pruebas locales; no constituyen las 34 regresiones completas de la auditoría ni una evaluación del modelo real.

`npm run eval:antonia-conversation` ejecuta seis conversaciones sintéticas con la clave Anthropic del entorno. No conecta a DB ni envía chats ni modifica Medinet. Registra respuesta, modelo y tokens para revisión. No se ejecutó localmente porque no hay clave del proveedor en el entorno de trabajo. Antes de activar: comprobar acceso a Opus, respuestas, latencia, presupuesto de tokens y consumo. Añadir la secuencia fragmentada completa y los casos auditados al ensayo supervisado sin pacientes reales.

Las conversaciones heredadas no confirman reservas automáticamente: necesitan selección y una nueva propuesta presentada. La reserva automática sigue limitada a paciente existente e interlocutor identificado como paciente; las reservas para terceros requieren otro flujo verificado. El prompt puede orientar a la agenda web, pero no inventar haber reservado allí.

## Rollback

Revertir este PR vuelve al comportamiento anterior con los controles persistentes de PR 252. No requiere migración ni elimina columnas o registros. Antes de volver atrás, mantener en pausa las conversaciones con reservas `pending`/`uncertain` y conciliar sus resultados: la versión anterior no interpreta `booking.modelAttempt`. Cambiar sólo `ANTONIA_CONVERSATION_MODEL` revierte la elección de modelo sin restaurar los cuestionarios. No se ha desplegado este cambio.

## Context precision follow-up

Separate current `weightKg` from `preoperativeWeightKg` and `lowestWeightKg`, and
`residence` from `careDestination`. Historical weights and travel destinations stay
in evidence-backed conversational memory, without overwriting current CRM fields.
Numeric facts retain `qualifier` (exact, approximate, at_least, at_most). Uncertain
current measurements clear exact CRM projections and derived BMI; their value and
qualifier remain available in declaredFacts. A later exact measurement restores
that projection. No migration or production data repair is included.

Added state regressions for weight history, travel, uncertain weight and height,
and four opt-in provider cases for semantic extraction and answering the concern.
Local tests validate supplied model decisions; provider evaluation and manual
review are still required to demonstrate actual model interpretation.
