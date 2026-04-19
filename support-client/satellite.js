// Satellite backend (sell-medinet-backend/support).
//
// 1:1 mirror of the Zendesk Support API shape. Auth is an opaque API key
// passed in the X-API-Key header. The `.json` suffix on Zendesk-style paths
// is accepted (the satellite middleware strips it).

function readConfig(env) {
  const baseUrl = env.SUPPORT_SATELLITE_BASE_URL || null;
  const apiKey = env.SUPPORT_SATELLITE_API_KEY || null;
  return { baseUrl, apiKey };
}

function requireConfig(cfg) {
  if (!cfg.baseUrl) throw new Error("Missing SUPPORT_SATELLITE_BASE_URL");
  if (!cfg.apiKey) throw new Error("Missing SUPPORT_SATELLITE_API_KEY");
}

function composeUrl(baseUrl, path) {
  // baseUrl: e.g. "https://sell-medinet-backend.onrender.com/support"
  // path:    e.g. "/api/v2/users/123.json"
  const base = baseUrl.replace(/\/+$/, "");
  const rel = path.startsWith("/") ? path : `/${path}`;
  return new URL(`${base}${rel}`);
}

function expectedHost(baseUrl) {
  return new URL(baseUrl).host;
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
    throw new Error(`Support satellite request failed: ${response.status} ${raw}`);
  }
  return data;
}

export function createSatelliteBackend({ env = process.env, fetch = globalThis.fetch } = {}) {
  function headers() {
    const cfg = readConfig(env);
    return {
      "X-API-Key": cfg.apiKey,
      "Content-Type": "application/json"
    };
  }

  async function supportGet(path, params = {}) {
    const cfg = readConfig(env);
    requireConfig(cfg);
    const url = composeUrl(cfg.baseUrl, path);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: headers()
    });
    return parseResponse(response);
  }

  async function supportPost(path, body = {}) {
    const cfg = readConfig(env);
    requireConfig(cfg);
    const url = composeUrl(cfg.baseUrl, path);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body || {})
    });
    return parseResponse(response);
  }

  async function supportPut(path, body = {}) {
    const cfg = readConfig(env);
    requireConfig(cfg);
    const url = composeUrl(cfg.baseUrl, path);
    const response = await fetch(url.toString(), {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(body || {})
    });
    return parseResponse(response);
  }

  async function supportGetByUrl(rawUrl) {
    const cfg = readConfig(env);
    requireConfig(cfg);
    const parsed = new URL(String(rawUrl || ""));
    if (parsed.host !== expectedHost(cfg.baseUrl)) {
      throw new Error(`Unexpected satellite host: ${parsed.host}`);
    }
    const response = await fetch(parsed.toString(), {
      method: "GET",
      headers: headers()
    });
    return parseResponse(response);
  }

  return {
    backend: "satellite",
    supportGet,
    supportPost,
    supportPut,
    supportGetByUrl
  };
}
