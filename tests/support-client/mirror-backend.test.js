// Mirror backend tests — reads/writes must be served from the Zendesk
// primary, and the satellite should receive a best-effort mirrored call
// without affecting the primary result. Non-trivial diffs are POSTed to
// the satellite sync-log fire-and-forget.

import test from "node:test";
import assert from "node:assert/strict";

import { createMirrorBackend } from "../../support-client/mirror.js";
import {
  SATELLITE_ENV,
  ZENDESK_ENV,
  ZENDESK_FIXTURES
} from "./helpers.js";

function setup({ withSatellite = true } = {}) {
  const env = { ...ZENDESK_ENV, ...(withSatellite ? SATELLITE_ENV : {}) };
  const calls = [];
  const fetchStub = (url, init = {}) => {
    const host = new URL(String(url)).host;
    calls.push({ host, url: String(url), method: init.method || "GET", body: init.body ?? null });
    const primary = host.endsWith("zendesk.com");
    const body = primary ? ZENDESK_FIXTURES.user : ZENDESK_FIXTURES.user;
    return Promise.resolve({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(body);
      }
    });
  };
  const client = createMirrorBackend({ env, fetch: fetchStub });
  return { client, calls };
}

test("mirror GET returns Zendesk response and mirrors to satellite", async () => {
  const { client, calls } = setup();
  const data = await client.get("/api/v2/users/42.json");
  assert.deepEqual(data, ZENDESK_FIXTURES.user);

  // Drain any pending microtasks from the background mirror call.
  await new Promise((resolve) => setImmediate(resolve));

  const hosts = calls.map((c) => c.host);
  assert.ok(hosts.includes("clinyco.zendesk.com"), "zendesk call missing");
  assert.ok(
    hosts.includes("sell-medinet-backend.onrender.com"),
    "satellite call missing"
  );
});

test("mirror PUT returns Zendesk response and mirrors to satellite", async () => {
  const { client, calls } = setup();
  await client.put("/api/v2/users/42.json", {
    user: { user_fields: { rut: "13580388-K" } }
  });
  await new Promise((resolve) => setImmediate(resolve));

  const zCall = calls.find((c) => c.host.endsWith("zendesk.com"));
  const sCall = calls.find((c) => c.host.endsWith("onrender.com"));
  assert.ok(zCall);
  assert.ok(sCall);
  assert.equal(zCall.method, "PUT");
  assert.equal(sCall.method, "PUT");
  assert.equal(zCall.body, sCall.body, "mirror must send identical bodies");
});

test("mirror backend works even when satellite creds are missing", async () => {
  const { client, calls } = setup({ withSatellite: false });
  const data = await client.get("/api/v2/users/42.json");
  assert.deepEqual(data, ZENDESK_FIXTURES.user);

  await new Promise((resolve) => setImmediate(resolve));

  const satelliteCalls = calls.filter((c) => c.host.endsWith("onrender.com"));
  assert.equal(satelliteCalls.length, 0, "should skip satellite when unconfigured");
});

test("mirror supportGetByUrl only hits the primary", async () => {
  const { client, calls } = setup();
  await client.getByUrl("https://clinyco.zendesk.com/api/v2/users/42.json?page=2");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, "clinyco.zendesk.com");
});

// --- diff logging --------------------------------------------------------

function setupDiverging({ satelliteValue, satelliteStatus = 200 } = {}) {
  const env = { ...ZENDESK_ENV, ...SATELLITE_ENV };
  const calls = [];
  const fetchStub = (url, init = {}) => {
    const parsed = new URL(String(url));
    const host = parsed.host;
    const isSatellite = host === "sell-medinet-backend.onrender.com";
    const isSyncLog = isSatellite && parsed.pathname.endsWith("/api/v2/sync-log");

    let bodyParsed = null;
    if (init.body) {
      try {
        bodyParsed = JSON.parse(init.body);
      } catch {
        bodyParsed = null;
      }
    }
    calls.push({
      host,
      pathname: parsed.pathname,
      url: String(url),
      method: init.method || "GET",
      headers: { ...(init.headers || {}) },
      body: init.body ?? null,
      bodyParsed,
      isSyncLog
    });

    let status = 200;
    let payload;
    if (isSyncLog) {
      status = 201;
      payload = { entry: { id: 1, ...(bodyParsed?.entry ?? {}) } };
    } else if (isSatellite) {
      status = satelliteStatus;
      payload = satelliteValue;
    } else {
      payload = ZENDESK_FIXTURES.user;
    }

    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return payload == null ? "" : JSON.stringify(payload);
      }
    });
  };
  const client = createMirrorBackend({ env, fetch: fetchStub });
  return { client, calls };
}

async function drain() {
  // Multiple rounds cover: satelliteFetch → outcome.then → postSyncLog.fetch.
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("mirror POSTs a sync-log entry when satellite response diverges", async () => {
  const diverging = {
    user: { ...ZENDESK_FIXTURES.user.user, email: "DIFFERENT@example.com" }
  };
  const { client, calls } = setupDiverging({ satelliteValue: diverging });
  const data = await client.get("/api/v2/users/42.json");
  // Primary response is what the caller sees — Zendesk's.
  assert.deepEqual(data, ZENDESK_FIXTURES.user);

  await drain();

  const syncLog = calls.find((c) => c.isSyncLog);
  assert.ok(syncLog, "expected a sync-log POST when responses diverge");
  assert.equal(syncLog.method, "POST");
  assert.equal(syncLog.headers["X-API-Key"], "satellite-api-key");
  assert.equal(syncLog.headers["Content-Type"], "application/json");

  const entry = syncLog.bodyParsed?.entry;
  assert.ok(entry, "sync-log body missing entry");
  assert.equal(entry.entity, "users");
  assert.equal(entry.entity_id, "42");
  assert.equal(entry.op, "get");
  assert.equal(entry.source, "mirror-clinyco-ai");
  assert.deepEqual(entry.diff.primary, ZENDESK_FIXTURES.user);
  assert.deepEqual(entry.diff.secondary, diverging);
});

test("mirror does NOT POST sync-log when responses match", async () => {
  const { client, calls } = setupDiverging({ satelliteValue: ZENDESK_FIXTURES.user });
  await client.get("/api/v2/users/42.json");
  await drain();

  const syncLog = calls.find((c) => c.isSyncLog);
  assert.equal(syncLog, undefined, "sync-log must not fire on identical responses");
});

test("mirror logs satellite error as a diff", async () => {
  const { client, calls } = setupDiverging({
    satelliteValue: { error: "boom" },
    satelliteStatus: 500
  });
  await client.put("/api/v2/tickets/7001.json", {
    ticket: { status: "solved" }
  });
  await drain();

  const syncLog = calls.find((c) => c.isSyncLog);
  assert.ok(syncLog, "expected sync-log POST when satellite errors");
  const entry = syncLog.bodyParsed?.entry;
  assert.equal(entry.entity, "tickets");
  assert.equal(entry.entity_id, "7001");
  assert.equal(entry.op, "put");
  assert.ok(entry.diff.secondary_error, "diff should include secondary_error");
});

test("mirror sync-log POST failure never surfaces to caller", async () => {
  const env = { ...ZENDESK_ENV, ...SATELLITE_ENV };
  const fetchStub = (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/api/v2/sync-log")) {
      return Promise.reject(new Error("sync-log endpoint offline"));
    }
    const isSatellite = parsed.host === "sell-medinet-backend.onrender.com";
    const body = isSatellite
      ? { user: { ...ZENDESK_FIXTURES.user.user, email: "x@y.z" } }
      : ZENDESK_FIXTURES.user;
    return Promise.resolve({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(body);
      }
    });
  };
  const client = createMirrorBackend({ env, fetch: fetchStub });
  const data = await client.get("/api/v2/users/42.json");
  assert.deepEqual(data, ZENDESK_FIXTURES.user);
  // Drain — any unhandled rejection would throw in the test runner.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
});
