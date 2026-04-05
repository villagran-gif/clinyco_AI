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
  zendeskAgentEffectiveness,
  registeredAgents,
  dealsPerMonthPerAgent,
  dealsPerYearPerAgent,
  agentPhaseParticipation,
  chainEffectiveness,
  dealsForAgentDetail,
  auditLogRecent,
  deletionLogRecent,
  lastSyncStatus,
  goldPatterns,
  goldSignals,
  goldAntoniaStats,
  goldEmotionalJourney,
  dealsSummary,
  dealsPerAgent,
  dealsForAgent,
  commissionsPerAgent,
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

router.get(
  "/zendesk/agent-effectiveness",
  wrap(async (_req, res) => {
    res.json(await zendeskAgentEffectiveness());
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

router.get(
  "/deals/agent-detail/:firstName",
  wrap(async (req, res) => {
    const name = req.params.firstName;
    const year = req.query.year || null;
    if (!name) return res.status(400).json({ error: "missing firstName" });
    res.json(await dealsForAgentDetail(name, year));
  })
);

router.get(
  "/audit/changes",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json(await auditLogRecent(limit));
  })
);

router.get(
  "/audit/deletions",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(await deletionLogRecent(limit));
  })
);

router.get(
  "/sync/status",
  wrap(async (_req, res) => {
    res.json(await lastSyncStatus());
  })
);

// ═══════════════════════════════════════════════════════════════════
//  GOLD STANDARD ANALYSIS
// ═══════════════════════════════════════════════════════════════════

router.get("/gold/patterns", wrap(async (_req, res) => res.json(await goldPatterns())));
router.get("/gold/signals", wrap(async (_req, res) => res.json(await goldSignals())));
router.get("/gold/antonia", wrap(async (_req, res) => res.json(await goldAntoniaStats())));
router.get("/gold/journey", wrap(async (_req, res) => res.json(await goldEmotionalJourney())));

router.get(
  "/deals/commissions",
  wrap(async (_req, res) => {
    res.json(await commissionsPerAgent());
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

router.get(
  "/agents/monthly",
  wrap(async (_req, res) => {
    res.json(await dealsPerMonthPerAgent());
  })
);

router.get(
  "/agents/yearly",
  wrap(async (_req, res) => {
    res.json(await dealsPerYearPerAgent());
  })
);

router.get(
  "/agents/phases",
  wrap(async (req, res) => {
    const year = req.query.year || null;
    res.json(await agentPhaseParticipation(year));
  })
);

router.get(
  "/agents/chains",
  wrap(async (req, res) => {
    const year = req.query.year || null;
    res.json(await chainEffectiveness(year));
  })
);

export default router;
