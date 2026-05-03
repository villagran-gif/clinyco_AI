# TikTok ↔ Chatwoot bridge

Middleware skeleton to relay messages between TikTok Business Messaging API and a Chatwoot **API channel** inbox.

## Status
Skeleton. Requires TikTok Business Messaging API access (partner-only) before it can send/receive real traffic.

## Wiring

In `server.js`:

```js
import { registerTikTokBridge } from './bridges/tiktok-chatwoot/index.js';
registerTikTokBridge(app);
```

Must be registered after `app.use(express.json())`.

## Endpoints

- `POST /webhooks/tiktok` — TikTok → Chatwoot (incoming user messages)
- `POST /webhooks/chatwoot/tiktok` — Chatwoot → TikTok (agent replies)

Set the Chatwoot inbox `webhook_url` to `https://clinyco-ai.onrender.com/webhooks/chatwoot/tiktok`.

## Required env

- `CHATWOOT_BASE_URL` (default `https://app.chatwoot.com`)
- `CHATWOOT_TIKTOK_INBOX_IDENTIFIER` — `inbox_identifier` of the Chatwoot API inbox
- `TIKTOK_ACCESS_TOKEN` — Business Messaging API access token

## Chatwoot inbox (already created)

- Account: 162472
- Inbox ID: 107767
- inbox_identifier: `iNxtMRQ68ef6bLRZ7EkkuSWx`
- hmac_token: `4oTNhik4WpJzBtxQoYqqyjR9` (rotate before production use)

## TODO before production

- Implement real `verifyTikTokSignature` once TikTok API access is granted
- Add HMAC verification of Chatwoot webhook (`X-Chatwoot-Hmac-Sha256` header)
- Persist mapping `tiktok_user_id ↔ chatwoot contact_id/conversation_id` if the public API stops returning it
- Handle attachments (images, video) in both directions
- Update Chatwoot inbox `webhook_url` from the placeholder to the real Render URL
