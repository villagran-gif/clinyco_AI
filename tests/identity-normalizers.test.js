import test from "node:test";
import assert from "node:assert/strict";

import {
  validateRut,
  normalizeRut,
  extractRut,
  normalizePhone
} from "../extraction/identity-normalizers.js";

test("validateRut accepts a valid Chilean RUT", () => {
  assert.equal(validateRut("13.580.388-K"), true);
  assert.equal(normalizeRut("13.580.388-K"), "13580388-K");
});

test("validateRut rejects invalid verifier digits", () => {
  assert.equal(validateRut("13.580.388-1"), false);
  assert.equal(normalizeRut("13.580.388-1"), null);
});

test("extractRut skips invalid matches and returns the first valid one", () => {
  const text = "mi rut viejo era 13.580.388-1 pero el correcto es 13.580.388-K";
  assert.equal(extractRut(text), "13580388-K");
});

test("normalizePhone formats whatsapp numbers consistently", () => {
  assert.equal(normalizePhone("56987654321"), "+56987654321");
  assert.equal(normalizePhone("987654321"), "+56987654321");
});
