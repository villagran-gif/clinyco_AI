// Support client — backend dispatcher.
//
// Chooses between the legacy Zendesk Support API and the sell-medinet-backend
// satellite (1:1 mirror of Zendesk shape) based on SUPPORT_BACKEND. The client
// is currently dormant: nothing in server.js calls it yet. Flipping the flag
// is a separate step.
//
// Backends:
//   zendesk   (default) — talks to https://<ZENDESK_SUBDOMAIN>.zendesk.com
//   satellite           — talks to SUPPORT_SATELLITE_BASE_URL with X-API-Key
//   mirror              — dual-write to both, diff in support.sync_log (stub)
//
// All backends expose the same four functions:
//   get(path, params?) -> json
//   post(path, body)   -> json
//   put(path, body)    -> json
//   getByUrl(url)      -> json
//
// Paths use Zendesk form (e.g. "/api/v2/users/123.json"). The `.json` suffix
// is accepted by both backends; the satellite middleware strips it.

import { createZendeskBackend } from "./zendesk.js";
import { createSatelliteBackend } from "./satellite.js";
import { createMirrorBackend } from "./mirror.js";

export function resolveSupportBackend(env = process.env) {
  const raw = (env.SUPPORT_BACKEND || "zendesk").toLowerCase().trim();
  if (raw !== "zendesk" && raw !== "satellite" && raw !== "mirror") {
    throw new Error(`Unknown SUPPORT_BACKEND: ${env.SUPPORT_BACKEND}`);
  }
  return raw;
}

export function createSupportClient(options = {}) {
  const env = options.env || process.env;
  const backend = options.backend || resolveSupportBackend(env);
  const fetchImpl = options.fetch || globalThis.fetch;

  switch (backend) {
    case "zendesk":
      return createZendeskBackend({ env, fetch: fetchImpl });
    case "satellite":
      return createSatelliteBackend({ env, fetch: fetchImpl });
    case "mirror":
      return createMirrorBackend({ env, fetch: fetchImpl });
    default:
      throw new Error(`Unknown SUPPORT_BACKEND: ${backend}`);
  }
}

export { createZendeskBackend, createSatelliteBackend, createMirrorBackend };
