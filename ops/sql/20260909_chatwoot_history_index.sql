-- PREPARED ONLY. NOT EXECUTED. Requires operational approval and a direct DB connection.
-- Do not run inside BEGIN/COMMIT or an application startup migration transaction.
-- Compatible with the current single-account history predicate; future multi-account
-- queries must add account isolation and a matching account-prefixed index.
-- Inspect pg_indexes and pg_index before/after; IF NOT EXISTS does not validate
-- an existing index definition or repair an invalid interrupted index.
-- https://www.postgresql.org/docs/current/sql-createindex.html
SET lock_timeout = '5s';
SET statement_timeout = '10min';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_events_conversation_received_v1
  ON chatwoot.raw_events (((payload->'conversation'->>'id')), received_at DESC, id DESC)
  WHERE event_type = 'message_created';
RESET statement_timeout;
RESET lock_timeout;
-- If cancelled, inspect validity before a reviewed retry; no automatic DROP here.
SELECT i.relname, x.indisvalid, x.indisready, pg_get_indexdef(i.oid) AS definition
FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_namespace n ON n.oid = i.relnamespace
WHERE n.nspname = 'chatwoot' AND i.relname = 'idx_raw_events_conversation_received_v1';
