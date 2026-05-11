# Clínyco.IA — Memoria de proyecto

> **Lee este archivo al iniciar cada sesión** — recoge decisiones de
> arquitectura, restricciones operativas y planes activos. Si modificas
> alguno de estos puntos, actualiza también este documento.

## Repos del ecosistema

| Repo | Función |
|---|---|
| `villagran-gif/clinyco_AI` (este repo) | Server principal Node.js, MelanIA flow, integración Medinet/Zendesk/WAHA, scoring AI |
| `villagran-gif/sell-medinet-backend` | Backend Python/Node en Render: webhook receiver Chatwoot, integración Frappe Cloud, Zendesk Sell, TikTok bridge |

Ambos comparten DB Postgres (Hetzner) y se llaman entre sí vía HTTP.

## Restricciones operativas

- **Medinet API es geo-bloqueada (Chile)**. Cualquier worker que la
  consuma debe correr en VPS chileno (`69.6.226.132`), no en Render USA.
  El sandbox de Claude Code tampoco puede llegar — testing manual de
  endpoints solo desde el VPS.
- **WhatsApp 24h window**: outbound fuera de sesión activa requiere HSM
  templates aprobados en Meta Business Manager. Aplica a confirmaciones
  iniciales y recordatorios. Una vez el paciente responde, se abre
  ventana de 24h para mensajes libres.
- **GitHub MCP scope** del sandbox: por defecto solo `clinyco_AI`. Si
  necesitas trabajar también en `sell-medinet-backend`, relanza la
  sesión con ambos repos seleccionados.
- **Push desde el sandbox falla con 403** (la integración carece de
  `contents:write`). Los commits se hacen locales; el push debe correr
  desde la Mac del usuario o el VPS.

## Sucursales Medinet

| branchId | Nombre |
|---:|---|
| 39 | Antofagasta Mall Arauco Express |
| 38 | Hospital Militar (Endoscopia/Colonoscopía) |
| 41 | Santiago |
| 2 | Telemedicina Área Médica (TELEMEDICINA) |
| 3 | Telemedicina Nutrición/Psicología (TELEMEDICINA) |

`telemedicine/lifecycle.js::TELEMEDICINE_BRANCH_IDS = [2, 3]` — usar
este filtro para identificar telemedicina (el flag `es_telemedicina` en
la API de Medinet siempre viene `false`, no es confiable).

## Endpoints Medinet clave

| Endpoint | Auth | Wrapper |
|---|---|---|
| `GET /api-public/schedule/appointment/all-appointments/{from}/{to}/?branch_id=X` | JWT | `Antonia/medinet-api.js:681` `fetchAllAppointments` |
| `GET /api-public/schedule/appointment/{id}/` | JWT | `:701` `fetchAppointmentDetail` |
| `POST /api-public/schedule/appointment/update-appointment-state/{id}/` | JWT | `:711` `updateAppointmentState(id, "Confirm"\|"Cancel")` |
| `GET /api/agenda/citas/proximos-cupos-all/{ubi}/` | None (XHR headers!) | `:642` `fetchProximosCuposAll` |
| `GET /api/agenda/citas/proximos-cupos/{ubi}/{esp}/` | None (XHR headers!) | `:653` `fetchProximosCupos` |
| `GET /api/especialidad/get_por_ubicacion/{ubi}/` | None (XHR headers!) | `:664` `fetchSpecialtiesByBranchNoAuth` |

**Headers obligatorios para endpoints "no-auth":**
```
Accept: application/json
X-Requested-With: XMLHttpRequest
Referer: https://clinyco.medinetapp.com/agendaweb/planned/
User-Agent: Mozilla/5.0
```
Sin estos, Medinet devuelve 401. El helper `noAuthFetch` en
`Antonia/medinet-api.js:273` actualmente NO los envía — pendiente fix.

## Shape real de Medinet `all-appointments`

```json
{
  "id": 414088, "fecha": "2026/05/11", "hora": "17:30",
  "duracion": 40, "tipo": "...", "especialidad_nombre": "...",
  "sucursal": { "id": 2, "nombre": "..." },
  "estado": { "id": 2, "nombre": "Confirmado" },
  "paciente": { "run", "nombres", "paterno", "materno", "telefono", "telefono_2", "email", "prevision" },
  "profesional": { "run", "nombres", "paterno", "materno" }   // NO trae id numérico
}
```

Notar: `fecha` viene con **slashes** — convertir a `YYYY-MM-DD` antes
de pasar a `Date()`. Ya manejado en `telemedicine/ingest.js::normalize()`.

## Trabajo activo

### Rama `claude/telemedicine-appointment-reminders-4SUsb`
2 commits locales sin pushear (`0a030d4`, `2706b10`):
- Módulo `telemedicine/` con ciclo de citas (booked → confirmed →
  payment_pending → payment_confirmed → session_ready).
- Migración `migrations/018-telemedicine-appointments.sql`.
- Worker `workers/telemedicine-reminder-worker.js` (ingesta dual:
  hook realtime + polling Medinet cada 5 min).
- BICE payment client en modo stub (interfaz lista, sin spec real).
- Session link firmado HMAC con `TELEMEDICINE_SESSION_SECRET`.
- WAHA client en `telemedicine/waha-client.js` (**queda obsoleto** —
  ver decisión Chatwoot abajo).

### Plan vigente — Sistema de confirmaciones (reemplaza CEROAI)
Archivo: `/root/.claude/plans/cosmic-sniffing-fairy.md`.

Decisiones:
- Bot: **MelanIA**
- Transporte: **Chatwoot Cloud** (`app.chatwoot.com`, accountId=162472)
- Clasificador: **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`)
- Trigger 1er msg: **apenas detectada la cita**
- Recordatorio: **T-76h antes**
- Sucursales: **todas**
- Reschedule: handoff HTTP → endpoint `/melania/start-from-confirmation`
  en clinyco_AI VPS chileno
- Repo destino: **`sell-medinet-backend`** (opción B)
- Pendiente: registrar 2 HSM templates en Meta Business Manager
  (`cly_confirm_appointment_v1`, `cly_confirm_reminder_76h_v1`).

## Convenciones

- Idioma código: ES (variables, comentarios, mensajes a usuarios).
- Idioma commits: ES.
- Commits sin firma de Claude Code (Stop hook revisa unpushed).
- No agregar dependencias sin pedir.
- No tocar `Antonia/medinet-antonia.*` salvo bugfix puntual — playwright
  legacy.
- Endpoints nuevos: protegerlos con Bearer token vía env var.

## Comandos útiles

```bash
# Desde el VPS chileno (con env loaded):
psql $DATABASE_URL -f migrations/018-telemedicine-appointments.sql

# Smoke test ingest (cuando ambos repos estén pusheados):
curl -H "Authorization: Bearer $TELEMEDICINE_WORKER_TOKEN" \
  -X POST http://localhost:8788/telemedicine/tick

# Helper curl para endpoints Medinet "no-auth" — usar en el VPS:
med() {
  curl -sS \
    -H "Accept: application/json" \
    -H "X-Requested-With: XMLHttpRequest" \
    -H "Referer: https://clinyco.medinetapp.com/agendaweb/planned/" \
    -H "User-Agent: Mozilla/5.0" \
    "$@"
}
```

## Próximos pasos al continuar

1. Relanzar Claude Code con scope ampliado a ambos repos.
2. Implementar plan de confirmaciones (`cosmic-sniffing-fairy.md`).
3. Pushear los 2 commits pendientes de la rama
   `claude/telemedicine-appointment-reminders-4SUsb`.
4. Crear 2 HSM templates en Meta Business Manager.
