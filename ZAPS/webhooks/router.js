/**
 * Express router that exposes each Zap as an HTTP webhook.
 *
 * Mounted from server.js:
 *   import zapsRouter from "./ZAPS/webhooks/router.js";
 *   app.use("/zaps", zapsRouter);
 *
 * Final URLs (behind your public host):
 *   POST /zaps/update-comisiones
 *   POST /zaps/normaliza-rut-contacto
 *   POST /zaps/rut-normalizado-trato
 *
 * Each endpoint expects the Zendesk Sell webhook JSON body. The trigger
 * entity (deal or contact) is extracted from either
 *   req.body.data.current           (Sell v2 webhook payload)
 *   req.body.data                   (some Sell retry formats)
 *   req.body                        (direct payload, e.g. from tests)
 *
 * Optional shared-secret check: set ZAPS_WEBHOOK_SECRET in the environment
 * and configure Zendesk Sell to send header `X-Zap-Secret`. If the env var
 * is unset, the check is skipped (useful for dev).
 */

import express from "express";
import { handleUpdateComisiones } from "../update-comisiones/index.js";
import { handleNormalizeRutOnContactCreate } from "../zendesksell-normaliza-rut-al-crear-contacto/index.js";
import { handleNormalizeRutOnDealCreate } from "../rut-normalizado-crear-trato/index.js";

const router = express.Router();

// ---- Shared middleware -------------------------------------------------------

function checkSecret(req, res, next) {
  const expected = (process.env.ZAPS_WEBHOOK_SECRET || "").trim();
  if (!expected) return next(); // auth disabled
  const provided = String(req.get("X-Zap-Secret") || "").trim();
  if (provided !== expected) {
    return res.status(401).json({ ok: false, error: "invalid or missing X-Zap-Secret" });
  }
  next();
}

/** Pull the trigger entity from the webhook body, regardless of envelope shape. */
function extractEntity(body) {
  if (!body || typeof body !== "object") return null;
  if (body.data?.current && typeof body.data.current === "object") return body.data.current;
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) return body.data;
  return body;
}

/** Wrap a handler so errors return 500 JSON and get logged, not swallowed. */
function wrap(name, handler, opts = {}) {
  return async (req, res) => {
    const entity = extractEntity(req.body);
    if (!entity) {
      return res.status(400).json({ ok: false, error: "empty or malformed webhook body" });
    }
    try {
      const result = await handler(entity, opts);
      return res.status(200).json({ ok: true, zap: name, result });
    } catch (err) {
      console.error(`[zaps/${name}] ERROR:`, err.stack || err.message);
      return res.status(500).json({ ok: false, zap: name, error: err.message });
    }
  };
}

// ---- Routes ------------------------------------------------------------------

router.use(checkSecret);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    zaps: ["update-comisiones", "normaliza-rut-contacto", "rut-normalizado-trato"],
    secretEnabled: Boolean((process.env.ZAPS_WEBHOOK_SECRET || "").trim())
  });
});

router.post("/update-comisiones", wrap("update-comisiones", handleUpdateComisiones));
router.post("/normaliza-rut-contacto", wrap("normaliza-rut-contacto", handleNormalizeRutOnContactCreate));
router.post("/rut-normalizado-trato", wrap("rut-normalizado-trato", handleNormalizeRutOnDealCreate));

export default router;
