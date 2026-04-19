import test from "node:test";
import assert from "node:assert/strict";

import { createSatelliteBackend } from "../../support-client/satellite.js";
import { SATELLITE_ENV, ZENDESK_FIXTURES, makeFetchStub } from "./helpers.js";

function makeClient(overrides = {}) {
  const fetchStub = makeFetchStub();
  const client = createSatelliteBackend({
    env: { ...SATELLITE_ENV, ...overrides },
    fetch: fetchStub
  });
  return { client, fetchStub };
}

test("satellite supportGet composes base URL with X-API-Key", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.replyJson(ZENDESK_FIXTURES.user);

  const data = await client.get("/api/v2/users/42.json");
  assert.deepEqual(data, ZENDESK_FIXTURES.user);

  const call = fetchStub.calls[0];
  assert.equal(
    call.url,
    "https://sell-medinet-backend.onrender.com/support/api/v2/users/42.json"
  );
  assert.equal(call.method, "GET");
  assert.equal(call.headers["X-API-Key"], "satellite-api-key");
  assert.equal(call.headers["Content-Type"], "application/json");
  // Satellite must NOT leak a Basic/Zendesk Authorization header.
  assert.equal(call.headers.Authorization, undefined);
});

test("satellite supportGet serializes params (empty-value skipping)", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.replyJson(ZENDESK_FIXTURES.userSearch);

  await client.get("/api/v2/users/search.json", {
    query: 'email:"jane@example.com"',
    page: 1,
    blank: "",
    nullish: null,
    undef: undefined
  });

  const url = new URL(fetchStub.calls[0].url);
  assert.equal(url.searchParams.get("query"), 'email:"jane@example.com"');
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.has("blank"), false);
  assert.equal(url.searchParams.has("nullish"), false);
  assert.equal(url.searchParams.has("undef"), false);
});

test("satellite supportPost sends JSON body", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.replyJson(ZENDESK_FIXTURES.ticket);

  const body = { ticket: { subject: "Hola", requester_id: 42 } };
  await client.post("/api/v2/tickets", body);

  const call = fetchStub.calls[0];
  assert.equal(call.method, "POST");
  assert.equal(
    call.url,
    "https://sell-medinet-backend.onrender.com/support/api/v2/tickets"
  );
  assert.equal(call.body, JSON.stringify(body));
});

test("satellite supportPut accepts .json suffix (middleware strips it)", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.replyJson(ZENDESK_FIXTURES.ticket);

  await client.put("/api/v2/tickets/7001.json", {
    ticket: { status: "solved" }
  });

  const call = fetchStub.calls[0];
  assert.equal(call.method, "PUT");
  assert.equal(
    call.url,
    "https://sell-medinet-backend.onrender.com/support/api/v2/tickets/7001.json"
  );
});

test("satellite supportGetByUrl validates host", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.replyJson(ZENDESK_FIXTURES.ticketAudits);

  await client.getByUrl(
    "https://sell-medinet-backend.onrender.com/support/api/v2/tickets/7001/audits?page=2"
  );
  assert.equal(
    fetchStub.calls[0].url,
    "https://sell-medinet-backend.onrender.com/support/api/v2/tickets/7001/audits?page=2"
  );

  await assert.rejects(
    client.getByUrl("https://clinyco.zendesk.com/api/v2/users/42.json"),
    /Unexpected satellite host/
  );
});

test("satellite backend requires base URL and API key", async () => {
  const noBase = createSatelliteBackend({
    env: { SUPPORT_SATELLITE_API_KEY: "k" },
    fetch: makeFetchStub()
  });
  await assert.rejects(
    noBase.get("/api/v2/users/1"),
    /Missing SUPPORT_SATELLITE_BASE_URL/
  );

  const noKey = createSatelliteBackend({
    env: { SUPPORT_SATELLITE_BASE_URL: SATELLITE_ENV.SUPPORT_SATELLITE_BASE_URL },
    fetch: makeFetchStub()
  });
  await assert.rejects(
    noKey.get("/api/v2/users/1"),
    /Missing SUPPORT_SATELLITE_API_KEY/
  );
});

test("satellite backend surfaces HTTP errors with body", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.reply(404, { error: "RecordNotFound" });
  await assert.rejects(
    client.get("/api/v2/users/99999"),
    /Support satellite request failed: 404/
  );
});
