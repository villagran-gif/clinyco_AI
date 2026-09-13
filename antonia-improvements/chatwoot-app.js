const accountId = '162472';
const title = 'Mejorar Antonia';
const appUrl = 'https://clinyco-ai.netlify.app/chatwoot-antonia.html';
const endpoint = `https://app.chatwoot.com/api/v1/accounts/${accountId}/dashboard_apps`;

export async function registerImprovementApp({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.ANTONIA_FEEDBACK_REGISTER_APP !== 'true') return { skipped: 'disabled' };
  if (env.RENDER_SERVICE_ID !== 'srv-d6r082fkijhs73bdsejg') return { skipped: 'not_production_core' };
  if (!env.CHATWOOT_API_TOKEN) throw new Error('chatwoot_app_token_missing');
  if (env.CHATWOOT_ACCOUNT_ID && String(env.CHATWOOT_ACCOUNT_ID) !== accountId) throw new Error('chatwoot_app_account_mismatch');
  const headers = { api_access_token: env.CHATWOOT_API_TOKEN, 'Content-Type': 'application/json' };
  const existingResponse = await fetchImpl(endpoint, { headers, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!existingResponse.ok) throw new Error(`chatwoot_app_list_${existingResponse.status}`);
  const apps = await existingResponse.json();
  if (!Array.isArray(apps)) throw new Error('chatwoot_app_invalid_list');
  const existing = apps.find(app => app.title === title);
  if (existing) {
    if (!existing.content?.some(item => item.type === 'frame' && item.url === appUrl)) throw new Error('chatwoot_app_url_conflict');
    return { configured: true, id: existing.id, created: false };
  }
  const response = await fetchImpl(endpoint, { method: 'POST', headers,
    body: JSON.stringify({ dashboard_app: { title, content: [{ type: 'frame', url: appUrl }] } }),
    signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`chatwoot_app_create_${response.status}`);
  const app = await response.json();
  if (!app.id) throw new Error('chatwoot_app_missing_id');
  return { configured: true, id: app.id, created: true };
}
