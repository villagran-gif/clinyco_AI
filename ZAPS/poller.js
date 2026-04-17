/**
 * Poller: replaces Zapier's OAuth-based polling of Zendesk Sell.
 *
 * Runs on a setInterval inside the main server process. Every cycle it:
 *   1. Fetches deals updated since the last poll  → handleUpdateComisiones
 *   2. Fetches deals created since the last poll  → handleNormalizeRutOnDealCreate
 *   3. Fetches contacts created since the last poll → handleNormalizeRutOnContactCreate
 *
 * State: keeps `lastPoll` in memory (ISO string). On cold start, defaults to
 * 2 minutes ago so we don't reprocess the entire database.
 *
 * Env vars:
 *   ZAPS_POLL_INTERVAL_MS  — polling interval (default: 120000 = 2 min)
 *   ZAPS_POLL_ENABLED      — set to "true" to activate (default: off)
 */

import { sellFetch } from "./_shared/sell-client.js";
import { handleUpdateComisiones } from "./update-comisiones/index.js";
import { handleNormalizeRutOnDealCreate } from "./rut-normalizado-crear-trato/index.js";
import { handleNormalizeRutOnContactCreate } from "./zendesksell-normaliza-rut-al-crear-contacto/index.js";

const INTERVAL_MS = Number(process.env.ZAPS_POLL_INTERVAL_MS) || 120_000;
const PER_PAGE = 100;

let lastDealUpdate = null;
let lastDealCreate = null;
let lastContactCreate = null;
let timer = null;

function ago(ms) {
  return new Date(Date.now() - ms).toISOString();
}

async function fetchPage(path) {
  try {
    const data = await sellFetch(path);
    return (data.items || []).map((i) => i.data || i);
  } catch (err) {
    console.error(`[zaps-poller] fetchPage ${path} failed:`, err.message);
    return [];
  }
}

async function pollUpdatedDeals() {
  const since = lastDealUpdate || ago(INTERVAL_MS + 30_000);
  const path = `/deals?sort_by=updated_at:desc&per_page=${PER_PAGE}&updated_since=${encodeURIComponent(since)}`;
  const deals = await fetchPage(path);

  if (!deals.length) return;
  console.log(`[zaps-poller] ${deals.length} deals updated since ${since}`);

  for (const deal of deals) {
    try {
      await handleUpdateComisiones(deal);
    } catch (err) {
      console.error(`[zaps-poller] update-comisiones deal ${deal.id} failed:`, err.message);
    }
  }

  lastDealUpdate = deals[0].updated_at || new Date().toISOString();
}

async function pollNewDeals() {
  const since = lastDealCreate || ago(INTERVAL_MS + 30_000);
  const path = `/deals?sort_by=created_at:desc&per_page=${PER_PAGE}&created_since=${encodeURIComponent(since)}`;
  const deals = await fetchPage(path);

  const newDeals = deals.filter((d) => d.created_at && d.created_at > since);
  if (!newDeals.length) return;
  console.log(`[zaps-poller] ${newDeals.length} new deals since ${since}`);

  for (const deal of newDeals) {
    try {
      await handleNormalizeRutOnDealCreate(deal);
    } catch (err) {
      console.error(`[zaps-poller] rut-normalizado-trato deal ${deal.id} failed:`, err.message);
    }
  }

  lastDealCreate = newDeals[0].created_at || new Date().toISOString();
}

async function pollNewContacts() {
  const since = lastContactCreate || ago(INTERVAL_MS + 30_000);
  const path = `/contacts?sort_by=created_at:desc&per_page=${PER_PAGE}&created_since=${encodeURIComponent(since)}`;
  const contacts = await fetchPage(path);

  const newContacts = contacts.filter((c) => c.created_at && c.created_at > since);
  if (!newContacts.length) return;
  console.log(`[zaps-poller] ${newContacts.length} new contacts since ${since}`);

  for (const contact of newContacts) {
    try {
      await handleNormalizeRutOnContactCreate(contact);
    } catch (err) {
      console.error(`[zaps-poller] normaliza-rut-contacto contact ${contact.id} failed:`, err.message);
    }
  }

  lastContactCreate = newContacts[0].created_at || new Date().toISOString();
}

async function pollCycle() {
  const start = Date.now();
  try {
    await pollUpdatedDeals();
    await pollNewDeals();
    await pollNewContacts();
  } catch (err) {
    console.error("[zaps-poller] cycle error:", err.message);
  }
  const elapsed = Date.now() - start;
  console.log(`[zaps-poller] cycle done in ${elapsed}ms`);
}

export function startPoller() {
  const enabled = (process.env.ZAPS_POLL_ENABLED || "").trim().toLowerCase();
  if (enabled !== "true" && enabled !== "1") {
    console.log("[zaps-poller] disabled (set ZAPS_POLL_ENABLED=true to activate)");
    return;
  }

  console.log(`[zaps-poller] starting — interval ${INTERVAL_MS}ms`);
  setTimeout(() => pollCycle(), 5_000);
  timer = setInterval(pollCycle, INTERVAL_MS);
}

export function stopPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("[zaps-poller] stopped");
  }
}
