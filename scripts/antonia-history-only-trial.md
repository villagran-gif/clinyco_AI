# Prueba aislada de Antonia: conversación 11175

El script `antonia-history-only-trial.mjs` es independiente del servidor. No modifica
el flujo activo, la base de datos ni los mensajes de Chatwoot. Solo lee el historial
por páginas y, con `--run`, solicita una respuesta al modelo configurado.

En un entorno con las credenciales habituales de Antonia:

```sh
node scripts/antonia-history-only-trial.mjs --through=ID_DEL_MENSAJE_ENTRANTE
node scripts/antonia-history-only-trial.mjs --through=ID_DEL_MENSAJE_ENTRANTE --run
```

Requiere `CHATWOOT_API_TOKEN`; para ejecutar el modelo también `OPENAI_API_KEY` y
`OPENAI_MODEL`. No pegar credenciales en comandos ni en el repositorio. Usar el
mismo modelo y configuración que la ejecución que se compara.

Elegir el ID del mensaje entrante que cierra el turno a evaluar. El historial
posterior queda excluido del modelo, evitando que la prueba conozca el futuro.
Se mantienen mensajes consecutivos y correcciones, sin truncar a 20/80 mensajes.
Se excluyen notas privadas, actividades y fichas automáticas antiguas. Se detiene
si hay adjuntos: esta versión no los interpreta y no simula haberlos leído.

La salida contiene datos sensibles del historial: conservarla solo en el entorno
privado autorizado; no adjuntarla a PR ni logs públicos. Por defecto únicamente
prepara la entrada. `--run` la envía al proveedor habitual OpenAI; nunca a Chatwoot.

Comparar peso actual frente a mínimo posoperatorio, incorporación de correcciones,
preguntas repetidas y respuesta a la solicitud de orientación/agendamiento.
`observedNextReply` es el siguiente mensaje público observado, si existe antes de
otro mensaje entrante; no demuestra si fue generado por IA o escrito por un agente.

Esta prueba usa un prompt específico de evaluación y omite tanto el estado previo
como el cuestionario determinista. Puede demostrar que una respuesta basada en
historial funciona, pero no aísla por sí sola el efecto causal de quitar la ficha.
Para esa atribución se necesita además la entrada exacta de la llamada original.

Validación local:

```sh
node --test tests/antonia-history-only-trial.test.mjs tests/chatwoot-private-lead-note.test.mjs
```
