# Acceso de Google al panel Clinyco

Implementación sobre `https://clinyco-ai.netlify.app`, sin otro sitio ni otra DB.
El navegador utiliza `@netlify/identity` 2.0.0. El servidor Express valida cada
token contra el endpoint `/user` de Identity del sitio fijo, exige una cuenta
Google confirmada y comprueba su correo contra `REVIEW_ALLOWED_EMAILS`.
No basta con iniciar sesión en cualquier cuenta de Google.

## Configuración necesaria antes de publicar

1. En Netlify, proyecto `clinyco-ai` (ID `88d2f6e9-73f7-44cc-aa46-c741a07e1407`),
   habilitar Identity y el proveedor Google en Project configuration > Identity
   > External providers. Mantener otros proveedores deshabilitados. Si el panel
   requiere credenciales OAuth propias, configurar el cliente web en Google
   Cloud con la URL de callback exacta indicada por Netlify. Guardar el secreto
   exclusivamente en la configuración del proveedor, nunca en este repositorio.
2. Registrar/invitar únicamente las cuentas aprobadas por el administrador.
   Configurar registro por invitación y completar la vinculación Google según
   lo que permita el panel. Verificar que `/user` devuelve `app_metadata.provider`
   igual a `google`; una invitación aceptada solo con contraseña no autoriza el
   acceso al panel. Comprobar este flujo real antes de habilitar al equipo.
3. En el servicio Render que ejecuta `clinyco_AI`, configurar
   `REVIEW_ALLOWED_EMAILS` como correos completos separados por comas. La lista
   no se publica en Netlify ni en el navegador. Vacía = acceso bloqueado (503).
   No se han elegido correos reales ni se ha concedido acceso en este cambio.
4. Desplegar backend y `review/site` del mismo commit coordinadamente. El
   servidor protege `/api/review` completo y el sitio espera `/api/auth/me`.
   La publicación unilateral puede impedir temporalmente el uso del panel.
5. Verificar en producción con una cuenta aprobada y otra no aprobada:
   login Google, callback, carga del CRM, escritura operativa, informes en
   iframe y ventana nueva, cierre de sesión, acceso directo al backend sin
   cookie (401), revocación de cuenta y token vencido.

No publicar el backend sin configurar y probar Identity/allowlist: el diseño
falla cerrado y bloquearía el panel existente. No hay modo anónimo de respaldo.
El trabajo de código y las pruebas aisladas no acreditan un login real de Google.

## Compilación y pruebas

El bundle está versionado para respetar el despliegue estático actual, que sirve
`review/site` sin build. No se cargan librerías de autenticación desde un CDN.
El lockfile permite reproducirlo sin instalar las dependencias del backend:

```sh
npm ci --prefix review/auth-client --ignore-scripts
npm run build --prefix review/auth-client
node --test tests/review-auth.test.mjs
# Pruebas de interfaz con Identity simulado:
npm install --prefix /tmp/clinyco-auth-tests --ignore-scripts jsdom
REVIEW_TEST_JSDOM_PATH=/tmp/clinyco-auth-tests/node_modules/jsdom/lib/api.js node --test tests/review-auth-browser.test.mjs
```

El token `nf_jwt` administrado por el SDK viaja como cookie en las peticiones
del mismo sitio, incluyendo iframes. El proxy existente lo reenvía a Express.
El backend no usa el SDK como verificador fuera del runtime de Netlify: llama
al servicio de Identity, que valida firma, vencimiento y cuenta. No decodifica
JWTs para decidir permisos. No reenvía refresh tokens al servicio Identity.
Las respuestas privadas llevan `private, no-store`; tampoco se deben cachear
en el CDN. Las escrituras requieren Origin exacto; se eliminó el CORS antiguo
que aceptaba cualquier subdominio Netlify. Las vistas se ocultan hasta que el
servidor confirma acceso y se vacían al detectar pérdida de autorización.

## Alcance y operación

- Se protege todo el panel Review, CRM, informes, endpoints de escritura y
  acceso directo en Render. No se cambian los webhooks de Antonia fuera de
  `/api/review`.
- Los enlaces de acciones de cola dentro de `/api/review` también exigen sesión.
  Un enlace externo abierto directamente en Render no tiene la cookie del sitio
  Netlify: operar desde el panel autenticado. No se exceptúan rutas por token
  en una URL ni se reconstruyen los enlaces antiguos en esta entrega.
- Una cuenta permitida tiene los permisos operativos del panel actual. No se
  introduce una separación administrador/ejecutiva ni permisos por pestaña.
- El historial existente `crm_changes` conserva actor `anonymous`; este cambio
  añade identidad validada a la petición, pero todavía no migra la auditoría.
- La proyección CRM sigue mostrando iniciales. La autenticación prepara el
  acceso privado; no importa nombres ni amplía los datos devueltos.
- Quitar un correo de `REVIEW_ALLOWED_EMAILS` y aplicar la configuración del
  servicio revoca su acceso en la siguiente petición. No hay caché de permisos.
  En una pestaña abierta, se revalida al recuperar foco y cada minuto visible.
- La autenticación local requiere un entorno de Identity real y un proxy del
  mismo origen. No se autoriza localhost ni previews automáticamente.

Reversión segura: corregir configuración o dejar el panel cerrado. Restaurar el
backend anónimo anterior volvería a exponer sus endpoints; no hacerlo como
solución automática a un error de login.
