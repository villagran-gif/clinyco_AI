// Run separately from a transaction; CONCURRENTLY keeps incoming webhooks writable.
import pg from 'pg';
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  application_name: 'clinyco-history-index',
  connectionTimeoutMillis: 10000,
});
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
try {
  await client.connect();
  await client.query("SET lock_timeout = '5s'");
  await client.query("SET statement_timeout = '15min'");
  await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_events_conversation_history
    ON chatwoot.raw_events ((payload->'conversation'->>'id'), received_at DESC)
    WHERE event_type = 'message_created'`);
  const { rows } = await client.query(`SELECT i.indisvalid FROM pg_index i
    JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='chatwoot' AND c.relname='idx_raw_events_conversation_history'`);
  if (rows[0]?.indisvalid !== true) throw new Error('History index is not valid; inspect before retrying');
  console.log('Chatwoot conversation history index is valid');
} finally { await client.end(); }
