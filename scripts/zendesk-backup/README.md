# Zendesk Support — Backup completo previo a eliminación

Esta carpeta contiene una utilidad **aislada** (no toca el código principal del repo `clinyco_ai`) para descargar el **100% de la cuenta de Zendesk Support** antes de proceder con la eliminación de la suscripción.

> ⚠️ **Una vez que cancelas Zendesk Support, los datos quedan disponibles solo durante un periodo limitado (típicamente ~30 días en estado "cancelled"). Después se borran y NO son recuperables.** Haz el backup ANTES de cancelar, valida que esté completo, y recién entonces procede con la eliminación.

---

## Estrategia recomendada (combina los 2 métodos)

Para llegar al **100% real** de la cuenta hay que combinar dos caminos, porque ninguno por separado cubre todo:

| Método | Qué cubre | Qué NO cubre |
|---|---|---|
| **A. Export nativo de Zendesk** (Admin Center) | Tickets, usuarios y organizaciones en CSV/JSON/XML, masivo, oficial | Adjuntos, comentarios privados, configuración (macros, triggers, etc.), Help Center |
| **B. Script API (`backup.js` de esta carpeta)** | Tickets + **todos los comentarios** + **adjuntos descargados a disco** + usuarios + organizaciones + **configuración completa** (macros, triggers, automations, views, SLAs, groups, custom fields, brands, schedules, ticket forms, custom roles, organization fields, user fields, tags) | Help Center / Guide (no solicitado) |

Correr **ambos** y archivar los dos resultados es la única forma segura.

---

## A. Export nativo de Zendesk (hacerlo PRIMERO)

1. Inicia sesión en Zendesk como **Owner** (no basta admin).
2. Ve a **Admin Center → Account → Tools → Reports → Export**.
   - URL directa: `https://{subdomain}.zendesk.com/admin/account/tools/reports`
3. Elige el formato:
   - **JSON** → recomendado, conserva más estructura.
   - **CSV** → útil para abrir en Excel/Sheets.
   - **XML** → solo si lo pide algún sistema legado.
4. Selecciona qué exportar:
   - ✅ Tickets
   - ✅ Users
   - ✅ Organizations
5. Click en **Request file**.
6. Zendesk procesa el export en background y envía un **email al Owner** con un link de descarga (válido típicamente 3 días). Descarga el `.zip` y guárdalo en un lugar seguro (ej. Google Drive corporativo + disco local).
7. Repite el paso 3–6 para cada formato que quieras conservar.

> El export nativo **no incluye adjuntos ni configuración**. Por eso necesitas también el método B.

---

## B. Script API (esta carpeta)

Descarga vía REST API de Zendesk:

- **Tickets** (incremental, sin límite de 1000): cada ticket completo + sus comentarios (públicos y privados) + audits + tags.
- **Adjuntos**: descargados al disco como archivos reales (no solo URLs), organizados por ticket.
- **Usuarios y organizaciones**: completos, con campos personalizados y identidades (emails secundarios, etc.).
- **Configuración Support**: macros, triggers, automations, views, SLA policies, groups, custom roles, ticket fields, ticket forms, organization fields, user fields, brands, schedules, business hours, tags, dynamic content, targets, webhooks, apps instalados.

### Requisitos

- Node.js 18+ (usa `fetch` nativo, sin dependencias externas).
- Un **API token** de Zendesk con permisos de **Admin/Owner** (Admin Center → Apps and integrations → APIs → Zendesk API → Settings → Token access).
- Espacio en disco suficiente (los adjuntos pueden pesar varios GB; revisa el tamaño aproximado en el Admin Center antes).

### Setup

```bash
cd scripts/zendesk-backup
cp .env.example .env
# Edita .env con tus credenciales
```

Variables requeridas en `.env` (este archivo es local de la carpeta y va al `.gitignore` local):

```
ZENDESK_SUBDOMAIN=miempresa            # solo el subdominio, sin .zendesk.com
ZENDESK_EMAIL=owner@miempresa.com
ZENDESK_API_TOKEN=xxxxxxxxxxxxxxxxxxxx
ZENDESK_BACKUP_DIR=./backup-output     # opcional, default: ./backup-output
ZENDESK_DOWNLOAD_ATTACHMENTS=true      # opcional, default: true
ZENDESK_INCREMENTAL_START_TIME=0       # epoch unix; 0 = todo desde el inicio
```

### Ejecución

```bash
node backup.js                 # corre TODO
node backup.js tickets         # solo tickets + comentarios + adjuntos
node backup.js users           # solo usuarios + orgs
node backup.js config          # solo configuración (macros, triggers, etc.)
```

### Estructura del output

```
backup-output/
├── _meta.json                 # info del run (fecha, subdomain, contadores)
├── tickets/
│   ├── tickets.jsonl          # 1 ticket por línea (formato JSON Lines, fácil de procesar)
│   ├── comments/
│   │   └── ticket-{id}.json   # comentarios completos por ticket
│   └── attachments/
│       └── ticket-{id}/
│           └── {attachment_id}-{filename}
├── users/
│   ├── users.jsonl
│   └── identities/
│       └── user-{id}.json
├── organizations/
│   └── organizations.jsonl
└── config/
    ├── macros.json
    ├── triggers.json
    ├── automations.json
    ├── views.json
    ├── sla_policies.json
    ├── groups.json
    ├── custom_roles.json
    ├── ticket_fields.json
    ├── ticket_forms.json
    ├── organization_fields.json
    ├── user_fields.json
    ├── brands.json
    ├── schedules.json
    ├── tags.json
    ├── dynamic_content.json
    ├── targets.json
    ├── webhooks.json
    └── apps_installations.json
```

### Reanudar si se interrumpe

El script guarda el cursor del export incremental en `backup-output/_state.json`. Si lo cortas con Ctrl+C, al volver a correr retoma desde el último cursor guardado (no re-descarga todo).

### Validación post-backup

Antes de cancelar Zendesk, verifica:

1. Cuenta los tickets en `_meta.json` y compáralos con el contador de tickets totales en Zendesk (Views → All tickets).
2. Abre 5-10 tickets al azar de `tickets.jsonl` y revisa que tengan `comments` y `attachments` esperados.
3. Confirma que los adjuntos en disco abren correctamente (no son archivos de 0 bytes).
4. Revisa que `config/*.json` tenga contenido (no arrays vacíos a menos que efectivamente no uses esa feature).

---

## Procedimiento sugerido completo

```
[ ]  1. Notificar al equipo y congelar cambios en Zendesk (no más tickets nuevos / cambios de config).
[ ]  2. Hacer Export nativo (método A) en formato JSON. Esperar el email y descargar el .zip.
[ ]  3. Correr `node backup.js` (método B). Validar el output.
[ ]  4. Subir AMBOS backups (zip nativo + carpeta backup-output comprimida) a almacenamiento seguro
        (Google Drive corporativo + disco externo / S3 con versionado).
[ ]  5. Hacer un último export incremental el día de la cancelación para capturar tickets de las últimas horas.
[ ]  6. Cancelar la suscripción en Admin Center → Account → Billing → Subscription → Cancel.
[ ]  7. Conservar acceso al email del Owner durante mínimo 60 días post-cancelación por si necesitas
        re-descargar algo del periodo de retención.
```

---

## Notas importantes

- **Permisos**: el API token debe ser de un usuario **Owner**. Algunos endpoints (ej. `audit_logs`, `account_settings`) solo responden a Owner.
- **Rate limits**: Zendesk limita a ~700 req/min en planes Suite. El script respeta el header `Retry-After` y hace backoff automático.
- **Tickets eliminados**: el endpoint incremental NO devuelve tickets ya borrados (deleted). Si necesitas recuperar tickets soft-deleted, restáuralos desde la papelera ANTES de correr el backup.
- **Voice / Talk**: si usas Zendesk Talk, las grabaciones de llamadas requieren un export aparte desde Admin Center → Channels → Talk → Settings → Export. No se cubre acá.
- **Help Center / Guide**: no incluido a petición. Si lo necesitas, agregar después con el endpoint `/api/v2/help_center/articles.json`.

---

## Troubleshooting

| Error | Causa probable | Solución |
|---|---|---|
| `401 Unauthorized` | Token mal copiado o usuario sin permisos | Regenerar token, confirmar que el usuario es Owner |
| `429 Too Many Requests` | Rate limit excedido | El script ya hace backoff; si persiste, esperar 1 minuto |
| `403 Forbidden` en `/audit_logs.json` | El plan no incluye audit logs | Esperable en planes Team/Growth; el script lo loguea y continúa |
| Faltan tickets vs. UI | Hay tickets soft-deleted | Restaurarlos desde papelera y re-correr |
