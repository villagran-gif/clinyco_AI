Clinyco DB integration package

Included files:
- server.js
- conversation-resolver.js
- db.js
- schema.sql

What this adds:
- Render Postgres persistence for conversation state
- Conversation message logging
- Structured lead upsert
- Keeps current in-memory cache, but hydrates/saves to Postgres

Required env vars:
- DATABASE_URL=postgresql://...
- DATABASE_SSL=false   (use true only if your database connection requires SSL)
- ENABLE_SUPPORT_SEARCH=true   (if you want Support search enabled)

Important:
- Install dependency: npm install pg
- This server uses ESM imports, so keep your current package.json/module setup

Suggested rollout:
1) Add Render Postgres
2) Set DATABASE_URL in the web service
3) Add dependency: npm install pg
4) Deploy this package
5) Verify logs show: Database ready
6) Hit the health endpoint and then run a real conversation

Quick checks:
- node --check server.js
- node --check db.js

What is persisted:
- conversations: full state_json + takeover flags + counters
- conversation_messages: inbound/outbound messages
- structured_leads: normalized lead data for CRM/stats
