# Pausa humana persistente — primera entrega

Base de implementación: `a2d9929b38a53f9e4e09807a07528acf11660989`.
Caso de referencia: #11584; fixtures sintéticos, sin datos de pacientes.
Este PR no despliega servicios ni modifica datos de producción.

## Comportamiento

- Un mensaje público identificado como humano toma autoridad antes de hidratar historial o ejecutar observadores.
- Control persistente por cuenta/conversación, independiente de `state_json`. Sin temporizador de reactivación.
- Los snapshots antiguos, eventos de paciente, apertura de conversación y reinicios no conceden autoridad.
- Las notas privadas, mensajes de bot y eventos de llamadas conservan el filtrado existente.
- Las pausas humanas antiguas se adoptan conservadoramente aunque su fecha de vencimiento haya pasado.
- El cuestionario conserva su política de handoff no humano; este PR no introduce un motor de modos nuevo.

## Reactivación

La vista existente `antonia-feedback.html?conversation=ID`, accesible desde la app de Antonia en Chatwoot, incluye Tomar control y Reactivar Antonia.
Ambas acciones requieren sesión validada por la autenticación existente del equipo (`REVIEW_ALLOWED_EMAILS`), motivo, revisión esperada y una clave de idempotencia.
No se añaden roles nuevos ni se aceptan identidades suministradas por el navegador. La API usa la cuenta Chatwoot configurada en el servidor.

Rutas core: `GET/POST /api/review/antonia/conversations/:id/control`.
POST: `action=pause|resume`, `reason`, `requestId`, `expected_revision`.
Conflictos de revisión o envíos pendientes devuelven 409; no reintentar una mutación automáticamente.

Reactivar no envía mensajes de inmediato. El próximo mensaje nuevo del paciente carga historial reciente, descarta la pregunta pendiente y desactiva la interacción de reserva vieja, conservando datos recopilados y reservas externas.
La primera respuesta tras reactivar se genera con ese historial y no ejecuta reservas. Mensajes anteriores a `resumed_at` quedan como historial, sin replay.
Esta entrega recupera contexto conversacional; no implementa todavía el reducer de hechos ni toda la matriz de invalidación de datos.

## Persistencia y envíos

`db.js:initDb` agrega tres tablas e índice: `antonia_control`, `antonia_control_events`, `antonia_control_sends`.
No borra ni transforma tablas existentes. No necesita cambios en gateway, VPS o Medinet.
El primer acceso adopta el estado humano del snapshot existente. Verificar discrepancias históricas manualmente antes de un rollout amplio; no reconstruye tomas humanas que el código anterior ya haya borrado.

Cada texto, introducción de audio, adjunto de audio y POST de reserva requiere un claim bajo bloqueo de fila con la revisión vigente. No se mantiene una transacción abierta durante I/O externo.
Una toma humana invalida planes pendientes y bloquea claims nuevos. Un claim ya autorizado puede completar después; mientras no tenga resultado confirmado, la UI muestra pausa pendiente.
Los mensajes aceptados conservan su ID; aceptación no equivale a entrega/lectura. Los POST de texto/audio tienen timeout de 15 segundos y no se reintentan automáticamente.
Un timeout, caída del proceso o resultado sin comprobante mantiene la operación incierta. No se reactiva hasta reconciliarla.
Las actualizaciones de ficha privada mantienen su implementación actual y una comprobación previa; no forman parte de la garantía transaccional de envíos públicos de este PR.

## Verificación

`npm ci --ignore-scripts` y `npm run test:antonia-control`.
Pruebas SQL en PostgreSQL WASM (PGlite), de router autenticado y de funciones reales del core con dependencias externas simuladas.
Cobertura: R11, control de R16, R23–R25, R29–R30, idempotencia, revisión obsoleta, DB caída, audio y discriminación de actores.
No son replay integral de pacientes ni ejecución de R01–R34. No se contacta Medinet/Chatwoot/Identity real en las pruebas.

Pruebas DOM adicionales, siguiendo el patrón existente del repositorio:
`REVIEW_TEST_JSDOM_PATH=/ruta/a/jsdom/lib/api.js node --test tests/antonia-control-ui.test.mjs`.
Validan motivos, botones, estado incierto, fallo de lectura y conflictos sin reintento automático.

Antes de publicar: ensayo con dos conexiones/procesos sobre PostgreSQL real, migración en staging y prueba de UI con una sesión de equipo en entorno de prueba. PGlite serializa las transacciones del harness y no demuestra concurrencia real entre procesos.
Mantener desactivados envíos externos de pruebas; el esquema se debe instalar antes de habilitar este código.

## Operaciones inciertas y rollback

1. Pausar nuevos envíos y detener instancias antiguas antes de sustituir código que no respete el nuevo control.
2. Inspeccionar por cuenta/conversación los claims `pending`/`uncertain`; contrastar en el proveedor la operación concreta y el horario. Un claim sin ID no prueba fracaso.
3. No borrar el claim ni marcarlo aceptado por el mero paso del tiempo. Si no hay evidencia suficiente, mantener la pausa. Esta entrega no incluye reconciliación automática ni un botón que declare falsamente éxito.
4. Para liberar un claim huérfano se requiere procedimiento técnico con comprobante externo y registro de auditoría; no hay un bypass público para hacerlo. Definir y ensayar ese procedimiento en staging antes del rollout.
5. Conservar las tres tablas, auditoría, mensajes y reservas ante rollback. Si el SHA anterior no consulta el control, mantener sus envíos automáticos detenidos. No usar `/debug/reset` ni replay de la cola para reactivar.

El gateway puede retrasar el evento humano: el core sólo bloquea desde que lo recibe. Este PR no promete retirar un mensaje ya aceptado ni impedir una carrera anterior a la recepción del webhook.
