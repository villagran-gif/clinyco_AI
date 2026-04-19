// Mirror backend — dual-write scaffolding.
//
// For reads: serves from Zendesk (primary) and kicks off an async
// comparison read against the satellite, logging diffs to support.sync_log.
// For writes: writes to Zendesk (primary) and mirrors to the satellite;
// diffs on response go to support.sync_log.
//
// This is phase-next work. The handler is wired so the env flag resolves,
// but the diff-logging path is a stub until migrations/sync_log exist. Until
// then it behaves like the Zendesk backend — i.e. it is safe to leave
// dormant in production without side effects on the satellite.

import { createZendeskBackend } from "./zendesk.js";
import { createSatelliteBackend } from "./satellite.js";

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

  async function mirror(fn, args) {
    const sat = getSecondary();
    if (!sat) return;
    try {
      await sat[fn](...args);
    } catch (err) {
      // Diff/error logging to support.sync_log lands in the next PR. For
      // now the primary result is authoritative and secondary errors are
      // swallowed to avoid affecting the current Zendesk path.
      if (env.SUPPORT_MIRROR_DEBUG === "1") {
        console.warn(`[support-client:mirror] ${fn} failed on satellite:`, err?.message || err);
      }
    }
  }

  return {
    backend: "mirror",
    async get(path, params) {
      const result = await primary.get(path, params);
      mirror("get", [path, params]);
      return result;
    },
    async post(path, body) {
      const result = await primary.post(path, body);
      mirror("post", [path, body]);
      return result;
    },
    async put(path, body) {
      const result = await primary.put(path, body);
      mirror("put", [path, body]);
      return result;
    },
    async getByUrl(url) {
      return primary.getByUrl(url);
    }
  };
}
