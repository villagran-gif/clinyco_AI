# Directorio CRM: primera entrega

Pestaña CRM en el dashboard existente, sin Atomic ni cuentas nuevas. API pública
`GET /api/review/crm/links?month=2026-09&offset=0`, páginas de 100 contactos.
Solo devuelve tres tipos de enlaces con iniciales: contacto, conversaciones y
ficha Medinet verificada. No devuelve RUT, nombre, teléfono, mensajes ni datos
clínicos. Ninguna ruta pública modifica registros.

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
Embudos, etapas exactas de Zendesk Sell y tareas configurables siguen pendientes:
no se inventan etapas para llenar el tablero. Tampoco incorpora Google login.
La API nueva es de solo lectura y permite consultar iniciales e identificadores
de destino públicamente según la solicitud. No modifica otros endpoints antiguos
del dashboard ni afirma que los convierte en privados.

No activar consultas de datos clínicos ni servicios restringidos por costos.

## Validación

`node --test tests/crm-links.test.mjs`

Revisar la pestaña con DB vacía, con 101 contactos y con error de conexión.
Las pruebas unitarias no sustituyen validación sobre PostgreSQL y un deploy.
