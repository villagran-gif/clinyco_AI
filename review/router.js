/**
 * review/router.js — Express router for the Review Dashboard API.
 * Mount in server.js:  app.use("/api/review", reviewRouter);
 *
 * All endpoints are read-only. CORS enabled for Netlify frontend.
 */
import { Router } from "express";
import {
  eugeniaAccuracy,
  eugeniaTrends,
  eugeniaGoldSamples,
  eugeniaDirectives,
  eugeniaFeedback,
  eugeniaActions,
  whatsappSentiment,
  whatsappSentimentDetail,
  whatsappSignals,
  whatsappAgents,
  whatsappMetrics,
  zendeskSentiment,
  zendeskSignals,
  zendeskSentimentDetail,
  registeredAgents,
  dealsSummary,
  dealsPerAgent,
  dealsForAgent,
  dashboardSummary,
} from "./db.js";

const router = Router();

// ── CORS (allow Netlify origin + localhost dev) ──
const ALLOWED_ORIGINS = (process.env.REVIEW_CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGINS.includes("*") ||
    (origin && origin.endsWith(".netlify.app"))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Helper: wrap async handler ──
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`[review] ${req.path}:`, err.message);
    res.status(500).json({ error: err.message });
  });

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD (consolidated)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/dashboard",
  wrap(async (_req, res) => {
    res.json(await dashboardSummary());
  })
);

// ═══════════════════════════════════════════════════════════════════
//  EUGENIA
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/eugenia/accuracy",
  wrap(async (_req, res) => {
    res.json(await eugeniaAccuracy());
  })
);

router.get(
  "/eugenia/trends",
  wrap(async (req, res) => {
    const weeks = Math.min(parseInt(req.query.weeks) || 12, 52);
    res.json(await eugeniaTrends(weeks));
  })
);

router.get(
  "/eugenia/gold-samples",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(await eugeniaGoldSamples(limit));
  })
);

router.get(
  "/eugenia/directives",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(await eugeniaDirectives(limit));
  })
);

router.get(
  "/eugenia/feedback",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(await eugeniaFeedback(limit));
  })
);

router.get(
  "/eugenia/actions",
  wrap(async (_req, res) => {
    res.json(await eugeniaActions());
  })
);

// ═══════════════════════════════════════════════════════════════════
//  WHATSAPP
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/whatsapp/sentiment",
  wrap(async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json(await whatsappSentiment(days));
  })
);

router.get(
  "/whatsapp/sentiment/:conversationId",
  wrap(async (req, res) => {
    const id = parseInt(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "invalid conversationId" });
    res.json(await whatsappSentimentDetail(id));
  })
);

router.get(
  "/whatsapp/signals",
  wrap(async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json(await whatsappSignals(days));
  })
);

router.get(
  "/whatsapp/agents",
  wrap(async (_req, res) => {
    res.json(await whatsappAgents());
  })
);

router.get(
  "/whatsapp/metrics/:conversationId",
  wrap(async (req, res) => {
    const id = parseInt(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "invalid conversationId" });
    res.json(await whatsappMetrics(id));
  })
);

// ═══════════════════════════════════════════════════════════════════
//  ZENDESK (WhatsApp via Zendesk — agents by usuario)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/zendesk/sentiment",
  wrap(async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json(await zendeskSentiment(days));
  })
);

router.get(
  "/zendesk/sentiment/:conversationId",
  wrap(async (req, res) => {
    const id = req.params.conversationId;
    if (!id) return res.status(400).json({ error: "invalid conversationId" });
    res.json(await zendeskSentimentDetail(id));
  })
);

router.get(
  "/zendesk/signals",
  wrap(async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json(await zendeskSignals(days));
  })
);

// ═══════════════════════════════════════════════════════════════════
//  DEALS (Zendesk Sell)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/deals/summary",
  wrap(async (_req, res) => {
    res.json(await dealsSummary());
  })
);

router.get(
  "/deals/agents",
  wrap(async (_req, res) => {
    res.json(await dealsPerAgent());
  })
);

router.get(
  "/deals/agent/:name",
  wrap(async (req, res) => {
    const name = req.params.name;
    if (!name) return res.status(400).json({ error: "missing agent name" });
    res.json(await dealsForAgent(name));
  })
);

// ═══════════════════════════════════════════════════════════════════
//  AGENTS (from agent_registry)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/agents",
  wrap(async (_req, res) => {
    res.json(await registeredAgents());
  })
);

export default router;
