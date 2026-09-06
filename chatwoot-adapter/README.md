# chatwoot-adapter

Adaptador de entrada/salida entre **Chatwoot Cloud** y el core de AntonIA.

## Flujo

```text
Chatwoot
  -> integration gateway
  -> POST /chatwoot/inbound
  -> parseChatwootInbound()
  -> core AntonIA
  -> sendChatwootReply()
  -> Chatwoot
```

## Normalización

- `message_created` incoming -> paciente.
- `message_created` outgoing de `sender.type=user` -> agente humano y activa handoff/pausa.
- `sender.type=agent_bot` -> eco del bot, no se interpreta como intervención humana.
- El `conversationId` se namespacifica con `cw:` dentro del core para evitar colisiones; el cliente de salida quita ese prefijo antes de llamar Chatwoot.

## Variables

- `CHATWOOT_ADAPTER_TOKEN` — Bearer entre gateway y core.
- `CHATWOOT_API_TOKEN` — token para salida a Chatwoot.
- `CHATWOOT_ACCOUNT_ID` — cuenta Chatwoot.
- `CHATWOOT_API_URL` — default `https://app.chatwoot.com`.
- `CHATWOOT_ADAPTER_DRY_RUN` — evita envío real cuando se habilita explícitamente.

Chatwoot es el único transporte conversacional soportado por el runtime actual.
