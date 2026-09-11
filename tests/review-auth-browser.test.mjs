import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Isolated browser simulation, not a substitute for the live Google redirect.
// REVIEW_TEST_JSDOM_PATH points to a temporary jsdom install (no server dependency).
const jsdomPath = process.env.REVIEW_TEST_JSDOM_PATH;
const JSDOM = jsdomPath ? (await import(jsdomPath)).JSDOM : null;
const html = await readFile(new URL('../review/site/index.html', import.meta.url), 'utf8');
const bundle = await readFile(new URL('../review/site/review-auth.js', import.meta.url), 'utf8');
const user = { id: 'operator-1', email: 'operator@example.test', confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'google' } };

function browser({ session = false, enabled = true, denied = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://clinyco-ai.netlify.app/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = [];
  let revoked = false;
  window.Request = Request; window.Response = Response; window.Headers = Headers;
  window.AbortController = AbortController; window.AbortSignal = AbortSignal;
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, window.location.href);
    calls.push({ path: url.pathname, init });
    if (url.pathname.endsWith('/settings')) return Response.json({ external: { google: enabled } });
    if (url.pathname === '/.netlify/identity/user') return Response.json(user);
    if (denied || revoked) return Response.json({ error: 'account_not_authorized' }, { status: 403 });
    if (url.pathname === '/api/auth/me') return Response.json({ user: { id: user.id, email: user.email } });
    return Response.json({ ok: true });
  };
  if (session) {
    const payload = Buffer.from(JSON.stringify({ sub: user.id, email: user.email, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
    window.document.cookie = `nf_jwt=eyJhbGciOiJIUzI1NiJ9.${payload}.test; Secure; Path=/`;
  }
  window.eval(bundle);
  return { dom, window, calls, revoke() { revoked = true; } };
}

test('anonymous browser shows login and makes no dashboard or CRM requests', { skip: !JSDOM }, async () => {
  const b = browser();
  try {
    assert.equal(await b.window.reviewAuthReady, false);
    assert.equal(b.window.document.documentElement.classList.contains('review-locked'), true);
    assert.equal(b.window.document.getElementById('review-google-login').disabled, false);
    await assert.rejects(b.window.fetch('/api/crm/links'), /Inicia sesión/);
    assert.equal(b.calls.some(c => c.path.startsWith('/api/')), false);
  } finally { b.dom.window.close(); }
});
test('Google disabled keeps the login button and panel locked', { skip: !JSDOM }, async () => {
  const b = browser({ enabled: false });
  try {
    assert.equal(await b.window.reviewAuthReady, false);
    assert.equal(b.window.document.getElementById('review-google-login').disabled, true);
    assert.match(b.window.document.getElementById('review-auth-message').textContent, /no está habilitado/);
  } finally { b.dom.window.close(); }
});
test('a restored Identity session must pass backend authorization before revealing the panel', { skip: !JSDOM }, async () => {
  const b = browser({ session: true });
  try {
    assert.equal(await b.window.reviewAuthReady, true);
    assert.equal(b.window.document.documentElement.classList.contains('review-locked'), false);
    assert.equal(b.window.document.getElementById('review-user-email').textContent, user.email);
    await b.window.fetch('/api/crm/links');
    const call = b.calls.find(c => c.path === '/api/crm/links');
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(call.init.cache, 'no-store');
    b.revoke();
    await assert.rejects(b.window.fetch('/api/crm/links'), /no tiene acceso/);
    assert.equal(b.window.document.documentElement.classList.contains('review-locked'), true);
    assert.equal(b.window.document.querySelector('main').children.length, 0);
  } finally { b.dom.window.close(); }
});
test('an authenticated but unapproved email never reveals CRM or requests its data', { skip: !JSDOM }, async () => {
  const b = browser({ session: true, denied: true });
  try {
    assert.equal(await b.window.reviewAuthReady, false);
    assert.equal(b.window.document.documentElement.classList.contains('review-locked'), true);
    assert.match(b.window.document.getElementById('review-auth-message').textContent, /no tiene acceso/);
    assert.equal(b.calls.some(c => c.path.startsWith('/api/crm')), false);
  } finally { b.dom.window.close(); }
});
test('signing out in another tab locks and clears the current workspace', { skip: !JSDOM }, async () => {
  const b = browser({ session: true });
  try {
    assert.equal(await b.window.reviewAuthReady, true);
    b.window.dispatchEvent(new b.window.StorageEvent('storage', { key: 'gotrue.user', newValue: null }));
    assert.equal(b.window.document.documentElement.classList.contains('review-locked'), true);
    assert.equal(b.window.document.querySelector('main').children.length, 0);
  } finally { b.dom.window.close(); }
});
