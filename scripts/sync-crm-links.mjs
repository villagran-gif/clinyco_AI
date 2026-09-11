// Internal backfill only: no Chatwoot writes or AI calls.
import { readFile } from "node:fs/promises";
import { getPool } from "../review/db.js";
import { recordContactEvent, linkVerifiedRecord, ensureLinks } from "../review/crm-links.js";
const pool = getPool();
if (!pool) throw new Error("DATABASE_URL required");
try {
  await ensureLinks(pool);
  if (process.argv[2] === "--verified-mappings") {
    const mappings = JSON.parse(await readFile(process.argv[3], "utf8"));
    if (!Array.isArray(mappings)) throw new Error("Expected verified mappings array");
    for (const mapping of mappings) await linkVerifiedRecord(pool, mapping);
    console.log(JSON.stringify({ linked: mappings.length }));
  } else {
    const client = await pool.connect();
    let read = 0, imported = 0;
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`DECLARE crm_events NO SCROLL CURSOR FOR
        SELECT payload FROM chatwoot.raw_events WHERE event_type='message_created'
        AND payload->'account'->>'id'='162472' ORDER BY received_at`);
      while (true) {
        const { rows } = await client.query("FETCH FORWARD 250 FROM crm_events");
        if (!rows.length) break;
        for (const { payload } of rows) { read++; if (await recordContactEvent(pool, payload)) imported++; }
      }
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    console.log(JSON.stringify({ read, imported, source: "persisted_chatwoot_events", completeChatwootCoverageVerified: false }));
  }
} catch {
  console.error("CRM sync failed; verify source schema, connection, and mappings. No patient data logged.");
  process.exitCode = 1;
} finally { await pool.end(); }
