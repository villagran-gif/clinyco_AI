# lead-alerts

Notifica por **WAHA** a **María Paz** cuando aparece un **lead calificado que confirmó
querer ser contactado**, acotado a una ventana y geografía específicas, y envía
**recordatorios** al cliente y al agente. Lee **solo la DB compartida** (Zendesk ya no
existe). Opt-in y **dry-run por defecto**.

## Disparo (todo desde la DB)

```
structured_leads + conversations ──tick (cron)──> evaluateLead() ──WAHA sendText──> María Paz
   (handoff confirmado)              (filtro duro)                  + recordatorio agente
                                                                    + recordatorio cliente
```

- **Lead calificado + confirmó contacto** = el resolver llegó a un stage de handoff
  (`state_json.identity.lastResolvedStage ∈ {ready_for_handoff, handoff_without_call,
  agenda_without_direct_access}`) o `conversations.handoff_reason` está seteado.
- **Filtro duro** (`eligibility.js`): se notifica SOLO si
  - NO es de Antofagasta (`structured_leads.ciudad` ≠ Antofagasta),
  - se atiende/opera en **Santiago** (`source_json…c_ciudad_atencion` = Santiago),
  - estamos en el **turno de Gabriela** (≥ hora de inicio, días configurados).
  - Dato desconocido (null) ⇒ **no** elegible (no sobre-notificar).
- **Idempotencia**: tabla `lead_alert_log (conversation_id, kind)`.

## Piezas

| Archivo | Qué hace |
|---|---|
| `eligibility.js` | Reglas puras (Antofagasta / Santiago / turno). Testeado. |
| `messages.js` | Textos puros: alerta María Paz, recordatorios, link Chatwoot, resumen. Testeado. |
| `waha-client.js` | `sendText` vía `POST {WAHA_API_URL}/api/sendText` (`X-Api-Key`). Dry-run aware. |
| `db.js` | Consultas a la DB compartida + `lead_alert_log` (idempotencia). |
| `index.js` | `runLeadAlertsTick()` + `createLeadAlertsRouter()` (`/health`, `/tick`). |

## Montaje (1 línea en server.js)

```js
if (process.env.LEAD_ALERT_ENABLED === "true") {
  app.use("/lead-alerts", createLeadAlertsRouter());
}
```

Cron sugerido (cada 2–5 min en el VPS):

```
*/3 * * * *  curl -fsS -X POST -H "Authorization: Bearer $LEAD_ALERT_TICK_TOKEN" http://localhost:$PORT/lead-alerts/tick
```

## Env vars

| Var | Default | Para qué |
|---|---|---|
| `LEAD_ALERT_ENABLED` | `false` | Monta la ruta `/lead-alerts`. |
| `LEAD_ALERT_DRY_RUN` | `true` | Si ≠ `false`, NO envía por WAHA (loguea). |
| `LEAD_ALERT_ASK_LOCATION` | `false` | Activa que Antonia pregunte ciudad de residencia + de atención al detectar interés en agendar. |
| `LEAD_ALERT_MARIA_PAZ_PHONE` | — | Teléfono de María Paz (E.164, ej. `+569...`). Destinatario de la alerta. |
| `LEAD_ALERT_WAHA_SESSION` | `default` | Sesión WAHA conectada desde la que se envía. |
| `LEAD_ALERT_AGENT_NAME` | `Gabriela` | Nombre en `agent_registry` para el recordatorio al agente (su `waha_phone` sale de la DB). |
| `LEAD_ALERT_TICK_TOKEN` | — | Bearer que exige `/lead-alerts/tick` (opcional pero recomendado). |
| `LEAD_ALERT_LOOKBACK_HOURS` | `24` | Ventana hacia atrás para buscar leads. |
| `GABRIELA_SHIFT_START_HOUR` | `17` | Hora de inicio del turno (zona Chile). |
| `GABRIELA_SHIFT_END_HOUR` | `24` | Hora de fin (exclusiva). |
| `GABRIELA_SHIFT_WEEKDAYS` | (todos) | Días del turno: `0`=Dom … `6`=Sáb, coma-separados (ej. `1,2,3,4,5`). |
| `WAHA_API_URL`, `WAHA_API_KEY` | — | Reusadas de la instancia WAHA existente (ya en el VPS). |
| `CHATWOOT_ACCOUNT_ID` | `162472` | Para construir el link a la conversación. |

## Captura de ciudad en el cerebro (opt-in: `LEAD_ALERT_ASK_LOCATION`)

Cuando un lead muestra interés en agendar (stage de handoff) y el flag está activo, Antonia
pregunta (intercepción en `server.js`, envío verbatim, captura el turno siguiente vía
`system.awaitingLocationField`):
1. **residencia** → `"{nombre} ¿desde qué ciudad nos escribes?"` → `contactDraft.c_comuna`,
2. **ciudad de atención** → `"¿Tu intención es concretar este procedimiento o cirugía en Santiago o en Antofagasta?"` (Santiago primero) → `contactDraft.c_ciudad_atencion`.

Con el flag apagado el flujo de conversación queda **byte-idéntico**. Sin estos datos el filtro
duro deja todo en `skipped` (inerte y seguro).

## Seguridad / no-regresión

Opt-in + dry-run. Con el flag apagado la ruta no se monta y nada cambia. No persiste secretos;
WAHA usa las env vars existentes del VPS.
