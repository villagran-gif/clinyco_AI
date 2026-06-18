import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchProximosCuposAll } from "../Antonia/medinet-api.js";

// Minimal Response-like stub for the global fetch mock.
function makeRes({ status, json, text }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => (json !== undefined ? "application/json" : "text/html") },
    json: async () => json,
    text: async () => text ?? "",
  };
}

function withFetchMock(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(calls.length, { url, options });
  };
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(() => { globalThis.fetch = original; });
}

const SUCCESS = [{ id: 57, nombres: "Camila", paterno: "Alcayaga Toro", cupos: [] }];
const FORBIDDEN = { detail: "Las credenciales de autenticación no se proveyeron." };

test("noAuthFetch: 403 anónimo → reintenta con Token y devuelve los datos", async () => {
  process.env.MEDINET_API_TOKEN = "test-token-123";
  await withFetchMock(
    (n) => n === 1
      ? makeRes({ status: 403, json: FORBIDDEN })
      : makeRes({ status: 200, json: SUCCESS }),
    async (calls) => {
      const data = await fetchProximosCuposAll(39);
      assert.deepEqual(data, SUCCESS);
      assert.equal(calls.length, 2, "debe reintentar exactamente una vez");
      // 1ra llamada: anónima (sin Authorization)
      assert.equal(calls[0].options.headers?.Authorization, undefined);
      // 2da llamada: con Token MEDINET_API_TOKEN
      assert.equal(calls[1].options.headers?.Authorization, "Token test-token-123");
    }
  );
});

test("noAuthFetch: 200 a la primera → NO reintenta ni manda Authorization (happy path intacto)", async () => {
  process.env.MEDINET_API_TOKEN = "test-token-123";
  await withFetchMock(
    () => makeRes({ status: 200, json: SUCCESS }),
    async (calls) => {
      const data = await fetchProximosCuposAll(39);
      assert.deepEqual(data, SUCCESS);
      assert.equal(calls.length, 1, "no debe reintentar si la primera llamada funciona");
      assert.equal(calls[0].options.headers?.Authorization, undefined);
    }
  );
});

test("noAuthFetch: 403 sin token configurado → propaga el error (lo captura el caller)", async () => {
  delete process.env.MEDINET_API_TOKEN;
  delete process.env.MEDINET_API_KEY;
  delete process.env.MEDINET_SESSION_COOKIE;
  await withFetchMock(
    () => makeRes({ status: 403, json: FORBIDDEN }),
    async (calls) => {
      await assert.rejects(() => fetchProximosCuposAll(39), /403/);
      assert.equal(calls.length, 1, "sin credenciales no hay segundo intento");
    }
  );
});
