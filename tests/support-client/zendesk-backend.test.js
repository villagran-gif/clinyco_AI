import test from "node:test";
import assert from "node:assert/strict";

import { createZendeskBackend } from "../../support-client/zendesk.js";
import { ZENDESK_ENV, ZENDESK_FIXTURES, makeFetchStub } from "./helpers.js";

function makeClient(overrides = {}) {
  const fetchStub = makeFetchStub();
  const client = createZendeskBackend({
    env: { ...ZENDESK_ENV, ...overrides },
    fetch: fetchStub
  });
  return { client, fetchStub };
}

test("zendesk backend composes subdomain URL and Basic auth", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.replyJson(ZENDESK_FIXTURES.user);

  const data = await client.get("/api/v2/users/42.json");
  assert.deepEqual(data, ZENDESK_FIXTURES.user);

  const call = fetchStub.calls[0];
  assert.equal(call.url, "https://clinyco.zendesk.com/api/v2/users/42.json");
  assert.equal(call.method, "GET");
  const expected = `Basic ${Buffer.from("ops@clinyco.test/token:zendesk-token").toString("base64")}`;
  assert.equal(call.headers.Authorization, expected);
  assert.equal(call.headers["Content-Type"], "application/json");
});

test("zendesk supportGet serializes non-empty params only", async () => {
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

test("zendesk supportPost sends JSON body", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.replyJson(ZENDESK_FIXTURES.ticket);

  const body = { ticket: { subject: "Hola", requester_id: 42 } };
  const data = await client.post("/api/v2/tickets.json", body);
  assert.deepEqual(data, ZENDESK_FIXTURES.ticket);

  const call = fetchStub.calls[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://clinyco.zendesk.com/api/v2/tickets.json");
  assert.equal(call.body, JSON.stringify(body));
});

test("zendesk supportPut sends JSON body", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.replyJson(ZENDESK_FIXTURES.ticket);

  const body = { ticket: { status: "solved", comment: { body: "done", public: false } } };
  await client.put("/api/v2/tickets/7001.json", body);

  const call = fetchStub.calls[0];
  assert.equal(call.method, "PUT");
  assert.equal(call.url, "https://clinyco.zendesk.com/api/v2/tickets/7001.json");
  assert.equal(call.body, JSON.stringify(body));
});

test("zendesk supportGetByUrl validates host", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.replyJson(ZENDESK_FIXTURES.ticketAudits);

  await client.getByUrl("https://clinyco.zendesk.com/api/v2/tickets/7001/audits.json?page=2");
  assert.equal(
    fetchStub.calls[0].url,
    "https://clinyco.zendesk.com/api/v2/tickets/7001/audits.json?page=2"
  );

  await assert.rejects(
    client.getByUrl("https://evil.example.com/api/v2/users/42.json"),
    /Unexpected Zendesk host/
  );
});

test("zendesk backend throws on missing config", async () => {
  const { client } = makeClient({ ZENDESK_SUBDOMAIN: "" });
  await assert.rejects(client.get("/api/v2/users/1.json"), /Missing ZENDESK_SUBDOMAIN/);

  const client2 = createZendeskBackend({
    env: { ZENDESK_SUBDOMAIN: "clinyco" },
    fetch: makeFetchStub()
  });
  await assert.rejects(
    client2.get("/api/v2/users/1.json"),
    /Missing ZENDESK_SUPPORT_EMAIL or ZENDESK_SUPPORT_TOKEN/
  );
});

test("zendesk backend surfaces HTTP errors with body", async () => {
  const { client, fetchStub } = makeClient();
  fetchStub.reply(422, { error: "RecordInvalid" });
  await assert.rejects(
    client.put("/api/v2/users/42.json", { user: { email: "bad" } }),
    /Zendesk Support request failed: 422/
  );
});
