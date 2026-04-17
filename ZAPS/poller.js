/**
 * Poller: replaces Zapier's OAuth-based polling of Zendesk Sell.
 *
 * Runs on a setInterval inside the main server process. Every cycle it:
 *   1. Fetches deals updated since the last poll  → handleUpdateComisiones
 *   2. Fetches deals created since the last poll  → handleNormalizeRutOnDealCreate
 *   3. Fetches contacts created since the last poll → handleNormalizeRutOnContactCreate
 *
 * The Sell v2 API does NOT support date-range query params on list endpoints,
 * so we fetch the most recent page sorted by date desc and filter client-side.
 *
 * Dedup: since our own handlers update the deal (writing RUT_normalizado,
 * commission codes, etc.), that changes `updated_at` and would make the deal
 * reappear in the next poll. We keep a cooldown map of recently processed IDs
 * to skip them for COOLDOWN_CYCLES consecutive polls.
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
import { handleMetaConversionLead } from "./meta-conversion-leads/index.js";

const INTERVAL_MS = Number(process.env.ZAPS_POLL_INTERVAL_MS) || 120_000;
const PER_PAGE = 100;
const COOLDOWN_CYCLES = 2;

let lastDealUpdate = null;
let lastDealCreate = null;
let lastContactCreate = null;
let timer = null;

// Maps "deal:<id>" or "contact:<id>" → remaining cycles to skip
const cooldown = new Map();

function ago(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function shouldSkip(key) {
  const remaining = cooldown.get(key);
  if (remaining && remaining > 0) {
    cooldown.set(key, remaining - 1);
    if (remaining - 1 <= 0) cooldown.delete(key);
    return true;
  }
  return false;
}

function markProcessed(key) {
  cooldown.set(key, COOLDOWN_CYCLES);
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
  const path = `/deals?sort_by=updated_at:desc&per_page=${PER_PAGE}`;
  const deals = await fetchPage(path);

  const recent = deals.filter((d) => d.updated_at && d.updated_at > since);
  if (!recent.length) return;

  let processed = 0;
  let skipped = 0;
  for (const deal of recent) {
    const key = `deal:${deal.id}`;
    if (shouldSkip(key)) { skipped++; continue; }
    try {
      await handleUpdateComisiones(deal);
      markProcessed(key);
      processed++;
    } catch (err) {
      console.error(`[zaps-poller] update-comisiones deal ${deal.id} failed:`, err.message);
    }
  }
  if (processed || skipped) {
    console.log(`[zaps-poller] updated deals: ${processed} processed, ${skipped} skipped (cooldown)`);
  }

  lastDealUpdate = recent[0].updated_at || new Date().toISOString();
}

async function pollNewDeals() {
  const since = lastDealCreate || ago(INTERVAL_MS + 30_000);
  const path = `/deals?sort_by=created_at:desc&per_page=${PER_PAGE}`;
  const deals = await fetchPage(path);

  const newDeals = deals.filter((d) => d.created_at && d.created_at > since);
  if (!newDeals.length) return;

  let processed = 0;
  for (const deal of newDeals) {
    const key = `deal-new:${deal.id}`;
    if (shouldSkip(key)) continue;
    try {
      await handleNormalizeRutOnDealCreate(deal);
      markProcessed(key);
      processed++;
    } catch (err) {
      console.error(`[zaps-poller] rut-normalizado-trato deal ${deal.id} failed:`, err.message);
    }
    try {
      await handleMetaConversionLead(deal);
    } catch (err) {
      console.error(`[zaps-poller] meta-conversion-leads deal ${deal.id} failed:`, err.message);
    }
  }
  if (processed) console.log(`[zaps-poller] ${processed} new deals processed`);

  lastDealCreate = newDeals[0].created_at || new Date().toISOString();
}

async function pollNewContacts() {
  const since = lastContactCreate || ago(INTERVAL_MS + 30_000);
  const path = `/contacts?sort_by=created_at:desc&per_page=${PER_PAGE}`;
  const contacts = await fetchPage(path);

  const newContacts = contacts.filter((c) => c.created_at && c.created_at > since);
  if (!newContacts.length) return;

  let processed = 0;
  for (const contact of newContacts) {
    const key = `contact-new:${contact.id}`;
    if (shouldSkip(key)) continue;
    try {
      await handleNormalizeRutOnContactCreate(contact);
      markProcessed(key);
      processed++;
    } catch (err) {
      console.error(`[zaps-poller] normaliza-rut-contacto contact ${contact.id} failed:`, err.message);
    }
  }
  if (processed) console.log(`[zaps-poller] ${processed} new contacts processed`);

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
