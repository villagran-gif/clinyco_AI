// Contract tests — both backends must accept the same inputs and, given
// identical HTTP responses, return identical JSON payloads with the Zendesk
// shape. The satellite is a 1:1 mirror of Zendesk Support API, so these
// tests lock in that equivalence at the support-client boundary.

import test from "node:test";
import assert from "node:assert/strict";

import { createZendeskBackend } from "../../support-client/zendesk.js";
import { createSatelliteBackend } from "../../support-client/satellite.js";
import {
  SATELLITE_ENV,
  ZENDESK_ENV,
  ZENDESK_FIXTURES,
  makeFetchStub
} from "./helpers.js";

function makePair() {
  const zStub = makeFetchStub();
  const sStub = makeFetchStub();
  return {
    zendesk: createZendeskBackend({ env: ZENDESK_ENV, fetch: zStub }),
    satellite: createSatelliteBackend({ env: SATELLITE_ENV, fetch: sStub }),
    zStub,
    sStub
  };
}

async function assertSameShape(pair, runner, fixture) {
  pair.zStub.replyJson(fixture);
  pair.sStub.replyJson(fixture);
  const [zOut, sOut] = await Promise.all([
    runner(pair.zendesk),
    runner(pair.satellite)
  ]);
  assert.deepEqual(zOut, sOut, "backend responses diverged");
  assert.deepEqual(zOut, fixture, "zendesk backend mutated the payload");
  assert.deepEqual(sOut, fixture, "satellite backend mutated the payload");
}

test("contract: GET /api/v2/users/:id returns { user: {...} }", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) => b.get("/api/v2/users/42.json"),
    ZENDESK_FIXTURES.user
  );
});

test("contract: GET /api/v2/users/:id/identities returns { identities, count, ... }", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) => b.get("/api/v2/users/42/identities.json"),
    ZENDESK_FIXTURES.identities
  );
});

test("contract: POST /api/v2/users/:id/identities returns { identity } envelope", async () => {
  const pair = makePair();
  const response = {
    identity: { id: 3, type: "email", value: "new@example.com", verified: false, primary: false }
  };
  await assertSameShape(
    pair,
    (b) =>
      b.post("/api/v2/users/42/identities.json", {
        identity: { type: "email", value: "new@example.com" }
      }),
    response
  );
});

test("contract: PUT /api/v2/users/:id returns { user } envelope", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) =>
      b.put("/api/v2/users/42.json", {
        user: { user_fields: { rut: "13580388-K" } }
      }),
    ZENDESK_FIXTURES.user
  );
});

test("contract: GET /api/v2/users/search?query=... returns { users, count, next_page, previous_page }", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) =>
      b.get("/api/v2/users/search.json", {
        query: 'email:"jane@example.com"'
      }),
    ZENDESK_FIXTURES.userSearch
  );
});

test("contract: POST /api/v2/tickets returns { ticket, audit } envelope", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) =>
      b.post("/api/v2/tickets.json", {
        ticket: {
          subject: "Hola",
          comment: { body: "hola", public: false },
          requester_id: 42,
          tags: ["whatsapp"]
        }
      }),
    ZENDESK_FIXTURES.ticket
  );
});

test("contract: GET /api/v2/tickets/:id returns { ticket }", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) => b.get("/api/v2/tickets/7001.json"),
    { ticket: ZENDESK_FIXTURES.ticket.ticket }
  );
});

test("contract: PUT /api/v2/tickets/:id returns { ticket, audit }", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) =>
      b.put("/api/v2/tickets/7001.json", {
        ticket: {
          status: "solved",
          comment: { body: "done", public: false }
        }
      }),
    ZENDESK_FIXTURES.ticket
  );
});

test("contract: GET /api/v2/tickets/:id/audits returns { audits, count, next_page, previous_page }", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) => b.get("/api/v2/tickets/7001/audits.json"),
    ZENDESK_FIXTURES.ticketAudits
  );
});

test("contract: GET /api/v2/tickets/:id/comments returns { comments, count, ... }", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) => b.get("/api/v2/tickets/7001/comments.json"),
    ZENDESK_FIXTURES.ticketComments
  );
});

test("contract: GET /api/v2/search?query=type:ticket returns { results, count, ... }", async () => {
  const pair = makePair();
  await assertSameShape(
    pair,
    (b) =>
      b.get("/api/v2/search.json", {
        query: "type:ticket status:open"
      }),
    ZENDESK_FIXTURES.searchTickets
  );
});

test("contract: both backends send the same HTTP method and body for writes", async () => {
  const pair = makePair();
  pair.zStub.replyJson(ZENDESK_FIXTURES.ticket);
  pair.sStub.replyJson(ZENDESK_FIXTURES.ticket);

  const payload = {
    ticket: {
      subject: "Hola",
      comment: { body: "hola", public: false },
      requester_id: 42
    }
  };
  await pair.zendesk.post("/api/v2/tickets.json", payload);
  await pair.satellite.post("/api/v2/tickets.json", payload);

  assert.equal(pair.zStub.calls[0].method, pair.sStub.calls[0].method);
  assert.equal(pair.zStub.calls[0].body, pair.sStub.calls[0].body);
  // Content-Type must be JSON on both, but auth headers legitimately differ.
  assert.equal(pair.zStub.calls[0].headers["Content-Type"], "application/json");
  assert.equal(pair.sStub.calls[0].headers["Content-Type"], "application/json");
});

test("contract: query param serialization (empty/null skipping) matches", async () => {
  const pair = makePair();
  pair.zStub.replyJson(ZENDESK_FIXTURES.userSearch);
  pair.sStub.replyJson(ZENDESK_FIXTURES.userSearch);

  const params = { query: "name:\"Jane\"", page: 1, blank: "", nullish: null };
  await pair.zendesk.get("/api/v2/users/search.json", params);
  await pair.satellite.get("/api/v2/users/search.json", params);

  const zParams = new URL(pair.zStub.calls[0].url).searchParams;
  const sParams = new URL(pair.sStub.calls[0].url).searchParams;
  assert.deepEqual([...zParams.entries()].sort(), [...sParams.entries()].sort());
});
