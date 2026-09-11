import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewAuth, REVIEW_SITE_ORIGIN } from '../review/auth.js';

const validUser = { id: 'test-user', email: 'operator@example.test', confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'google' } };
async function request({ method = 'GET', headers = { cookie: 'nf_jwt=test.token.value' }, emails = validUser.email, user = validUser, status = 200, unavailable = false } = {}) {
  const calls = [];
  const middleware = reviewAuth({ allowedEmails: () => emails, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (unavailable) throw new Error('Network unavailable');
    return new Response(JSON.stringify(user), { status });
  } });
  const req = { method, get: key => headers[key] };
  const res = { headers: {}, statusCode: 200, nextCalled: false,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await middleware(req, res, () => { res.nextCalled = true; });
  return { req, res, calls };
}

test('denies requests without a session before any Identity or application access', async () => {
  const { res, calls } = await request({ headers: {} });
  assert.equal(res.statusCode, 401); assert.equal(res.nextCalled, false); assert.equal(calls.length, 0);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});
test('empty allowlist fails closed even for valid sessions', async () => {
  const { res, calls } = await request({ emails: ' , ' });
  assert.equal(res.statusCode, 503); assert.equal(calls.length, 0);
});
test('accepts only a Google account verified by the pinned Identity endpoint and exact allowlist', async () => {
  const { req, res, calls } = await request({ emails: 'other@example.test, OPERATOR@example.test ' });
  assert.equal(res.nextCalled, true);
  assert.deepEqual(req.reviewUser, { id: validUser.id, email: validUser.email });
  assert.equal(calls[0].url, 'https://clinyco-ai.netlify.app/.netlify/identity/user');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test.token.value');
  assert.equal(calls[0].options.redirect, 'error');
});
test('a valid Google session is insufficient without explicit authorization', async () => {
  for (const emails of ['someone@example.test', '*', '@example.test', 'prefixoperator@example.test']) {
    const { res } = await request({ emails });
    assert.equal(res.statusCode, 403); assert.equal(res.nextCalled, false);
  }
});
test('rejects email/password, unconfirmed users and spoofed user-controlled provider metadata', async () => {
  for (const user of [
    { ...validUser, confirmed_at: null },
    { ...validUser, app_metadata: { provider: 'email' }, user_metadata: { provider: 'google' } },
    { ...validUser, app_metadata: undefined },
    { ...validUser, id: null },
    null,
  ]) {
    const { res } = await request({ user });
    assert.equal(res.statusCode, 403); assert.equal(res.nextCalled, false);
  }
});
test('rejects expired or forged tokens according to Identity; no decode-only fallback', async () => {
  for (const status of [401, 403]) {
    const { res } = await request({ status });
    assert.equal(res.statusCode, 401); assert.equal(res.nextCalled, false);
  }
});
test('provider outages and unconfigured Identity do not grant access', async () => {
  for (const options of [{ unavailable: true }, { status: 404 }, { status: 500 }]) {
    const { res } = await request(options);
    assert.equal(res.statusCode, 503); assert.equal(res.nextCalled, false);
  }
});
test('rejects malformed, oversized or ambiguous credentials without contacting Identity', async () => {
  for (const headers of [
    { cookie: 'nf_jwt=%ZZ' }, { cookie: 'nf_jwt=a; nf_jwt=b' },
    { cookie: `nf_jwt=${'a'.repeat(8193)}` }, { cookie: 'nf_jwt=%0A' },
    { authorization: 'Basic fake', cookie: 'nf_jwt=otherwise.valid.token' },
  ]) {
    const { res, calls } = await request({ headers });
    assert.equal(res.statusCode, 401); assert.equal(calls.length, 0);
  }
});
test('direct backend requests still need a verified token', async () => {
  const { res } = await request({ headers: { authorization: 'Bearer test.token.value', host: 'clinyco-ai.onrender.com' } });
  assert.equal(res.nextCalled, true);
  const denied = await request({ headers: { host: 'clinyco-ai.onrender.com', 'x-user-email': validUser.email } });
  assert.equal(denied.res.statusCode, 401);
});
test('all mutations require the exact trusted Origin, not another Netlify site or proxy host', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const origin of [undefined, 'https://evil.netlify.app', 'null', `${REVIEW_SITE_ORIGIN}.evil.test`]) {
      const { res, calls } = await request({ method, headers: { cookie: 'nf_jwt=test.token.value', origin, 'x-forwarded-host': 'clinyco-ai.netlify.app' } });
      assert.equal(res.statusCode, 403); assert.equal(calls.length, 0);
    }
    const { res } = await request({ method, headers: { cookie: 'nf_jwt=test.token.value', origin: REVIEW_SITE_ORIGIN } });
    assert.equal(res.nextCalled, true);
  }
});
test('rejects cross-site requests even when they carry a cookie', async () => {
  for (const extra of [{ origin: 'https://evil.netlify.app' }, { 'sec-fetch-site': 'cross-site' }]) {
    const { res } = await request({ headers: { cookie: 'nf_jwt=test.token.value', ...extra } });
    assert.equal(res.statusCode, 403);
  }
});
test('a removed account is checked again on its next request', async () => {
  let permitted = validUser.email;
  const middleware = reviewAuth({ allowedEmails: () => permitted, fetchImpl: async () => Response.json(validUser) });
  const req = { method: 'GET', get: k => k === 'cookie' ? 'nf_jwt=test.token.value' : undefined };
  const res = { set() { return this; }, status(s) { this.code = s; return this; }, json() { return this; } };
  let count = 0;
  await middleware(req, res, () => count++);
  permitted = 'different@example.test';
  await middleware(req, res, () => count++);
  assert.equal(count, 1); assert.equal(res.code, 403);
});
