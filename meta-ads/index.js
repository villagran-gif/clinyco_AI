import { getEnv } from "../config/env.js";
import {
  debugToken,
  listAdAccounts,
  listCampaigns,
  getInsights,
  normalizeAdAccountId,
} from "./client.js";

let cached = null;

export async function bootstrap({ refresh = false } = {}) {
  if (cached && !refresh) return cached;

  const tokenInfo = await debugToken();
  const accounts = await listAdAccounts();
  const configured = getEnv("META_AD_ACCOUNT_ID");
  const primary = configured
    ? normalizeAdAccountId(configured)
    : accounts[0]?.id ?? null;

  cached = {
    appId: tokenInfo.app_id,
    appName: tokenInfo.application,
    isValid: tokenInfo.is_valid,
    expiresAt: tokenInfo.expires_at,
    scopes: tokenInfo.scopes ?? [],
    accounts,
    primaryAdAccountId: primary,
  };
  return cached;
}

export {
  debugToken,
  listAdAccounts,
  listCampaigns,
  getInsights,
  normalizeAdAccountId,
};
