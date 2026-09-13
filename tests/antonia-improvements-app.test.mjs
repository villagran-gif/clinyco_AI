import test from 'node:test';
import assert from 'node:assert/strict';
import { registerImprovementApp } from '../antonia-improvements/chatwoot-app.js';
const env = { ANTONIA_FEEDBACK_REGISTER_APP: 'true', RENDER_SERVICE_ID: 'srv-d6r082fkijhs73bdsejg', CHATWOOT_API_TOKEN: 'synthetic-token' };
test('registration is opt-in and limited to the production core', async () => {
  const fetchImpl = async () => { throw new Error('unexpected_network'); };
  assert.equal((await registerImprovementApp({ env: {}, fetchImpl })).skipped, 'disabled');
  assert.equal((await registerImprovementApp({ env: { ...env, RENDER_SERVICE_ID: 'test' }, fetchImpl })).skipped, 'not_production_core');
  await assert.rejects(registerImprovementApp({ env: { ...env, CHATWOOT_ACCOUNT_ID: '999' }, fetchImpl }), /mismatch/);
});
test('creates the app once with the official payload and never overwrites another URL', async () => {
  const apps = []; const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'POST') { const app = { id: 123, ...JSON.parse(options.body).dashboard_app }; apps.push(app); return Response.json(app, { status: 201 }); }
    return Response.json(apps);
  };
  assert.equal((await registerImprovementApp({ env, fetchImpl })).created, true);
  assert.equal((await registerImprovementApp({ env, fetchImpl })).created, false);
  assert.equal(requests.filter(r => r.options.method === 'POST').length, 1);
  assert.deepEqual(apps[0].content, [{ type: 'frame', url: 'https://clinyco-ai.netlify.app/chatwoot-antonia.html' }]);
  apps[0].content[0].url = 'https://other.example.test';
  await assert.rejects(registerImprovementApp({ env, fetchImpl }), /conflict/);
});
test('authorization failure is explicit and performs no write', async () => {
  let calls = 0;
  await assert.rejects(registerImprovementApp({ env, fetchImpl: async () => { calls++; return Response.json({}, { status: 401 }); } }), /list_401/);
  assert.equal(calls, 1);
});
