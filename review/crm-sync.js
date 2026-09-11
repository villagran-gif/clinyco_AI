// Incremental projection of archived Chatwoot events, inside the existing service.
// No Chatwoot writes, clinical extraction or model calls.
import { ensureLinks, recordContactEvent } from './crm-links.js';
export async function syncCrmBatch(pool, from, batchSize = 100, project = recordContactEvent) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(from)) throw new Error('Invalid CRM sync start');
  await ensureLinks(pool);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const lock = await c.query('SELECT pg_try_advisory_xact_lock(162472221) AS acquired');
    if (!lock.rows[0].acquired) { await c.query('ROLLBACK'); return { busy:true }; }
    await c.query(`CREATE TABLE IF NOT EXISTS crm_sync_progress (
      source text PRIMARY KEY, last_id bigint NOT NULL DEFAULT 0, last_received timestamptz NOT NULL, imported bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    // Replay archived names once; retain the previous cursor for rollback.
    const source=`chatwoot:names-v2:${from}`;
    await c.query("INSERT INTO crm_sync_progress(source,last_received) VALUES ($1,$2::date::timestamp AT TIME ZONE 'America/Santiago') ON CONFLICT DO NOTHING",[source,from]);
    const progress=(await c.query('SELECT last_id,last_received FROM crm_sync_progress WHERE source=$1 FOR UPDATE',[source])).rows[0];
    // Select only fields needed for the links projection. Message content never leaves the DB here.
    const {rows}=await c.query(`SELECT id,received_at,jsonb_build_object(
      'event',event_type,'account',jsonb_build_object('id',account_id),
      'private',payload->'private','message_type',payload->'message_type','created_at',payload->'created_at',
      'sender',jsonb_build_object('id',payload->'sender'->'id','name',payload->'sender'->'name'),
      'conversation',jsonb_build_object('id',payload->'conversation'->'id','meta',jsonb_build_object('sender',
        jsonb_build_object('id',payload->'conversation'->'meta'->'sender'->'id','name',payload->'conversation'->'meta'->'sender'->'name')))
      ) AS payload FROM chatwoot.raw_events
      WHERE (received_at,id)>($1::timestamptz,$2::bigint)
      ORDER BY received_at,id LIMIT $3`,[progress.last_received,progress.last_id,batchSize]);
    let imported=0;
    for (const row of rows) if (await project(pool,row.payload)) imported++;
    if(rows.length) await c.query('UPDATE crm_sync_progress SET last_id=$2,imported=imported+$3,last_received=$4,updated_at=now() WHERE source=$1',[source,rows.at(-1).id,imported,rows.at(-1).received_at]);
    await c.query('COMMIT');
    return { read:rows.length,imported,more:rows.length===batchSize };
  } catch(e) { await c.query('ROLLBACK');throw e; } finally { c.release(); }
}
export function startCrmSync(pool) {
  const from=process.env.CRM_LINKS_SYNC_FROM;
  if(process.env.CRM_LINKS_SYNC_ENABLED!=='true' || !from || !pool)return;
  const tick=async()=>{
    let delay=60000;
    try { const result=await syncCrmBatch(pool,from); if(result.more)delay=1000;
      if(result.read)console.log('CRM_SYNC_BATCH',JSON.stringify(result));
    } catch { console.warn('CRM_SYNC_RETRY'); }
    setTimeout(tick,delay).unref();
  };
  setTimeout(tick,1000).unref();
}
