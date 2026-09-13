# Ficha breve y mejoras de Antonia

La ficha privada conserva solo el título y los datos recopilados. Se elimina la lista redundante de campos ya informados y el pie de texto. Los datos internos que evitan repetir preguntas permanecen. Las notas históricas no se eliminan masivamente.

El historial de respuesta excluye mensajes privados. Para instalaciones con muchos eventos, ejecutar `DATABASE_SSL=true node scripts/ensure-chatwoot-history-index.mjs` en un proceso que ya tenga `DATABASE_URL` configurada. Crea el índice por conversación concurrentemente, fuera de transacciones; comprobar su validez al terminar. En esta instalación el índice quedó aplicado y la consulta revisada utilizó el índice con un tiempo de ejecución de aproximadamente 2 ms.

Las solicitudes de texto a OpenAI tienen un límite de 45 segundos y no realizan reintentos implícitos del SDK. Una cuenta sin créditos devuelve `ai_quota_exhausted` al gateway. Este cambio no repone créditos ni recupera automáticamente conversaciones antiguas.

## Acceso del equipo

En Chatwoot → Ajustes → Integraciones → Dashboard Apps, registrar:

- Nombre: `Mejorar Antonia`.
- URL: `https://clinyco-ai.netlify.app/chatwoot-antonia.html`.

La pestaña recibe el contexto oficial de Chatwoot, valida origen, ventana y cuenta, y abre `antonia-feedback.html?conversation=ID`. Solo transfiere el número de conversación. El formulario utiliza el acceso con Google y la lista autorizada existentes; no expone claves de API.

Alternativamente, `ANTONIA_FEEDBACK_REGISTER_APP=true` registra la aplicación al iniciar el core de producción, usando su token de Chatwoot existente. Solo actúa en ese servicio/cuenta y no reemplaza aplicaciones existentes. Una autorización insuficiente queda registrada sin interrumpir el servicio. La bandera se puede apagar tras verificar la instalación.

API protegida: `GET/POST /api/review/antonia/improvements` (en Netlify, `/api/antonia/improvements`). El servidor atribuye cada sugerencia al usuario autenticado y exige el origen del sitio para guardar. La clave de idempotencia evita duplicados si se repite una solicitud cuyo resultado se perdió.

## Revisión cada media hora

El proceso principal de clinyco_AI inicia el revisor. Las sugerencias se guardan inmediatamente en `antonia_improvements.suggestions`. Un registro persistente por intervalo y un bloqueo de PostgreSQL impiden repetir el mismo lote al reiniciar o tener más de una instancia.

Se revisan hasta cinco pendientes por intervalo, ordenadas por antigüedad de intento y creación. Si no hay pendientes, no se consulta al modelo. Se registra el consumo con el propósito `antonia_improvement_review`. Si faltan créditos o falla el proveedor, las sugerencias permanecen pendientes, muestran el motivo y se vuelven a considerar en el siguiente intervalo. No se envían conversaciones completas ni identidad del agente al modelo.

La evaluación indica factibilidad, propuesta y verificaciones necesarias. No ejecuta código ni cambia prompts, reglas de atención o configuración. Requiere revisión humana antes de implementar.

## Verificación

Las pruebas cubren autorización y origen, identidad del autor, persistencia e idempotencia, intervalos y exclusión mutua, recuperación tras falta de saldo, validación de resultados, conservación del formulario ante errores y renderizado como texto.

Pruebas de base de datos con una instalación temporal de PGlite, fuera de dependencias de producción:

```sh
REVIEW_TEST_PGLITE_PATH=/ruta/pglite/dist/index.js REVIEW_TEST_JSDOM_PATH=/ruta/jsdom/lib/api.js node --test tests/antonia-improvements.test.mjs
```

Los bloqueos consultivos se simulan en PGlite; la exclusión en producción usa `pg_try_advisory_lock`. Se requieren DB y proveedor operativos para verificar un análisis real.

Referencias: [Dashboard Apps de Chatwoot](https://www.chatwoot.com/hc/user-guide/articles/1677691702-how-to-use-dashboard-apps).
