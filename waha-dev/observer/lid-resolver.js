// WAHA Lids API resolver.
//
// Maps WhatsApp "@lid" identifiers to their real phone number using WAHA's
// Lids API. WhatsApp finalized its LID rollout in 2026 — a LID is the hidden
// identity that WhatsApp now assigns to every user to keep phone numbers
// private in public groups and to prepare for the upcoming @username system.
// LIDs and phone numbers have a 1:1 mapping (today), and WAHA exposes it via:
//
//   GET /api/{session}/lids           — paginated list of all known mappings
//   GET /api/{session}/lids/count     — count of known mappings
//   GET /api/{session}/lids/{lid}     — single LID → phone lookup
//   GET /api/{session}/lids/pn/{pn}   — reverse lookup (phone → LID)
//
// Response shape (for both directions):
//   { "lid": "493934466220512@lid", "pn": "56987297033@c.us" }
//   { "lid": "493934466220512@lid", "pn": null }   ← not in contact list
//
// Docs: https://waha.devlike.pro/docs/how-to/contacts/#api---lids
//
// Strategy:
//   • On observer startup we do a bulk preload via /lids?limit=500&offset=N
//     for every agent WAHA instance, so the in-memory cache is warm before
//     the first webhook.
//   • On each new LID conversation the matcher calls resolveLid(); a cache
//     hit returns instantly, a miss does a single GET /lids/{digits}.
//   • Negative results (pn=null) are cached too so we don't hammer the
//     endpoint for the same unknown LID on every message.

import { AGENT_WAHA_HOSTS, WAHA_SESSION_NAME } from "./agent-phones.js";

const API_KEY = process.env.WAHA_API_KEY || "";

// sessionName → Map<lidDigits, phoneDigitsOrNull>
// We store raw digits (no "+", no "@c.us") so the caller can normalize with
// the same rules it uses for @c.us chats.
const cacheBySession = new Map();

function getCache(sessionName) {
  let cache = cacheBySession.get(sessionName);
  if (!cache) {
    cache = new Map();
    cacheBySession.set(sessionName, cache);
  }
  return cache;
}

function extractDigits(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits || null;
}

async function wahaGet(host, path) {
  const url = `http://${host}:3000${path}`;
  const res = await fetch(url, {
    headers: { "X-Api-Key": API_KEY },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    const body = await res.text().catch(() => "");
    throw new Error(
      `${url} → ${res.status} ${res.statusText} ${body.slice(0, 200)}`
    );
  }
  return res.json();
}

/**
 * Resolve a single LID to a phone number digits string (e.g. "56987297033").
 * Returns null if unknown (contact not in agent's phone book).
 *
 * `lid` can be passed as:
 *   • "493934466220512@lid"
 *   • "lid:493934466220512"
 *   • "493934466220512"
 */
export async function resolveLid(sessionName, lid) {
  const digits = extractDigits(lid);
  if (!digits) return null;

  const host = AGENT_WAHA_HOSTS[sessionName];
  if (!host) return null;

  const cache = getCache(sessionName);
  if (cache.has(digits)) return cache.get(digits);

  try {
    const data = await wahaGet(
      host,
      `/api/${WAHA_SESSION_NAME}/lids/${digits}`
    );
    const pnDigits = extractDigits(data?.pn);
    cache.set(digits, pnDigits);
    if (pnDigits) {
      console.log(
        `[lid-resolver] ${sessionName} ${digits}@lid → ${pnDigits} (miss)`
      );
    }
    return pnDigits;
  } catch (err) {
    console.warn(
      `[lid-resolver] ${sessionName} ${digits}@lid resolve error: ${err.message}`
    );
    return null;
  }
}

/**
 * Bulk preload the LID cache for one session via paginated /lids.
 * Returns the number of mappings loaded.
 */
export async function refreshLidCache(sessionName) {
  const host = AGENT_WAHA_HOSTS[sessionName];
  if (!host) return 0;

  const cache = getCache(sessionName);
  const limit = 500;
  let offset = 0;
  let loaded = 0;
  let withPhone = 0;

  for (;;) {
    let page;
    try {
      page = await wahaGet(
        host,
        `/api/${WAHA_SESSION_NAME}/lids?limit=${limit}&offset=${offset}`
      );
    } catch (err) {
      console.warn(
        `[lid-resolver] ${sessionName} bulk fetch error at offset=${offset}: ${err.message}`
      );
      break;
    }

    if (!Array.isArray(page) || page.length === 0) break;

    for (const entry of page) {
      const lidDigits = extractDigits(entry?.lid);
      if (!lidDigits) continue;
      const pnDigits = extractDigits(entry?.pn);
      cache.set(lidDigits, pnDigits);
      loaded++;
      if (pnDigits) withPhone++;
    }

    if (page.length < limit) break;
    offset += limit;
  }

  console.log(
    `[lid-resolver] ${sessionName}: preloaded ${loaded} LID mappings ` +
      `(${withPhone} with phone, ${loaded - withPhone} unresolved)`
  );
  return loaded;
}

/** Preload caches for every known WAHA instance in parallel. */
export async function refreshAllLidCaches() {
  const names = Object.keys(AGENT_WAHA_HOSTS);
  await Promise.all(
    names.map((name) =>
      refreshLidCache(name).catch((err) =>
        console.error(
          `[lid-resolver] ${name} refresh failed: ${err.message}`
        )
      )
    )
  );
}

/** Return the count of cached entries for a session (useful for /health). */
export function getCachedLidCount(sessionName) {
  return getCache(sessionName).size;
}

/** Expose the raw cache for debugging / the retro cleanup script. */
export function getLidCache(sessionName) {
  return getCache(sessionName);
}
