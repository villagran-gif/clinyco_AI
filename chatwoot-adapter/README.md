# chatwoot-adapter

Permite que **Antonia responda por Chatwoot Cloud** (cuenta `162472`) en vez de
Sunshine Conversations, **sin tocar su cerebro**. Es la "Mitad 1" del plan
Chatwoot: el cerebro (la ruta `/messages`) es agnóstico del canal; acá solo
adaptamos el I/O.

## Cómo encaja

```
Chatwoot Cloud ─webhook─→ sell-medinet-backend (chatwoot.raw_events)
                              └─ chatwoot-dispatcher (handler "antonia")
                                   └─HTTP─→ clinyco_AI  POST /chatwoot/inbound
                                              └─ extractConversationInfo() detecta
                                                 Chatwoot → mismo `info` que Sunco
                                              └─ cerebro de Antonia (sin cambios)
                                              └─ sendConversationReply() transport-aware
                                                   └─ sendChatwootReply() (este módulo)
```

## Piezas

| Archivo | Qué hace |
|---|---|
| `parse.js` | `isChatwootPayload()` + `parseChatwootInbound()`: webhook `message_created` → el MISMO objeto `info` que produce `extractConversationInfo` para Sunco (pure, testeado). |
| `client.js` | `sendChatwootReply({conversationId, content})`: outbound a `/api/v1/accounts/162472/conversations/:id/messages`. Dry-run aware. |

## Normalización clave

- `conversationId` se prefija `cw:` para no colisionar con los UUID de Sunco en
  el store. El cliente outbound lo quita antes de pegarle a la API.
- `eventType` → `"conversation:message"` (lo que chequea la ruta).
- `message_type: incoming` → `authorType "user"` (paciente); `outgoing` →
  `"business"` (agente/bot; la ruta lo trata como takeover/echo).

## Env (opt-in)

| Var | Default | Para qué |
|---|---|---|
| `CHATWOOT_ADAPTER_ENABLED` | `false` | Monta la ruta `POST /chatwoot/inbound`. |
| `CHATWOOT_ADAPTER_DRY_RUN` | `false` | Si `true`, el outbound no hace HTTP (loguea). |
| `CHATWOOT_ADAPTER_TOKEN` | — | Bearer que exige `/chatwoot/inbound` (lo manda el dispatcher). |
| `CHATWOOT_API_TOKEN` | — | Token de la cuenta 162472 (outbound). |
| `CHATWOOT_ACCOUNT_ID` | `162472` | Override del account. |
| `CHATWOOT_API_URL` | `https://app.chatwoot.com` | Override (self-host). |

**Seguridad / no-regresión**: opt-in y **paralelo a Sunco**. Con el flag apagado,
la ruta no se monta y el camino `/messages` (Sunco) queda byte-idéntico.

## Pendiente (refinamientos)

- Detección fina agente-humano vs bot para el takeover (hoy: incoming=user,
  outgoing=business; el guard `isRecentOutboundEcho` cubre los echoes del bot).
- Adjuntos (hoy solo texto).
