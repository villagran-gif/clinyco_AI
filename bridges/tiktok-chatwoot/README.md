# TikTok ↔ Chatwoot bridge (via ManyChat)

Middleware to relay messages between TikTok (gateway: ManyChat) and a Chatwoot **API channel** inbox.

## Architecture

```
[TikTok user]  ⇄  [ManyChat]  ⇄  this bridge  ⇄  [Chatwoot inbox API]
```

ManyChat is the certified TikTok partner. Inbound is Flow-driven (External Request); outbound is REST.

## Wiring in `server.js`

After `app.use(express.json())`:

```js
import { registerTikTokBridge } from './bridges/tiktok-chatwoot/index.js';
registerTikTokBridge(app);
```

## Endpoints

- `POST /webhooks/tiktok` — ManyChat External Request → Chatwoot incoming
- `POST /webhooks/chatwoot/tiktok` — Chatwoot agent reply → ManyChat → TikTok

## ManyChat Flow setup

1. Settings → Apps → connect TikTok Business account.
2. Automation → Default Reply (or Keyword) on TikTok channel.
3. Add action **External Request**:
   - Method: `POST`
   - URL: `https://clinyco-ai.onrender.com/webhooks/tiktok`
   - Headers: `X-Bridge-Secret: <MANYCHAT_WEBHOOK_SECRET>` (optional)
   - Body (JSON):
     ```json
     {
       "subscriber_id": "{{user_id}}",
       "name": "{{first_name}} {{last_name}}",
       "text": "{{last_input_text}}",
       "channel": "tiktok"
     }
     ```

## Chatwoot side

Update the API inbox `webhook_url` to `https://clinyco-ai.onrender.com/webhooks/chatwoot/tiktok`.

## Required env

- `CHATWOOT_BASE_URL` (default `https://app.chatwoot.com`)
- `CHATWOOT_TIKTOK_INBOX_IDENTIFIER=iNxtMRQ68ef6bLRZ7EkkuSWx`
- `MANYCHAT_API_KEY` — from ManyChat Settings → API
- `MANYCHAT_WEBHOOK_SECRET` (optional) — shared secret for the External Request header

## Chatwoot inbox

- Account: 162472
- Inbox ID: 107767
- inbox_identifier: `iNxtMRQ68ef6bLRZ7EkkuSWx`

## TODO before production

- Add HMAC verification of Chatwoot webhook (`X-Chatwoot-Hmac-Sha256`) using the inbox `hmac_token`.
- Persist mapping `subscriber_id ↔ chatwoot conversation_id` if the public API stops returning it.
- Handle attachments (images) in both directions.
- Consider message tags (`HUMAN_AGENT` requires explicit subscription to TikTok policy) for replies outside the 24h window.
- One ManyChat workspace = one TikTok page. For multiple TikTok accounts, replicate the bridge with separate `MANYCHAT_API_KEY` env vars.
