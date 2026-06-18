// Low-level Graph API client shared by the Instagram and Facebook helpers.
// Uses Node's global fetch (Node 18+) — no node-fetch dependency.
import { getEnv } from "../config/env.js";

const DEFAULT_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com";

function graphUrl(path, params = {}) {
  const version = getEnv("META_API_VERSION", DEFAULT_VERSION);
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${GRAPH_BASE}/${version}${normalized}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function resolveToken(explicit) {
  const token = explicit ?? getEnv("META_CONTENT_TOKEN");
  if (!token) {
    throw new Error("META_CONTENT_TOKEN is not set (pass a token or set the env var)");
  }
  return token;
}

// GET against the Graph API. Returns parsed JSON, throws on Meta errors.
export async function graphGet(path, { params = {}, token } = {}) {
  const url = graphUrl(path, { access_token: resolveToken(token), ...params });
  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) {
    throw graphError(json, response.status);
  }
  return json;
}

// POST against the Graph API. Meta's write endpoints expect form-encoded
// params on the query string, not a JSON body, so we mirror that here.
export async function graphPost(path, { params = {}, token } = {}) {
  const url = graphUrl(path, { access_token: resolveToken(token), ...params });
  const response = await fetch(url, { method: "POST" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) {
    throw graphError(json, response.status);
  }
  return json;
}

function graphError(json, status) {
  const err = json.error || { message: `HTTP ${status}` };
  const detail = `code=${err.code ?? "?"} subcode=${err.error_subcode ?? "?"} type=${err.type ?? "?"}`;
  return new Error(`Meta Graph API error: ${err.message} (${detail})`);
}
