// Mirror backend — dual-call with diff logging to sync-log.
//
// Reads and writes go to Zendesk (primary) and the mirror always returns the
// Zendesk result. The same call is issued in parallel to the satellite; when
// the satellite response diverges from Zendesk (or the satellite call fails)
// the difference is POSTed to $SUPPORT_SATELLITE_BASE_URL/api/v2/sync-log.
// Everything satellite-side is fire-and-forget: a failure there never affects
// the caller's Zendesk-backed response.
//
// The flag stays at SUPPORT_BACKEND=zendesk in production. Mirror mode is a
// pre-flip observability step: we compare responses for ~48h, review
// sync_log, and only then promote the satellite to primary.

import { createZendeskBackend } from "./zendesk.js";
import { createSatelliteBackend } from "./satellite.js";

const SOURCE = "mirror-clinyco-ai";

// Extract (entity, entity_id) from a Zendesk-style path. Keeps sync_log rows
// groupable in the satellite UI.
//   /api/v2/users/42.json              -> users           / 42
//   /api/v2/users/42/identities.json   -> user_identities / 42
//   /api/v2/tickets.json               -> tickets         / null
//   /api/v2/tickets/7001.json          -> tickets         / 7001
//   /api/v2/tickets/7001/comments.json -> ticket_comments / 7001
//   /api/v2/users/search.json          -> users_search    / null
//   /api/v2/search.json                -> search          / null
export function parseEntity(path) {
  if (!path) return { entity: "unknown", entity_id: null };
  const noQs = String(path).split("?")[0];
  const noExt = noQs.replace(/\.json$/i, "");
  const parts = noExt.split("/").filter(Boolean);
  const apiIdx = parts.indexOf("api");
  const tail = apiIdx >= 0 ? parts.slice(apiIdx + 2) : parts;
  if (tail.length === 0) return { entity: "unknown", entity_id: null };

  const primary = tail[0];
  if (tail.length === 1) return { entity: primary, entity_id: null };

  const second = tail[1];
  const secondIsId = /^[0-9]+$/.test(second);
  if (!secondIsId) {
    return { entity: `${primary}_${second}`, entity_id: null };
  }
  if (tail.length === 2) return { entity: primary, entity_id: second };

  const sub = tail[2];
  const singular = primary.endsWith("s") ? primary.slice(0, -1) : primary;
  return { entity: `${singular}_${sub}`, entity_id: second };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

export function computeDiff(primary, secondary) {
  if (deepEqual(primary, secondary)) return null;
  return { primary, secondary };
}

function syncLogUrl(baseUrl) {
  return `${String(baseUrl).replace(/\/+$/, "")}/api/v2/sync-log`;
}

async function postSyncLog({ fetch, env, op, path, primaryResult, secondaryOutcome }) {
  const baseUrl = env.SUPPORT_SATELLITE_BASE_URL;
  const apiKey = env.SUPPORT_SATELLITE_API_KEY;
  if (!baseUrl || !apiKey) return;

  const diff = secondaryOutcome.ok
    ? computeDiff(primaryResult, secondaryOutcome.value)
    : {
        primary: primaryResult,
        secondary_error: String(
          secondaryOutcome.error?.message || secondaryOutcome.error
        )
      };

  if (!diff) return;

  const { entity, entity_id } = parseEntity(path);

  await fetch(syncLogUrl(baseUrl), {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      entry: { entity, entity_id, op, source: SOURCE, diff }
    })
  });
}

export function createMirrorBackend({ env = process.env, fetch = globalThis.fetch } = {}) {
  const primary = createZendeskBackend({ env, fetch });
  // Satellite is constructed lazily so missing satellite creds don't break
  // mirror mode while the satellite is still being rolled out.
  let secondary = null;
  function getSecondary() {
    if (secondary) return secondary;
    try {
      secondary = createSatelliteBackend({ env, fetch });
    } catch {
      secondary = null;
    }
    return secondary;
  }

  function scheduleCompare({ op, path, primaryResult, secondaryPromise }) {
    secondaryPromise
      .then((outcome) =>
        postSyncLog({ fetch, env, op, path, primaryResult, secondaryOutcome: outcome })
      )
      .catch((err) => {
        if (env.SUPPORT_MIRROR_DEBUG === "1") {
          console.warn(
            `[support-client:mirror] compare/log failed:`,
            err?.message || err
          );
        }
      });
  }

  async function dual(op, method, path, extra) {
    const sat = getSecondary();

    const primaryPromise = primary[method](path, extra);

    // Kick off the satellite call in parallel. Attach the outcome mapper
    // immediately so the satellite promise never rejects — that way a
    // satellite failure can never surface as an unhandled rejection on the
    // caller's event loop.
    const secondaryPromise = sat
      ? sat[method](path, extra).then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error })
        )
      : null;

    const primaryResult = await primaryPromise;

    if (secondaryPromise) {
      scheduleCompare({ op, path, primaryResult, secondaryPromise });
    }

    return primaryResult;
  }

  return {
    backend: "mirror",
    async get(path, params) {
      return dual("get", "get", path, params);
    },
    async post(path, body) {
      return dual("post", "post", path, body);
    },
    async put(path, body) {
      return dual("put", "put", path, body);
    },
    async getByUrl(url) {
      // Follow-page URLs are Zendesk-specific and would not round-trip
      // through the satellite cleanly, so they stay primary-only.
      return primary.getByUrl(url);
    }
  };
}
