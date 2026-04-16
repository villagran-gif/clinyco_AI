/**
 * Zendesk Sell v2 REST client — minimal wrapper used by Zap replacements.
 *
 * Auth: Bearer token. Reads from SELL_ACCESS_TOKEN, falling back to
 * ZENDESK_SELL_API_TOKEN / ZENDESK_API_TOKEN_SELL to match the other scripts
 * already in this repo (see scripts/sync-deals.js).
 *
 * Base URL: https://api.getbase.com (override via SELL_BASE_URL).
 *
 * Retries 429 / 5xx with exponential backoff, same policy as sync-deals.js.
 */

const SELL_BASE = (process.env.SELL_BASE_URL || "https://api.getbase.com").replace(/\/$/, "");
const RETRY_MAX = 5;

function getToken() {
  const token =
    process.env.SELL_ACCESS_TOKEN ||
    process.env.ZENDESK_SELL_API_TOKEN ||
    process.env.ZENDESK_API_TOKEN_SELL;
  if (!token) {
    throw new Error(
      "Missing Zendesk Sell token — set SELL_ACCESS_TOKEN or ZENDESK_SELL_API_TOKEN"
    );
  }
  return token;
}

async function sellFetch(path, { method = "GET", body = null, attempt = 1 } = {}) {
  const url = `${SELL_BASE}/v2${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "ClinycoZapReplacement/1.0"
    },
    signal: AbortSignal.timeout(30_000)
  };
  if (body != null) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  if ((res.status === 429 || res.status >= 500) && attempt <= RETRY_MAX) {
    const wait = Math.min(8000, 400 * Math.pow(2, attempt));
    await new Promise((r) => setTimeout(r, wait));
    return sellFetch(path, { method, body, attempt: attempt + 1 });
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sell API ${method} ${path} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/** Fetch a deal by numeric id. */
export async function getDeal(dealId) {
  const data = await sellFetch(`/deals/${dealId}`);
  return data.data || data;
}

/** PUT /v2/deals/:id — patch is a partial deal object (e.g. { custom_fields: {...} }). */
export async function updateDeal(dealId, patch) {
  const data = await sellFetch(`/deals/${dealId}`, { method: "PUT", body: { data: patch } });
  return data.data || data;
}

/** PUT /v2/contacts/:id — patch is a partial contact object. */
export async function updateContact(contactId, patch) {
  const data = await sellFetch(`/contacts/${contactId}`, { method: "PUT", body: { data: patch } });
  return data.data || data;
}

/** Fetch a stage by id — needed to resolve pipeline_id from stage_id. */
export async function getStage(stageId) {
  const data = await sellFetch(`/stages/${stageId}`);
  return data.data || data;
}

/** Fetch a Sell user by id (used to resolve agent names). */
export async function getUser(userId) {
  const data = await sellFetch(`/users/${userId}`);
  return data.data || data;
}

/** Low-level escape hatch for callers that need a raw endpoint. */
export { sellFetch };
