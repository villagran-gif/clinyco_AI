import { handleReminderTick, handlePaymentPollTick } from "./lifecycle.js";
import { ingestFromMedinet } from "./ingest.js";

let lastIngestAt = 0;

function getIngestIntervalMs() {
  return Number(process.env.TELEMEDICINE_INGEST_INTERVAL_MS || 5 * 60 * 1000);
}

export async function runSchedulerTick() {
  const startedAt = new Date().toISOString();
  const results = {};

  const now = Date.now();
  if (now - lastIngestAt >= getIngestIntervalMs()) {
    lastIngestAt = now;
    try {
      results.ingest = await ingestFromMedinet();
    } catch (err) {
      results.ingest = { error: err.message };
      console.warn("[telemedicine.scheduler] ingest failed:", err.message);
    }
  }

  try {
    results.reminders = await handleReminderTick();
  } catch (err) {
    results.reminders = { error: err.message };
    console.warn("[telemedicine.scheduler] reminders failed:", err.message);
  }

  try {
    results.payments = await handlePaymentPollTick();
  } catch (err) {
    results.payments = { error: err.message };
    console.warn("[telemedicine.scheduler] payments failed:", err.message);
  }

  return { startedAt, finishedAt: new Date().toISOString(), ...results };
}
