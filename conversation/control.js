import { randomUUID } from 'node:crypto';

export class ControlError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

// Independent of state_json: legacy snapshot writers cannot grant bot authority.
export async function ensureControlSchema(pool) {
  if (!pool) throw new ControlError('control_unavailable', 503);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS antonia_control (
      account_id text NOT NULL, conversation_id text NOT NULL,
      mode text NOT NULL CHECK (mode IN ('bot_active','human_active')),
      revision integer NOT NULL DEFAULT 0, actor text, reason text,
      changed_at timestamptz NOT NULL DEFAULT now(), resumed_at timestamptz,
      PRIMARY KEY(account_id, conversation_id)
    );
    CREATE TABLE IF NOT EXISTS antonia_control_events (
      account_id text NOT NULL, conversation_id text NOT NULL, event_id text NOT NULL,
      mode text NOT NULL, revision integer NOT NULL, actor text NOT NULL, reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(account_id, conversation_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS antonia_control_sends (
      id uuid PRIMARY KEY, account_id text NOT NULL, conversation_id text NOT NULL,
      revision integer NOT NULL, kind text NOT NULL,
      status text NOT NULL CHECK(status IN ('pending','accepted','uncertain')),
      message_id text, receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS antonia_control_pending_idx ON antonia_control_sends
      (account_id, conversation_id) WHERE status <> 'accepted';
  `);
}

export function controlKey(accountId, conversationId) {
  const account = String(accountId || '');
  const conversation = String(conversationId || '').replace(/^cw:/, '');
  if (!/^[1-9]\d{0,15}$/.test(account) || !/^[1-9]\d{0,15}$/.test(conversation))
    throw new ControlError('invalid_conversation', 400);
  return [account, `cw:${conversation}`];
}

export function createControlStore(getPool) {
  async function transaction(key, work) {
    const pool = getPool();
    if (!pool) throw new ControlError('control_unavailable', 503);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Conservative adoption: a recorded human takeover stays paused even if its old timer expired.
      await client.query(`INSERT INTO antonia_control(account_id,conversation_id,mode,reason)
        SELECT $1,$2,CASE WHEN EXISTS(SELECT 1 FROM conversations WHERE conversation_id=$2
          AND state_json->'system'->>'humanTakenOver'='true') THEN 'human_active' ELSE 'bot_active' END,
          'legacy_adoption' ON CONFLICT DO NOTHING`, key);
      const { rows: [row] } = await client.query(
        'SELECT * FROM antonia_control WHERE account_id=$1 AND conversation_id=$2 FOR UPDATE', key);
      const result = await work(client, row);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async function view(client, row) {
    const { rows } = await client.query(`SELECT id,kind,status,message_id,created_at FROM antonia_control_sends
      WHERE account_id=$1 AND conversation_id=$2 AND status <> 'accepted' ORDER BY created_at`,
      [row.account_id,row.conversation_id]);
    return { ...row, pending: rows, pause_status: row.mode === 'human_active'
      ? (rows.length ? 'pause_pending' : 'pause_confirmed') : null };
  }
  return {
    read: (key) => transaction(key, view),
    async change(key, { mode, actor, reason, eventId, expectedRevision, humanEvent = false }) {
      if (!['human_active','bot_active'].includes(mode) || !actor || !String(reason || '').trim()
        || String(reason).length > 500 || !eventId || String(eventId).length > 160)
        throw new ControlError('invalid_control_action', 400);
      if (humanEvent && mode !== 'human_active') throw new ControlError('invalid_human_event', 400);
      if (!humanEvent && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))
        throw new ControlError('expected_revision_required', 400);
      return transaction(key, async (client, row) => {
        const { rows: duplicates } = await client.query(`SELECT mode,actor,reason FROM antonia_control_events
          WHERE account_id=$1 AND conversation_id=$2 AND event_id=$3`, [...key,eventId]);
        if (duplicates.length) {
          if (duplicates[0].mode !== mode || duplicates[0].actor !== actor || duplicates[0].reason !== reason)
            throw new ControlError('idempotency_conflict');
          return view(client,row); // Never reapply an old pause after an explicit resume.
        }
        if (!humanEvent && row.revision !== expectedRevision) throw new ControlError('stale_control_revision');
        if (mode === 'bot_active' && row.mode !== 'human_active') throw new ControlError('already_active');
        if (mode === 'bot_active' && (await view(client,row)).pending.length)
          throw new ControlError('send_reconciliation_required');
        const { rows: [updated] } = await client.query(`UPDATE antonia_control SET mode=$3,
          revision=revision+1,actor=$4,reason=$5,changed_at=clock_timestamp(),
          resumed_at=CASE WHEN $3='bot_active' THEN clock_timestamp() ELSE resumed_at END
          WHERE account_id=$1 AND conversation_id=$2 RETURNING *`, [...key,mode,actor,reason]);
        await client.query(`INSERT INTO antonia_control_events
          (account_id,conversation_id,event_id,mode,revision,actor,reason) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [...key,eventId,mode,updated.revision,actor,reason]);
        return view(client,updated);
      });
    },
    async assertActive(key, revision) {
      const row = await this.read(key);
      if (row.mode !== 'bot_active' || row.revision !== revision || row.pending.length)
        throw new ControlError('human_control_or_stale_plan');
      return row;
    },
    async send(key, revision, kind, execute) {
      const id = randomUUID();
      await transaction(key, async (client,row) => {
        if (row.mode !== 'bot_active' || row.revision !== revision || (await view(client,row)).pending.length)
          throw new ControlError('human_control_or_stale_plan');
        await client.query(`INSERT INTO antonia_control_sends(id,account_id,conversation_id,revision,kind,status)
          VALUES($1,$2,$3,$4,$5,'pending')`,[id,...key,revision,kind]);
      });
      // No SQL transaction spans external I/O. A pause sees this claim as in flight.
      let result;
      try { result = await execute(); }
      catch (error) {
        await getPool()?.query("UPDATE antonia_control_sends SET status='uncertain',finished_at=now() WHERE id=$1",[id]);
        throw error;
      }
      await getPool().query(`UPDATE antonia_control_sends SET status=$2,message_id=$3,receipt=$4,finished_at=now() WHERE id=$1`,
        [id,(result?.messageId || result?.confirmed) ? 'accepted' : 'uncertain',result?.messageId == null ? null : String(result.messageId),JSON.stringify({confirmed:!!result?.confirmed})]);
      if (!result?.messageId && !result?.confirmed) throw new ControlError('send_reconciliation_required');
      return result;
    },
  };
}
