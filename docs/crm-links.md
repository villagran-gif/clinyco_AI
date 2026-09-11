# Directorio CRM: primera entrega

Pestaña CRM en el dashboard existente, sin Atomic. API privada con acceso Google
y correos autorizados (ver [configuración](review-google-auth.md)):
`GET /api/review/crm/links?month=2026-09&offset=0`, páginas de 100 contactos.
Solo devuelve tres tipos de enlaces con iniciales: contacto, conversaciones y
ficha Medinet verificada. No devuelve RUT, nombre, teléfono, mensajes ni datos
clínicos. Todas las rutas Review requieren autenticación y autorización.

## Activación

1. Desplegar el backend y los archivos de `review/site` juntos; el PR no los despliega.
2. Con DATABASE_URL configurada, ejecutar `node scripts/sync-crm-links.mjs`.
   Crea tres tablas nuevas e importa los eventos ya persistidos en
   `chatwoot.raw_events`. Reejecutar es idempotente. No requiere tokens nuevos ni IA.
3. Activar `CRM_LINKS_SYNC_ENABLED=true` en el backend para proyectar mensajes
   nuevos. El webhook sigue funcionando si esta proyección falla; recuperar
   omisiones reejecutando el backfill. Vigilar `CRM_LINKS_SYNC_FAILED`.
4. Verificar el número de contactos frente a Chatwoot. Este backfill no demuestra
   cobertura completa: solo importa eventos archivados. No lee todos los chats
   desde la API de Chatwoot. No anunciar septiembre completo sin contrastarlo.

La actividad se calcula desde la fecha del mensaje en America/Santiago. Se
conservan días de actividad, por lo que actividad en octubre no elimina a un
contacto de septiembre. Las conversaciones se agrupan por ID de contacto de
Chatwoot; se muestran todos sus enlaces conocidos.

## Medinet y RUT interno

El enlace de Medinet queda vacío hasta recibir una correspondencia verificada.
El importador original de pacientes Medinet del repositorio es un placeholder.
No se generan enlaces clínicos por similitud de nombres ni por iniciales.

Para importar correspondencias verificadas, usar un archivo JSON privado (no
añadirlo al repositorio), con objetos `contactId`, `rut`, `medinetId`, `section`:

`node scripts/sync-crm-links.mjs --verified-mappings /ruta/privada/mappings.json`

El RUT se valida por módulo 11, se normaliza sin puntuación y queda en la DB.
Esta entrega no fusiona contactos diferentes por RUT. Esa vinculación controlada
de identidades es una siguiente implementación; no sustituirla por unión de nombres.

## Alcance

Esta entrega implementa el directorio de enlaces solicitado, no un CRM completo.
Las ampliaciones operativas se describen más abajo. Google login protege todo
el router Review, incluidos los endpoints anteriores del dashboard. El directorio
sigue mostrando iniciales y enlaces: no se han incorporado nombres de pacientes.

No activar consultas de datos clínicos ni servicios restringidos por costos.

## Validación

`node --test tests/crm-links.test.mjs`

Revisar la pestaña con DB vacía, con 101 contactos y con error de conexión.
Las pruebas unitarias no sustituyen validación sobre PostgreSQL y un deploy.

## Estructura recuperada de Sell

`review/site/crm-structure.json` conserva tres embudos y 23 etapas con los nombres recuperados. La pestaña CRM usa estas etapas en el tablero operativo. Bariátrica incluye Santiago, Calama y Antofagasta, y etiquetas Bariátrica simple / Conversión, según las decisiones actuales del usuario.

Fuente histórica: https://github.com/villagran-gif/sell-medinet-backend/blob/b78919b/docs/migration-chatwoot-frappe.md (sección 13). El nombre completo EXAMENES PRE-PAD ENVIADOS se contrastó con las exportaciones de Sell del repositorio.

El orden es el documentado, no las posiciones originales verificadas en la API. El catálogo no impone transiciones; Allurion y Orbera son alternativas. CERRADO AGENDADO nunca se marca como procedimiento completado. General queda excluido.

Persistir únicamente la estructura en la DB existente:

```sh
node scripts/seed-crm-structure.mjs
```

La operación es transaccional e idempotente y almacena una versión inmutable en `crm_structure_versions`. El tablero utiliza el catálogo del mismo commit y permite asignar oportunidades a etapas; no hay editor de etapas. No modifica la respuesta de `/crm/links`. No importa pacientes ni reactiva Zendesk o Frappe.

Tareas: se recuperaron título, vencimiento, responsable, realización y relación con contacto/lead/trato. Catálogo original de tipos, recordatorios y recurrencias pendiente. La gestión de tareas está implementada con tipos que las ejecutivas pueden configurar; no se inventan valores históricos.

## CRM operativo (ampliación)

La pestaña incluye tablero por embudo, filtros de sede, responsable y mes; alta manual de contactos importados en un embudo; edición de etapa, sede, etiquetas y responsable; y tareas con título operativo, responsable, tipo configurable, vencimiento, edición, finalización y reapertura. Las tareas se pueden consultar globalmente por responsable y estado (pendientes, vencidas, realizadas, todas). No se envían notificaciones ni mensajes a pacientes.

Un contacto puede tener una oportunidad por embudo. La misma persona puede estar en más de un embudo, sin fusionar RUT automáticamente. Cada cambio de oportunidad/tarea exige su versión actual: un cambio simultáneo devuelve 409 y debe revisarse, sin sobreescritura silenciosa. `crm_changes` registra valores previos/nuevos y fecha con actor `anonymous`; el responsable asignado no identifica a quien realizó el cambio.

### Contratos y activación

- `/api/review/crm/links` conserva exactamente la proyección de iniciales y enlaces.
- `/api/review/crm/workspace/*` sirve **metadatos operativos adicionales** (embudo, etapa, sede, responsable y tareas). No devuelve nombres de pacientes, RUT, teléfono, mensajes ni ficha clínica. Los títulos de tareas son texto introducido por el operador; usar solo instrucciones operativas, sin identificadores ni información clínica.
- Google Identity y la lista de correos del backend son obligatorios. El control de Origin es adicional; no sustituye la autenticación. Una cuenta autorizada puede operar el panel completo, sin roles diferenciados en esta entrega.
- Activar deliberadamente `CRM_WORKSPACE_ENABLED=true` en el backend. Por defecto las rutas operativas devuelven 503 `crm_not_enabled`; el directorio es independiente.
- La capa de autenticación permite exclusivamente el origen `https://clinyco-ai.netlify.app`. `CRM_ALLOWED_ORIGINS` no amplía esta restricción superior. Las pruebas aisladas del router CRM no acreditan autorización de localhost.
- Las tablas `crm_pipelines`, `crm_stages`, `crm_options`, `crm_opportunities`, `crm_tasks`, `crm_changes` se crean idempotentemente al primer acceso habilitado, usando el pool de DB existente. Los catálogos de responsables/tipos empiezan vacíos y se agregan desde Configuración; no se inventan tipos históricos de Sell.
- Desplegar backend y `review/site` del mismo commit; habilitar el flag, importar eventos con `node scripts/sync-crm-links.mjs`, verificar el directorio y activar `CRM_LINKS_SYNC_ENABLED=true` para nuevos eventos. El importador solo cubre eventos archivados disponibles; no garantiza todo Chatwoot.
- Reversión: deshabilitar `CRM_WORKSPACE_ENABLED`; conservar tablas y registros. No borrar datos para desactivar.

Las restricciones anteriores de “solo consulta de estructura” quedan superadas por esta ampliación. Google OAuth está implementado y requiere activación según `review-google-auth.md`. Continúan pendientes recordatorios/recurrencias automáticas y recuperación del catálogo histórico exacto de tipos de tarea.

### Validación reproducible

```sh
npm ci --ignore-scripts
node --test tests/crm-links.test.mjs tests/crm-structure.test.mjs
# Instalar PGlite en una carpeta temporal, sin dependencia de producción:
npm install --prefix /tmp/crm-validation @electric-sql/pglite
CRM_TEST_PGLITE_PATH=/tmp/crm-validation/node_modules/@electric-sql/pglite/dist/index.js node --test tests/crm-workspace.integration.test.mjs
```

La integración usa PostgreSQL WASM aislado con datos sintéticos; el adaptador omite el advisory lock multi-proceso. No acredita conectividad, permisos ni capacidad de la DB de producción. Verifica persistencia, etapas por embudo, duplicados, conflicto de versiones, tarea vencida/completada/reabierta, filtros y restricciones HTTP de origen.

Prueba de formularios (DOM simulado, sin verificación visual): instalar `jsdom` en la misma carpeta temporal y añadir `CRM_TEST_JSDOM_PATH=/tmp/crm-validation/node_modules/jsdom/lib/api.js` al comando de integración. Comprueba cargar tablero, editar etapa y guardar una tarea desde los formularios.

### Sincronización automática desde el archivo existente

`CRM_LINKS_SYNC_FROM=2026-09-01` junto con `CRM_LINKS_SYNC_ENABLED=true` activa un proceso incremental dentro del servicio actual. Proyecta campos mínimos de eventos archivados, en lotes de 100, con checkpoint persistente en `crm_sync_progress` y exclusión entre instancias. Reintenta al minuto si falla. No llama a Chatwoot ni a modelos, ni importa textos clínicos. La primera ejecución carga el archivo desde septiembre; después sigue los nuevos eventos. No reemplaza la verificación de cobertura total de Chatwoot.
