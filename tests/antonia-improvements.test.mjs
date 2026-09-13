import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ensureStore, validateSuggestion, saveSuggestion, listSuggestions } from '../antonia-improvements/store.js';
import { reviewPending, INTERVAL_MS } from '../antonia-improvements/scheduler.js';
import { validateAnalysis, reviewErrorCode, createReviewer } from '../antonia-improvements/reviewer.js';
import { improvementsRouter } from '../antonia-improvements/router.js';
import { reviewAuth } from '../review/auth.js';
import express from 'express';

const pgPath = process.env.REVIEW_TEST_PGLITE_PATH;
const PGlite = pgPath ? (await import(pgPath)).PGlite : null;
const user = { id: 'test-operator', email: 'operator@example.test' };
const input = () => ({ requestId: randomUUID(), category: 'respuesta', conversationId: '999001', problem: 'La respuesta repite la pregunta anterior.', proposal: 'Usar los datos ya recopilados.' });
const analysis = rows => rows.map(row => ({ id: row.id, verdict: 'factible', reason: 'Evita duplicaciones.', proposal: 'Usar los datos guardados.', checks: 'Probar con una conversación sintética.' }));

async function database() {
  const db = new PGlite(); let locked = false;
  const pool = { async query(sql, values) {
    if (sql.includes('pg_try_advisory_lock')) { const acquired = !locked; locked = true; return { rows: [{ locked: acquired }] }; }
    if (sql.includes('pg_advisory_unlock')) { locked = false; return { rows: [] }; }
    if (!values && /;\s*\S/.test(sql.trim().replace(/;$/, ''))) { await db.exec(sql); return { rows: [] }; }
    const result = await db.query(sql, values); return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  }, async connect() { return { query: pool.query, release() {} }; } };
  await ensureStore(pool);
  return { pool, close: () => db.close() };
}

test('validates suggestion bounds, IDs and category without trusting supplied author', () => {
  assert.deepEqual(validateSuggestion({ ...input(), author_id: 'forged' }).author_id, undefined);
  for (const change of [{ problem: '' }, { problem: 'a'.repeat(2001) }, { category: 'system' }, { requestId: '../../file' }, { conversationId: 'https://example.test' }, { proposal: {} }]) assert.throws(() => validateSuggestion({ ...input(), ...change }));
});
test('validates every review ID, verdict and explanation; rejects missing or invented results', () => {
  const rows = [{ id: randomUUID() }]; const valid = analysis(rows);
  assert.deepEqual(validateAnalysis(JSON.stringify({ items: valid }), rows), valid);
  for (const items of [[], [...valid, ...valid], [{ ...valid[0], id: randomUUID() }], [{ ...valid[0], verdict: 'execute' }], [{ ...valid[0], checks: '' }]]) assert.throws(() => validateAnalysis(JSON.stringify({ items }), rows));
  assert.equal(reviewErrorCode({ status: 429, message: 'You have no credits remaining' }), 'ai_quota_exhausted');
  assert.equal(reviewErrorCode({ status: 429 }), 'ai_rate_limited');
});
test('save is immediate, uses authenticated author and is idempotent across retries', { skip: !PGlite }, async () => {
  const db = await database();
  try {
    const data = validateSuggestion(input());
    const [first, second] = await Promise.all([saveSuggestion(db.pool, user, data), saveSuggestion(db.pool, user, data)]);
    assert.equal(first.id, second.id); assert.equal(first.author_email, user.email); assert.equal(first.reviewed_at, null);
    const list = await listSuggestions(db.pool); assert.equal(list.pending, 1); assert.equal(list.items.length, 1);
  } finally { await db.close(); }
});
test('half-hour processing persists its result and does not repeat on restart', { skip: !PGlite }, async () => {
  const db = await database(); let calls = 0;
  try {
    await saveSuggestion(db.pool, user, validateSuggestion(input()));
    const opts = { pool: db.pool, review: async rows => { calls++; return analysis(rows); }, now: INTERVAL_MS * 10 };
    assert.deepEqual(await reviewPending(opts), { reviewed: 1 });
    assert.equal((await reviewPending(opts)).skipped, 'already_attempted');
    assert.deepEqual(await reviewPending({ ...opts, now: INTERVAL_MS * 11 }), { reviewed: 0 });
    assert.equal(calls, 1); assert.equal((await listSuggestions(db.pool)).pending, 0);
  } finally { await db.close(); }
});
test('exhausted quota preserves pending suggestions; next half hour can recover', { skip: !PGlite }, async () => {
  const db = await database();
  try {
    await saveSuggestion(db.pool, user, validateSuggestion(input()));
    const first = await reviewPending({ pool: db.pool, review: async () => { throw Object.assign(new Error('no credits remaining'), { status: 429 }); }, now: INTERVAL_MS * 10 });
    assert.equal(first.error, 'ai_quota_exhausted');
    const list = await listSuggestions(db.pool); assert.equal(list.pending, 1); assert.equal(list.items[0].review_error, 'ai_quota_exhausted');
    assert.equal(list.lastRun.status, 'blocked');
    await reviewPending({ pool: db.pool, review: async rows => analysis(rows), now: INTERVAL_MS * 11 });
    assert.equal((await listSuggestions(db.pool)).pending, 0);
  } finally { await db.close(); }
});
test('two schedulers cannot analyze the same pending batch concurrently', { skip: !PGlite }, async () => {
  const db = await database(); let calls = 0;
  try {
    await saveSuggestion(db.pool, user, validateSuggestion(input()));
    const opts = { pool: db.pool, review: async rows => { calls++; await new Promise(resolve => setImmediate(resolve)); return analysis(rows); }, now: INTERVAL_MS * 20 };
    const results = await Promise.all([reviewPending(opts), reviewPending(opts)]);
    assert.equal(calls, 1); assert.ok(results.some(result => result.skipped === 'busy'));
  } finally { await db.close(); }
});
test('HTTP routes enforce authorized session and exact mutation origin', { skip: !PGlite }, async () => {
  const db = await database(); const app = express();
  app.use(express.json());
  app.use(reviewAuth({ allowedEmails: () => user.email, fetchImpl: async () => Response.json({ ...user, confirmed_at: '2026-01-01' }) }));
  app.use(improvementsRouter({ getPool: () => db.pool }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const headers = { cookie: 'nf_jwt=synthetic.token', 'Content-Type': 'application/json', Origin: 'https://untrusted.example.test' };
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(input()) })).status, 403);
    headers.Origin = 'https://clinyco-ai.netlify.app';
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...input(), author_email: 'forged@example.test' }) });
    assert.equal(response.status, 201); assert.equal((await response.json()).item.author_email, user.email);
  } finally { await new Promise(resolve => server.close(resolve)); await db.close(); }
});

const jsdomPath = process.env.REVIEW_TEST_JSDOM_PATH;
const JSDOM = jsdomPath ? (await import(jsdomPath)).JSDOM : null;
test('form preserves text and request ID on failure; success clears once; renders suggestions as text', { skip: !JSDOM }, async () => {
  const html = await readFile(new URL('../review/site/antonia-feedback.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../review/site/antonia-feedback.js', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://clinyco-ai.netlify.app/antonia-feedback.html?conversation=999001', runScripts: 'outside-only' });
  const w = dom.window; const $ = id => w.document.getElementById(id); const posts = []; let fail = true;
  w.reviewAuthReady = Promise.resolve(true);
  w.fetch = async (_url, opts) => {
    if (opts?.method === 'POST') { posts.push(JSON.parse(opts.body)); return Response.json({}, { status: fail ? 503 : 201 }); }
    return Response.json({ items: [{ ...input(), id: randomUUID(), author_email: user.email, created_at: new Date().toISOString(), problem: '<img src=x onerror=alert(1)>' }], pending: 1, nextReviewAt: new Date().toISOString() });
  };
  try {
    w.eval(script); await new Promise(resolve => setImmediate(resolve));
    $('problem').value = 'La respuesta repite una pregunta.'; $('proposal').value = 'Revisar los datos guardados.';
    $('feedback-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await new Promise(resolve => setImmediate(resolve));
    assert.match($('save-status').textContent, /Conservamos/); assert.ok($('problem').value);
    fail = false;
    $('feedback-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await new Promise(resolve => setImmediate(resolve));
    assert.equal(posts[0].requestId, posts[1].requestId); assert.equal($('problem').value, ''); assert.equal($('suggestions').querySelector('img'), null);
    assert.equal(posts[1].conversationId, '999001'); assert.match($('save-status').textContent, /guardada/);
  } finally { w.close(); }
});
