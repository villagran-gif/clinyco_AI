# Mac WhatsApp Call Extractor

Captures **outbound** call data from WhatsApp Desktop's local SQLite DBs
and POSTs them to the Clinyco server. WAHA can only see inbound calls;
this fills the gap for "best time to call" analytics.

## Setup

### 1. Generate an API key

```bash
openssl rand -hex 32
```

### 2. Add to Render env vars

`MAC_CALL_IMPORT_SECRET=<the key>` should already be set on Render.

### 3. Test (dry run)

```bash
MAC_CALL_IMPORT_SECRET=<key> MAC_AGENT_PHONE=+56987297033 python3 extract.py --dry-run
```

### 4. Install LaunchAgent

```bash
bash install.sh
# Edit ~/Library/LaunchAgents/com.clinyco.call-extractor.plist
# Replace REPLACE_WITH_SECRET with your actual secret
launchctl load ~/Library/LaunchAgents/com.clinyco.call-extractor.plist
```

### 5. Verify

```bash
tail -f /tmp/clinyco-call-extractor.log
```

## How it works

1. Reads `CallHistory.sqlite` (call events) and `ContactsV2.sqlite` (LID-to-phone mapping)
2. Joins by LID to resolve ~92% of calls to real phone numbers
3. POSTs new calls (since last checkpoint) to `/api/review/mac-calls-import`
4. Server stores in `agent_direct_calls` with `source='mac-desktop'`
5. Also populates `whatsapp_lid_phone_map` for cross-referencing

## Environment variables

| Var | Required | Description |
|-----|----------|-------------|
| `MAC_CALL_IMPORT_SECRET` | Yes | Bearer token for auth |
| `MAC_CALLS_API_URL` | No | Override server URL (default: Render) |
| `MAC_AGENT_PHONE` | No | Agent's phone number (e.g., +56987297033) |
