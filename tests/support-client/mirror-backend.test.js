// Mirror backend tests — reads/writes must be served from the Zendesk
// primary, and the satellite should receive a best-effort mirrored call
// without affecting the primary result.

import test from "node:test";
import assert from "node:assert/strict";

import { createMirrorBackend } from "../../support-client/mirror.js";
import {
  SATELLITE_ENV,
  ZENDESK_ENV,
  ZENDESK_FIXTURES,
  makeFetchStub
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
