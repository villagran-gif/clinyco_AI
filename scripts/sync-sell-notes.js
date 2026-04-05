#!/usr/bin/env node
import "dotenv/config";
/**
 * sync-sell-notes.js — Sync notes from Zendesk Sell API.
 * Stores agent activity notes per deal for tracking agent actions.
 *
 * Usage: DATABASE_URL=... node scripts/sync-sell-notes.js [--limit 100]
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const SELL_TOKEN = process.env.SELL_ACCESS_TOKEN || process.env.ZENDESK_SELL_API_TOKEN;
const SELL_BASE = process.env.SELL_BASE_URL || "https://api.getbase.com";

if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (!SELL_TOKEN) { console.error("SELL_ACCESS_TOKEN required"); process.exit(1); }

const args = process.argv.slice(2);
const LIMIT = parseInt(args[args.indexOf("--limit") + 1]) || 200;

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Create notes table
await pool.query(`
  CREATE TABLE IF NOT EXISTS sell_notes (
    id bigserial PRIMARY KEY,
    note_id text UNIQUE,
    deal_id text,
    contact_id text,
    creator_id integer,
    creator_name text,
    content text,
    note_created_at timestamptz,
    note_updated_at timestamptz,
    synced_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS sell_notes_deal_idx ON sell_notes (deal_id);
`);

// Map user IDs to names
async function fetchUsers() {
  const map = new Map();
  let page = 1;
  while (true) {
    const res = await fetch(`${SELL_BASE}/v2/users?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${SELL_TOKEN}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) break;
    const data = await res.json();
    for (const u of data.items || []) {
      map.set(u.data.id, u.data.name);
    }
    if ((data.items || []).length < 100) break;
    page++;
  }
  return map;
}

// Fetch notes with pagination
async function fetchNotes(page = 1) {
  const res = await fetch(`${SELL_BASE}/v2/notes?per_page=100&page=${page}&sort_by=updated_at:desc`, {
    headers: { Authorization: `Bearer ${SELL_TOKEN}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Sell API ${res.status}`);
  return res.json();
}

async function main() {
  console.log("[sync-notes] Fetching users...");
  const userMap = await fetchUsers();
  console.log(`[sync-notes] ${userMap.size} users loaded`);

  let inserted = 0;
  let page = 1;
  let totalFetched = 0;

  while (totalFetched < LIMIT) {
    const data = await fetchNotes(page);
    const items = data.items || [];
    if (!items.length) break;

    for (const item of items) {
      const n = item.data;
      const dealId = n.deal_id ? String(n.deal_id) : null;
      const contactId = n.contact_id ? String(n.contact_id) : null;
      const creatorName = userMap.get(n.creator_id) || null;

      try {
        await pool.query(`
          INSERT INTO sell_notes (note_id, deal_id, contact_id, creator_id, creator_name, content, note_created_at, note_updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (note_id) DO UPDATE SET
            content = EXCLUDED.content,
            creator_name = EXCLUDED.creator_name,
            note_updated_at = EXCLUDED.note_updated_at,
            synced_at = now()
        `, [String(n.id), dealId, contactId, n.creator_id, creatorName, n.content, n.created_at, n.updated_at]);
        inserted++;
      } catch (err) {
        console.error(`  Error note ${n.id}:`, err.message);
      }
    }

    totalFetched += items.length;
    console.log(`  Page ${page}: ${items.length} notes (total: ${totalFetched})`);
    if (items.length < 100) break;
    page++;
  }

  console.log(`[sync-notes] Done: ${inserted} notes synced`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
