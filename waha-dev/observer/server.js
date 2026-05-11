import express from "express";
import * as db from "./db.js";
import { findOrCreateConversation } from "./customer-matcher.js";
import { save as saveMessage } from "./message-store.js";
import { onMessage as trackBehavior } from "./behavior-tracker.js";
import { handleCallEvent } from "./call-store.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3001;
const DEFAULT_SESSION = process.env.DEFAULT_SESSION_NAME || "piloto-agente-1";
const DEFAULT_AGENT = process.env.DEFAULT_AGENT_NAME || "Agente Piloto";

// ── Health check ──
app.get("/", async (_req, res) => {
  try {
    const stats = await db.getStats();
    res.json({
      service: "clinyco-agent-observer",
      status: "ok",
      uptime: process.uptime(),
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

// ── WAHA Webhook ──
app.post("/waha-webhook", async (req, res) => {
  const event = req.body.event;
  const payload = req.body.payload || req.body;
  const sessionName = req.body.session || payload.session || DEFAULT_SESSION;

  // Session status events: log and return
  if (event === "session.status") {
    const status = payload.status || "unknown";
    console.log(`[webhook] Session ${sessionName} status: ${status}`);
    return res.json({ ok: true, event: "session.status" });
  }

  // Call events — best time to call analytics
  if (event && event.startsWith("call.")) {
    try {
      await db.ensureSession(sessionName, DEFAULT_AGENT, null);
      const call = await handleCallEvent(event, payload, sessionName);
      if (call) {
        console.log(`[webhook] ${event} | call=#${call.id} | status=${call.status} | phone=${call.client_phone}`);
      }
      return res.json({ ok: true, event, callId: call?.id || null });
    } catch (err) {
      console.error(`[webhook] Error processing ${event}:`, err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // Only process message events
  if (event !== "message") {
    console.log(`[webhook] Ignoring event: ${event}`);
    return res.json({ ok: true, event, ignored: true });
  }

  try {
    // Ensure the WAHA session is registered
    await db.ensureSession(sessionName, DEFAULT_AGENT, null);

    // Determine direction
    const fromMe = payload.fromMe ?? payload._data?.id?.fromMe ?? false;
    const direction = fromMe ? "agent_to_client" : "client_to_agent";

    // Extract client chatId
    const chatId = fromMe
      ? (payload.to || payload.chatId)
      : (payload.from || payload.chatId);

    if (!chatId) {
      console.warn("[webhook] No chatId found in payload, skipping");
      return res.status(400).json({ ok: false, error: "no chatId" });
    }

    // Skip group messages
    if (chatId.includes("@g.us")) {
      console.log(`[webhook] Skipping group message: ${chatId}`);
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
      `[webhook] ${direction} | conv=#${conversation.id} | msg=#${message.id} | ` +
      `phone=${conversation.client_phone} | emojis=${message.emoji_count}`
    );

    res.json({ ok: true, messageId: message.id, conversationId: conversation.id });
  } catch (err) {
    console.error("[webhook] Error processing message:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`[agent-observer] Listening on port ${PORT}`);
  console.log(`[agent-observer] Default session: ${DEFAULT_SESSION}`);
  console.log(`[agent-observer] DB: ${process.env.DATABASE_URL ? "configured" : "NOT SET"}`);
});
