import express from "express";
import * as db from "./db.js";
import { findOrCreateConversation } from "./customer-matcher.js";
import { save as saveMessage } from "./message-store.js";
import { onMessage as trackBehavior } from "./behavior-tracker.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3001;

// Agent registry: Zendesk ID → agent name
const AGENTS = {
  "39403066594317": "Gabriela Heck",
  "29866913338893": "Allison Contreras",
  "30229490880397": "Carolin Cornejo",
  "30229583958797": "Camila Alcayaga",
};

// ── Health check ──
app.get("/", async (_req, res) => {
  try {
    const stats = await db.getStats();
    res.json({
      service: "clinyco-agent-observer",
      status: "ok",
      uptime: process.uptime(),
      agents: AGENTS,
      stats,
    });
  } catch (err) {
    res.status(500).json({ service: "clinyco-agent-observer", status: "error", error: err.message });
  }
});

// ── Debug: recent conversations ──
app.get("/conversations", async (_req, res) => {
  try {
    const conversations = await db.getRecentConversations(20);
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WAHA Webhook (per-agent route) ──
app.post("/waha-webhook/:agentId", async (req, res) => {
  const { agentId } = req.params;
  const agentName = AGENTS[agentId] || `Agente ${agentId}`;
  const sessionName = agentId; // Use Zendesk ID as session name

  const event = req.body.event;
  const payload = req.body.payload || req.body;

  // Session status events: log and return
  if (event === "session.status") {
    const status = payload.status || "unknown";
    console.log(`[webhook] [${agentName}] Session status: ${status}`);
    return res.json({ ok: true, event: "session.status" });
  }

  // Only process message events (message = received, message.any = sent + received)
  if (event !== "message" && event !== "message.any") {
    return res.json({ ok: true, event, ignored: true });
  }

  try {
    // Ensure the WAHA session is registered with agent's Zendesk ID
    await db.ensureSession(sessionName, agentName, null);

    // Determine direction
    const fromMe = payload.fromMe ?? payload._data?.id?.fromMe ?? false;
    const direction = fromMe ? "agent_to_client" : "client_to_agent";

    // Extract client chatId
    const chatId = fromMe
      ? (payload.to || payload.chatId)
      : (payload.from || payload.chatId);

    if (!chatId) {
      console.warn(`[webhook] [${agentName}] No chatId found, skipping`);
      return res.status(400).json({ ok: false, error: "no chatId" });
    }

    // Skip group messages
    if (chatId.includes("@g.us")) {
      return res.json({ ok: true, skipped: "group" });
    }

    // Find or create conversation (with auto-match)
    const conversation = await findOrCreateConversation(sessionName, chatId);
    if (!conversation) {
      return res.status(400).json({ ok: false, error: "could not resolve conversation" });
    }

    // Store message with per-message analysis
    const message = await saveMessage(conversation, payload, direction);
    if (!message) {
      return res.json({ ok: true, deduped: true });
    }

    // Compute behavioral metrics
    await trackBehavior(conversation.id, message, direction);

    console.log(
      `[webhook] [${agentName}] ${direction} | conv=#${conversation.id} | msg=#${message.id} | ` +
      `phone=${conversation.client_phone} | emojis=${message.emoji_count}`
    );

    res.json({ ok: true, messageId: message.id, conversationId: conversation.id });
  } catch (err) {
    console.error(`[webhook] [${agentName}] Error:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Legacy route (backward compat) ──
app.post("/waha-webhook", async (req, res) => {
  console.log("[webhook] Legacy route hit — use /waha-webhook/:agentId instead");
  return res.json({ ok: true, ignored: true, message: "use /waha-webhook/:agentId" });
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`[agent-observer] Listening on port ${PORT}`);
  console.log(`[agent-observer] Agents: ${Object.values(AGENTS).join(", ")}`);
  console.log(`[agent-observer] DB: ${process.env.DATABASE_URL ? "configured" : "NOT SET"}`);
});
