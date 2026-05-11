# Checklist — Eliminar Zendesk Support con seguridad

Marca cada paso. **No avances al siguiente bloque sin completar el anterior.**

## Bloque 1 — Preparación

- [ ] Identificar al **Owner** de la cuenta de Zendesk (único que puede cancelar y exportar todo).
- [ ] Revisar plan actual y fecha de renovación en `Admin Center → Account → Billing`.
- [ ] Comunicar a equipo de soporte: a partir de qué día NO se crean tickets nuevos en Zendesk.
- [ ] Decidir el **destino post-Zendesk** (otra plataforma, sin reemplazo, etc.) y si requiere migración.
- [ ] Reservar espacio en disco/cloud para el backup (estimar tamaño de adjuntos en `Admin Center → Reports`).

## Bloque 2 — Backup nativo (oficial Zendesk)

- [ ] `Admin Center → Account → Tools → Reports → Export` → JSON → Tickets, Users, Organizations.
- [ ] Esperar email del Owner con link de descarga (válido ~3 días).
- [ ] Descargar el `.zip` y subirlo a Google Drive corporativo + copia local.
- [ ] Repetir export en formato CSV (más fácil de abrir en Sheets/Excel).

## Bloque 3 — Backup vía API (esta carpeta)

- [ ] Generar API token: `Admin Center → Apps and integrations → APIs → Zendesk API → Settings → Add token`.
- [ ] `cd scripts/zendesk-backup && cp .env.example .env` y completar credenciales.
- [ ] Test rápido: `node backup.js config` (debe terminar en pocos minutos).
- [ ] Validar que `backup-output/config/*.json` tiene contenido coherente.
- [ ] `node backup.js users` — esperar.
- [ ] `node backup.js tickets` — puede tardar horas si hay muchos tickets/adjuntos.
- [ ] Revisar `backup-output/_meta.json` y comparar contadores con la UI de Zendesk.
- [ ] Comprimir y subir `backup-output/` a almacenamiento seguro (S3 con versionado / Drive).

## Bloque 4 — Validación

- [ ] Total de tickets en `_meta.json` ≈ total en Zendesk UI (Views → All tickets).
- [ ] Abrir 10 tickets random de `tickets.jsonl` y verificar que tienen comentarios y adjuntos esperados.
- [ ] Abrir 5 archivos adjuntos del disco y confirmar que NO son de 0 bytes y se abren bien.
- [ ] `config/macros.json`, `triggers.json`, `views.json`, `automations.json` no están vacíos (a menos que efectivamente no los uses).

## Bloque 5 — Backup incremental el día de la cancelación

- [ ] El día previo a cancelar, correr `node backup.js tickets` de nuevo (es incremental, solo trae lo nuevo).
- [ ] Subir el delta al almacenamiento seguro.

## Bloque 6 — Cancelación

- [ ] `Admin Center → Account → Billing → Subscription → Cancel subscription`.
- [ ] Confirmar y guardar el email de confirmación.
- [ ] Anotar la fecha hasta la que la cuenta queda accesible (típicamente fin del periodo de facturación).

## Bloque 7 — Post-cancelación (60 días)

- [ ] No eliminar el email del Owner — Zendesk puede enviar avisos / links de re-export.
- [ ] No tocar el backup en Drive/S3 durante mínimo 90 días.
- [ ] Si se decide pasar a otra plataforma, migrar desde el backup (no desde Zendesk en vivo, que ya no estará).
