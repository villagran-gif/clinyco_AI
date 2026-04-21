import express from "express";
import { runSchedulerTick } from "../telemedicine/index.js";

const PORT = Number(process.env.TELEMEDICINE_WORKER_PORT || 8788);
const TOKEN = process.env.TELEMEDICINE_WORKER_TOKEN;
const TICK_MS = Number(process.env.TELEMEDICINE_REMINDER_TICK_MS || 60000);

if (!TOKEN) {
  console.error("TELEMEDICINE_WORKER_TOKEN is required");
  process.exit(1);
}

const app = express();
app.use(express.json());

function auth(req, res, next) {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

let lastResult = null;
let lastError = null;
let running = false;

async function safeTick(reason) {
  if (running) return { skipped: "already_running" };
  running = true;
  try {
    const result = await runSchedulerTick();
    lastResult = { ...result, reason };
    lastError = null;
    return result;
  } catch (err) {
    lastError = err.message;
    console.error(`[telemedicine-worker] tick failed (${reason}):`, err.message);
    return { error: err.message };
  } finally {
    running = false;
  }
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    tickMs: TICK_MS,
    lastResult,
    lastError,
    timestamp: new Date().toISOString(),
  });
});

app.post("/telemedicine/tick", auth, async (_req, res) => {
  const result = await safeTick("manual");
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`[telemedicine-worker] listening on port ${PORT} (tick ${TICK_MS}ms)`);
  setInterval(() => { safeTick("interval"); }, TICK_MS);
  safeTick("startup");
});
