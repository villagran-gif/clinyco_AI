import { randomUUID } from 'node:crypto';

const initialized = new WeakMap();
export async function ensureStore(pool) {
  if (!pool) throw new Error('database_unavailable');
  if (!initialized.has(pool)) initialized.set(pool, pool.query(`
    CREATE SCHEMA IF NOT EXISTS antonia_improvements;
    CREATE TABLE IF NOT EXISTS antonia_improvements.suggestions (
      id uuid PRIMARY KEY, request_id uuid NOT NULL, author_id text NOT NULL,
      author_email text NOT NULL, conversation_id text, category text NOT NULL,
      problem text NOT NULL, proposal text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_review_at timestamptz, reviewed_at timestamptz,
      review_error text, analysis jsonb,
      UNIQUE(author_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS suggestions_pending
      ON antonia_improvements.suggestions(last_review_at, created_at) WHERE reviewed_at IS NULL;
    CREATE TABLE IF NOT EXISTS antonia_improvements.review_runs (
      bucket bigint PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz, status text NOT NULL DEFAULT 'running',
      reviewed_count integer NOT NULL DEFAULT 0, error text
    );
  `).catch(error => { initialized.delete(pool); throw error; }));
  await initialized.get(pool);
}

const categories = new Set(['respuesta', 'datos', 'agendamiento', 'error', 'otra']);
export function validateSuggestion(body) {
  const text = (key, min, max) => {
    const value = body?.[key];
    if (typeof value !== 'string' || value.trim().length < min || value.length > max)
      throw new Error(`invalid_${key}`);
    return value.trim();
  };
  const requestId = text('requestId', 36, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('invalid_requestId');
  const category = text('category', 1, 30);
  if (!categories.has(category)) throw new Error('invalid_category');
  const conversationId = body?.conversationId == null || body.conversationId === '' ? null : text('conversationId', 1, 16);
  if (conversationId && !/^[1-9]\d{0,15}$/.test(conversationId)) throw new Error('invalid_conversationId');
  return { requestId, category, conversationId, problem: text('problem', 10, 2000), proposal: text('proposal', 0, 2000) };
}

export async function saveSuggestion(pool, user, input) {
  await ensureStore(pool);
  if (!user?.id || !user?.email) throw new Error('authentication_required');
  const values = [randomUUID(), input.requestId, user.id, user.email, input.conversationId, input.category, input.problem, input.proposal];
  const inserted = await pool.query(`INSERT INTO antonia_improvements.suggestions
    (id,request_id,author_id,author_email,conversation_id,category,problem,proposal)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(author_id,request_id) DO NOTHING RETURNING *`, values);
  if (inserted.rows[0]) return inserted.rows[0];
  return (await pool.query('SELECT * FROM antonia_improvements.suggestions WHERE author_id=$1 AND request_id=$2', [user.id, input.requestId])).rows[0];
}

export async function listSuggestions(pool) {
  await ensureStore(pool);
  const [items, run, pending] = await Promise.all([
    pool.query(`SELECT id,author_email,conversation_id,category,problem,proposal,created_at,
      last_review_at,reviewed_at,review_error,analysis FROM antonia_improvements.suggestions ORDER BY created_at DESC LIMIT 100`),
    pool.query('SELECT started_at,finished_at,status,reviewed_count,error FROM antonia_improvements.review_runs ORDER BY bucket DESC LIMIT 1'),
    pool.query('SELECT count(*)::int AS count FROM antonia_improvements.suggestions WHERE reviewed_at IS NULL'),
  ]);
  return { items: items.rows, lastRun: run.rows[0] || null, pending: pending.rows[0].count,
    nextReviewAt: new Date((Math.floor(Date.now() / 1800000) + 1) * 1800000).toISOString() };
}
