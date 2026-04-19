import test from "node:test";
import assert from "node:assert/strict";

import {
  createSupportClient,
  resolveSupportBackend
} from "../../support-client/index.js";
import { SATELLITE_ENV, ZENDESK_ENV, makeFetchStub } from "./helpers.js";

test("resolveSupportBackend defaults to zendesk", () => {
  assert.equal(resolveSupportBackend({}), "zendesk");
  assert.equal(resolveSupportBackend({ SUPPORT_BACKEND: "" }), "zendesk");
});

test("resolveSupportBackend accepts all three modes", () => {
  assert.equal(resolveSupportBackend({ SUPPORT_BACKEND: "zendesk" }), "zendesk");
  assert.equal(resolveSupportBackend({ SUPPORT_BACKEND: "SATELLITE" }), "satellite");
  assert.equal(resolveSupportBackend({ SUPPORT_BACKEND: "Mirror" }), "mirror");
});

test("resolveSupportBackend rejects unknown values", () => {
  assert.throws(() => resolveSupportBackend({ SUPPORT_BACKEND: "bogus" }), /Unknown SUPPORT_BACKEND/);
});

test("createSupportClient returns zendesk backend by default", () => {
  const fetchStub = makeFetchStub();
  const client = createSupportClient({ env: { ...ZENDESK_ENV }, fetch: fetchStub });
  assert.equal(client.backend, "zendesk");
});

test("createSupportClient selects satellite when flagged", () => {
  const fetchStub = makeFetchStub();
  const client = createSupportClient({
    env: { ...SATELLITE_ENV, SUPPORT_BACKEND: "satellite" },
    fetch: fetchStub
  });
  assert.equal(client.backend, "satellite");
});

test("createSupportClient selects mirror when flagged", () => {
  const fetchStub = makeFetchStub();
  const client = createSupportClient({
    env: { ...ZENDESK_ENV, ...SATELLITE_ENV, SUPPORT_BACKEND: "mirror" },
    fetch: fetchStub
  });
  assert.equal(client.backend, "mirror");
});
