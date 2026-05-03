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

async function metaFetch(path, { params = {}, method = "GET", body } = {}) {
  const accessToken = getEnv("META_ACCESS_TOKEN");
  if (!accessToken) {
    throw new Error("META_ACCESS_TOKEN is not set");
  }
  const url = graphUrl(path, { access_token: accessToken, ...params });
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) {
    const err = json.error || { message: `HTTP ${response.status}` };
    const detail = `code=${err.code ?? "?"} type=${err.type ?? "?"} sub=${err.error_subcode ?? "?"}`;
    throw new Error(`Meta API error: ${err.message} (${detail})`);
  }
  return json;
}

export function normalizeAdAccountId(id) {
  if (!id) return id;
  const str = String(id);
  return str.startsWith("act_") ? str : `act_${str}`;
}

export async function debugToken(token) {
  const inputToken = token ?? getEnv("META_ACCESS_TOKEN");
  if (!inputToken) throw new Error("No token provided to debugToken()");
  const appId = getEnv("META_APP_ID");
  const appSecret = getEnv("META_APP_SECRET");
  const appAccessToken = appId && appSecret ? `${appId}|${appSecret}` : inputToken;
  const url = graphUrl("/debug_token", { input_token: inputToken, access_token: appAccessToken });
  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) {
    throw new Error(`Meta debug_token error: ${json.error?.message ?? `HTTP ${response.status}`}`);
  }
  return json.data;
}

export async function listAdAccounts({
  fields = "id,name,account_status,currency,timezone_name,business_name",
  limit = 100,
} = {}) {
  const json = await metaFetch("/me/adaccounts", { params: { fields, limit } });
  return json.data ?? [];
}

export async function listCampaigns(adAccountId, {
  fields = "id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time",
  limit = 100,
  effectiveStatus,
} = {}) {
  const id = normalizeAdAccountId(adAccountId);
  const params = { fields, limit };
  if (effectiveStatus) params.effective_status = JSON.stringify(effectiveStatus);
  const json = await metaFetch(`/${id}/campaigns`, { params });
  return json.data ?? [];
}

export async function getInsights(objectId, {
  fields = "impressions,clicks,spend,reach,cpc,cpm,ctr,actions",
  datePreset = "last_30d",
  level = "campaign",
  timeRange,
  breakdowns,
  extra = {},
} = {}) {
  const params = { fields, level, ...extra };
  if (timeRange) params.time_range = JSON.stringify(timeRange);
  else params.date_preset = datePreset;
  if (breakdowns) params.breakdowns = Array.isArray(breakdowns) ? breakdowns.join(",") : breakdowns;
  const json = await metaFetch(`/${objectId}/insights`, { params });
  return json.data ?? [];
}
