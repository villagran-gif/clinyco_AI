#!/usr/bin/env node
/**
 * Configures Frappe CRM <-> Twilio inbound telephony.
 *
 * Credentials are read from environment variables (never hardcoded):
 *   FRAPPE_CLOUD_API_KEY, FRAPPE_CLOUD_API_SECRET  - Frappe site API key/secret
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN          - Twilio account credentials
 *
 * Optional overrides:
 *   FRAPPE_SITE_URL    - default https://crm-yqh-dgj.m.frappe.cloud
 *   TWILIO_NUMBER      - default +19129134589
 *   TELEPHONY_AGENTS   - comma-separated agent emails (default villagran@clinyco.cl)
 *
 * Actions (idempotent, safe to re-run):
 *   1. Point the Twilio number's inbound voice webhook at Frappe's handler.
 *   2. Save CRM Twilio Settings (enabled + recording). On save, Frappe itself
 *      auto-creates the Twilio API Key and TwiML App.
 *   3. Register each agent as a CRM Telephony Agent answering in the browser.
 */

const KNOWN_GOOD_SITE = 'https://crm-yqh-dgj.m.frappe.cloud';

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// clinyco.frappe.cloud is not a provisioned site; fall back to the real one.
function sanitizeSite(url) {
  if (!url || url.includes('clinyco.frappe.cloud')) return KNOWN_GOOD_SITE;
  return url.replace(/\/+$/, '');
}

const FRAPPE_SITE = sanitizeSite(process.env.FRAPPE_SITE_URL || process.env.FRAPPE_CLOUD_SITE_URL);
const FRAPPE_KEY = required('FRAPPE_CLOUD_API_KEY');
const FRAPPE_SECRET = required('FRAPPE_CLOUD_API_SECRET');
const TWILIO_SID = required('TWILIO_ACCOUNT_SID');
const TWILIO_TOKEN = required('TWILIO_AUTH_TOKEN');
const TWILIO_NUMBER = process.env.TWILIO_NUMBER || '+19129134589';
const AGENTS = (process.env.TELEPHONY_AGENTS || 'villagran@clinyco.cl')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const INCOMING_WEBHOOK = `${FRAPPE_SITE}/api/method/crm.integrations.twilio.api.twilio_incoming_call_handler`;
const TWILIO_API = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}`;

async function frappe(method, path, body) {
  const res = await fetch(`${FRAPPE_SITE}${path}`, {
    method,
    headers: {
      Authorization: `token ${FRAPPE_KEY}:${FRAPPE_SECRET}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.exc_type) {
    throw new Error(`Frappe ${method} ${path} -> ${res.status} ${json.exc_type || ''} ${text.slice(0, 300)}`);
  }
  return json;
}

async function twilio(method, path, form) {
  const opts = {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64') },
  };
  if (form) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(form).toString();
  }
  const res = await fetch(`${TWILIO_API}${path}`, opts);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Twilio ${method} ${path} -> ${res.status} ${json.message || JSON.stringify(json)}`);
  }
  return json;
}

async function setInboundWebhook() {
  const list = await twilio('GET', `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(TWILIO_NUMBER)}`);
  const num = list.incoming_phone_numbers?.[0];
  if (!num) throw new Error(`Twilio number ${TWILIO_NUMBER} not found in this account`);
  await twilio('POST', `/IncomingPhoneNumbers/${num.sid}.json`, { VoiceUrl: INCOMING_WEBHOOK, VoiceMethod: 'POST' });
  console.log(`OK  inbound webhook set on ${TWILIO_NUMBER} (${num.sid})`);
}

async function saveTwilioSettings() {
  const doc = encodeURIComponent('CRM Twilio Settings');
  await frappe('PUT', `/api/resource/${doc}/${doc}`, {
    enabled: 1,
    account_sid: TWILIO_SID,
    auth_token: TWILIO_TOKEN,
    record_calls: 1,
  });
  // Read back to confirm Frappe auto-provisioned the API Key + TwiML App on save.
  const after = await frappe('GET', `/api/resource/${doc}/${doc}`);
  const m = after.data || {};
  console.log(`OK  CRM Twilio Settings saved (enabled=${m.enabled}, record_calls=${m.record_calls})`);
  console.log(`    auto-provisioned: api_key=${m.api_key || '-'} twiml_sid=${m.twiml_sid || '-'} app_name=${m.app_name || '-'}`);
  if (!m.api_key || !m.twiml_sid) {
    console.warn('    WARNING: API Key / TwiML App not populated - verify the Auth Token is valid.');
  }
}

async function upsertAgent(email) {
  const doc = encodeURIComponent('CRM Telephony Agent');
  const filters = encodeURIComponent(JSON.stringify([['user', '=', email]]));
  const existing = await frappe('GET', `/api/resource/${doc}?filters=${filters}`);
  if (existing.data && existing.data.length) {
    console.log(`--  agent already exists: ${email}`);
    return;
  }
  await frappe('POST', `/api/resource/${doc}`, {
    user: email,
    default_medium: 'Twilio',
    twilio_number: TWILIO_NUMBER,
    call_receiving_device: 'Computer',
  });
  console.log(`OK  agent added: ${email}`);
}

async function main() {
  console.log(`Frappe site:   ${FRAPPE_SITE}`);
  console.log(`Twilio number: ${TWILIO_NUMBER}`);
  console.log(`Agents:        ${AGENTS.join(', ')}\n`);

  const ping = await fetch(`${FRAPPE_SITE}/api/method/ping`)
    .then((r) => r.json())
    .catch(() => null);
  if (!ping || ping.message !== 'pong') throw new Error(`Frappe site not reachable at ${FRAPPE_SITE}`);

  await setInboundWebhook();
  await saveTwilioSettings();
  for (const email of AGENTS) {
    try {
      await upsertAgent(email);
    } catch (e) {
      console.error(`XX  agent ${email}: ${e.message}`);
    }
  }
  console.log('\nDone. Log into the CRM in a browser as an agent, then call the number to test.');
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
