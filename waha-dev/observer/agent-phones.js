// Discovers and caches agent (self) phone numbers from the WAHA instances.
// Used to filter out agent-to-agent conversations from data capture.
//
// The "me" phone of each WAHA session is available at `GET /api/sessions`
// as `session.me.id` (format "56912345678@c.us" or "56912345678:12@c.us").
//
// On observer startup we hit each WAHA instance once, populate an in-memory
// Set, and persist the discovered phone to `agent_waha_sessions.agent_phone`
// so the cleanup SQL and other tools can reuse it.

import * as db from "./db.js";

// Same registry as backfill.js / server.js — Zendesk ID → WAHA docker host.
// Exported so the LID resolver (and any other module that needs to reach
// the per-agent WAHA instance) can reuse it without duplicating the mapping.
export const AGENT_WAHA_HOSTS = {
  "39403066594317": "waha-gabriela",
  "29866913338893": "waha-allison",
  "30229490880397": "waha-carolin",
  "30229583958797": "waha-camila",
  "13578942560141": "waha-giselle",
  // Sandbox: NOWEB engine on a test phone. Isolated from production
  // by session_name; remove once the NOWEB migration decision is made.
  "test-noweb": "waha-test",
};

// Hardcoded fallback — used if WAHA discovery fails for an instance.
// Confirmed by the user.
const KNOWN_AGENT_PHONES = [
  "+56973763009", // Carolin Cornejo
  "+56944547790", // Gabriela Heck
];

const API_KEY = process.env.WAHA_API_KEY || "";
// WAHA session name — same for every agent, since each WAHA instance
// only has the single "default" session bound to its corporate phone.
export const WAHA_SESSION_NAME = "default";
const SESSION_NAME = WAHA_SESSION_NAME;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

let cache = new Set(KNOWN_AGENT_PHONES);
let lastRefresh = 0;

function normalizeRawPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  return `+${digits}`;
}

async function fetchAgentPhoneFromWaha(host) {
  try {
    const res = await fetch(`http://${host}:3000/api/sessions`, {
      headers: { "X-Api-Key": API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const sessions = await res.json();
    const session = Array.isArray(sessions)
      ? sessions.find((s) => s.name === SESSION_NAME)
      : null;
    if (!session?.me?.id) return null;
    // me.id format: "56912345678@c.us" or "56912345678:12@c.us" (device id suffix)
    const raw = session.me.id.split("@")[0].split(":")[0];
    return normalizeRawPhone(raw);
  } catch (err) {
    console.error(`[agent-phones] ${host} fetch failed: ${err.message}`);
    return null;
  }
}

/** Query every WAHA instance, refresh cache, and persist phones to DB. */
export async function refreshAgentPhones() {
  const phones = new Set(KNOWN_AGENT_PHONES);

  for (const [agentId, host] of Object.entries(AGENT_WAHA_HOSTS)) {
    const phone = await fetchAgentPhoneFromWaha(host);
    if (phone) {
      phones.add(phone);
      try {
        await db.pool.query(
          `UPDATE agent_waha_sessions SET agent_phone = $1 WHERE session_name = $2`,
          [phone, agentId]
        );
      } catch (err) {
        console.error(
          `[agent-phones] DB update failed for ${agentId}: ${err.message}`
        );
      }
    }
  }

  cache = phones;
  lastRefresh = Date.now();
  console.log(
    `[agent-phones] Refreshed: ${phones.size} phones → ${[...phones].join(", ")}`
  );
  return phones;
}

/** Synchronous check. Cache is pre-populated with KNOWN_AGENT_PHONES. */
export function isAgentPhone(phone) {
  return cache.has(phone);
}

export function getAgentPhones() {
  return new Set(cache);
}

/** Schedules background refresh every 10 min. Returns the timer. */
export function startAgentPhoneRefresh() {
  const timer = setInterval(() => {
    refreshAgentPhones().catch((err) =>
      console.error("[agent-phones] background refresh error:", err.message)
    );
  }, REFRESH_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
