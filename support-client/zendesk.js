// Zendesk Support backend.
//
// Behaviour is identical to the functions defined in server.js
// (zendeskSupportGet/Post/Put/GetByUrl). Kept here so the support-client
// module is self-contained and testable, and so that switching backends is a
// single env-var flip.

const ZENDESK_HOST_SUFFIX = ".zendesk.com";

function readConfig(env) {
  const subdomain = env.ZENDESK_SUBDOMAIN || null;
  const email = env.ZENDESK_SUPPORT_EMAIL || env.ZENDESK_API_EMAIL || null;
  const token = env.ZENDESK_SUPPORT_TOKEN || env.ZENDESK_API_TOKEN || null;
  return { subdomain, email, token };
}

function authHeader({ email, token }) {
  if (!email || !token) return null;
  return `Basic ${Buffer.from(`${email}/token:${token}`).toString("base64")}`;
}

function requireConfig(cfg) {
  if (!cfg.subdomain) throw new Error("Missing ZENDESK_SUBDOMAIN");
  const header = authHeader(cfg);
  if (!header) {
    throw new Error("Missing ZENDESK_SUPPORT_EMAIL or ZENDESK_SUPPORT_TOKEN");
  }
  return header;
}

async function parseResponse(response) {
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(`Zendesk Support request failed: ${response.status} ${raw}`);
  }
  return data;
}

export function createZendeskBackend({ env = process.env, fetch = globalThis.fetch } = {}) {
  async function get(path, params = {}) {
    const cfg = readConfig(env);
    const header = requireConfig(cfg);
    const url = new URL(`https://${cfg.subdomain}${ZENDESK_HOST_SUFFIX}${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: header, "Content-Type": "application/json" }
    });
    return parseResponse(response);
  }

  async function post(path, body = {}) {
    const cfg = readConfig(env);
    const header = requireConfig(cfg);
    const url = new URL(`https://${cfg.subdomain}${ZENDESK_HOST_SUFFIX}${path}`);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: header, "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    return parseResponse(response);
  }

  async function put(path, body = {}) {
    const cfg = readConfig(env);
    const header = requireConfig(cfg);
    const url = new URL(`https://${cfg.subdomain}${ZENDESK_HOST_SUFFIX}${path}`);
    const response = await fetch(url.toString(), {
      method: "PUT",
      headers: { Authorization: header, "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    return parseResponse(response);
  }

  async function getByUrl(rawUrl) {
    const cfg = readConfig(env);
    const header = requireConfig(cfg);
    const parsed = new URL(String(rawUrl || ""));
    const expectedHost = `${cfg.subdomain}${ZENDESK_HOST_SUFFIX}`;
    if (parsed.host !== expectedHost) {
      throw new Error(`Unexpected Zendesk host: ${parsed.host}`);
    }
    const response = await fetch(parsed.toString(), {
      method: "GET",
      headers: { Authorization: header, "Content-Type": "application/json" }
    });
    return parseResponse(response);
  }

  return {
    backend: "zendesk",
    get,
    post,
    put,
    getByUrl
  };
}
