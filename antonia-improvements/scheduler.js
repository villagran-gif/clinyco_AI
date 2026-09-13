import { ensureStore } from './store.js';
import { reviewErrorCode } from './reviewer.js';

export const INTERVAL_MS = 30 * 60 * 1000;
const LOCK_ID = 61720314;

export async function reviewPending({ pool, review, now = Date.now() }) {
  await ensureStore(pool);
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID])).rows[0].locked;
    if (!locked) return { skipped: 'busy' };
    const bucket = Math.floor(now / INTERVAL_MS);
    const run = await client.query(`INSERT INTO antonia_improvements.review_runs(bucket) VALUES($1)
      ON CONFLICT DO NOTHING RETURNING bucket`, [bucket]);
    if (!run.rowCount) return { skipped: 'already_attempted' };
    // A terminated instance must not leave its previous run appearing active.
    await client.query(`UPDATE antonia_improvements.review_runs SET status='interrupted',finished_at=now()
      WHERE status='running' AND bucket<$1`, [bucket]);
    const { rows } = await client.query(`SELECT id,category,problem,proposal FROM antonia_improvements.suggestions
      WHERE reviewed_at IS NULL ORDER BY last_review_at NULLS FIRST,created_at LIMIT 5`);
    try {
      const analysis = rows.length ? await review(rows) : [];
      await client.query('BEGIN');
      for (const item of analysis) await client.query(`UPDATE antonia_improvements.suggestions
        SET analysis=$2::jsonb,reviewed_at=now(),last_review_at=now(),review_error=NULL WHERE id=$1`, [item.id, JSON.stringify(item)]);
      await client.query(`UPDATE antonia_improvements.review_runs SET status=$2,finished_at=now(),reviewed_count=$3 WHERE bucket=$1`, [bucket, rows.length ? 'completed' : 'empty', analysis.length]);
      await client.query('COMMIT');
      return { reviewed: analysis.length };
    } catch (error) {
      await client.query('ROLLBACK');
      const code = reviewErrorCode(error);
      await client.query(`UPDATE antonia_improvements.suggestions SET last_review_at=now(),review_error=$2 WHERE id=ANY($1::uuid[])`, [rows.map(item => item.id), code]);
      await client.query(`UPDATE antonia_improvements.review_runs SET status='blocked',error=$2,finished_at=now() WHERE bucket=$1`, [bucket, code]);
      return { reviewed: 0, error: code };
    }
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); }
    finally { client.release(); }
  }
}

export function startImprovementReviews({ pool, review }) {
  if (!pool) { console.warn('[antonia-improvements] database_unavailable'); return () => {}; }
  let busy = false;
  let stopped = false;
  let timer;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await reviewPending({ pool, review });
      if (!result.skipped) console.log('[antonia-improvements]', JSON.stringify(result));
    } catch { console.error('[antonia-improvements] scheduler_failed'); }
    finally {
      busy = false;
      if (!stopped) {
        timer = setTimeout(tick, INTERVAL_MS - (Date.now() % INTERVAL_MS) + 50);
        timer.unref?.();
      }
    }
  };
  // Persistent half-hour buckets enforce the cadence across restarts/instances.
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
