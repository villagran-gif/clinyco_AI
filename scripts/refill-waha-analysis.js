#!/usr/bin/env node
import "dotenv/config";
/**
 * refill-waha-analysis.js — Re-analyze agent_direct_messages using current
 * analyzeMessage() logic. Idempotent: only processes rows with stale or
 * missing analysis_version.
 *
 * Usage:
 *   node scripts/refill-waha-analysis.js [--limit 500] [--dry-run] [--since 2025-01-01]
 */
import pg from "pg";
import { analyzeMessage, ANALYSIS_VERSION } from "../analysis/sentiment.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] || true) : null; };
const DRY_RUN = args.includes("--dry-run");
const LIMIT = parseInt(flag("--limit")) || 500;
const SINCE = flag("--since");

async function getEmojiSentimentBatch(emojis) {
  if (!emojis.length) return new Map();
  const { rows } = await pool.query(
    `SELECT emoji, sentiment_score FROM emoji_sentiment_lookup WHERE emoji = ANY($1)`,
    [emojis]
  );
  const map = new Map();
  for (const r of rows) map.set(r.emoji, r);
  return map;
}

async function main() {
  const start = Date.now();
  const sinceClause = SINCE ? `AND sent_at >= '${SINCE}'::timestamptz` : "";

  const { rows: pending } = await pool.query(
    `SELECT id, body, sent_at FROM agent_direct_messages
     WHERE (analysis_version IS NULL OR analysis_version < $1 OR text_sentiment_score IS NULL)
       ${sinceClause}
     ORDER BY sent_at DESC
     LIMIT $2`,
    [ANALYSIS_VERSION, LIMIT]
  );

  console.log(`[refill] ${pending.length} messages to process (v${ANALYSIS_VERSION}, limit=${LIMIT}, dry-run=${DRY_RUN})`);
  let updated = 0, skipped = 0, errors = 0;

  for (const msg of pending) {
    try {
      const a = await analyzeMessage(msg.body, getEmojiSentimentBatch);

      if (DRY_RUN) {
        if (updated < 5) {
          console.log(`  [dry-run] id=${msg.id} score=${a.textSentimentScore} signals=${a.detectedSignals} model=${a.sentimentModel}`);
        }
        updated++;
        continue;
      }

      const sentAt = new Date(msg.sent_at);
      await pool.query(
        `UPDATE agent_direct_messages SET
           emoji_list = $2, emoji_count = $3, emoji_sentiment_avg = $4,
           text_sentiment_score = $5, word_count = $6, has_question = $7,
           detected_signals = $8, has_url = $9::boolean,
           hour_of_day = $10, day_of_week = $11,
           sentiment_model = $12, sentiment_confidence = $13,
           sentiment_rationale = $14, sentiment_scored_at = now(),
           analysis_version = $15
         WHERE id = $1`,
        [
          msg.id,
          a.emojiList?.length ? a.emojiList : null,
          a.emojiCount || 0,
          a.emojiSentimentAvg,
          a.textSentimentScore,
          a.wordCount || 0,
          a.hasQuestion || false,
          a.detectedSignals?.length ? a.detectedSignals : null,
          a.hasUrl || false,
          sentAt.getHours(),
          sentAt.getDay(),
          a.sentimentModel,
          a.sentimentConfidence,
          a.sentimentRationale,
          ANALYSIS_VERSION,
        ]
      );
      updated++;
      if (updated % 100 === 0) console.log(`  ${updated}/${pending.length}...`);
    } catch (err) {
      errors++;
      if (errors < 5) console.error(`  Error msg ${msg.id}:`, err.message);
    }
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[refill] Done: ${updated} ${DRY_RUN ? "would update" : "updated"}, ${skipped} skipped, ${errors} errors, ${duration}s`);

  if (!DRY_RUN) {
    const { rows: [remaining] } = await pool.query(
      `SELECT COUNT(*)::int AS remaining FROM agent_direct_messages
       WHERE analysis_version IS NULL OR analysis_version < $1 OR text_sentiment_score IS NULL`,
      [ANALYSIS_VERSION]
    );
    console.log(`  Remaining: ${remaining.remaining}`);
    if (remaining.remaining > 0) {
      console.log(`  Run again: node scripts/refill-waha-analysis.js --limit ${LIMIT}`);
    }
  }

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
