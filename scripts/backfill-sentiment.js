#!/usr/bin/env node
import "dotenv/config";
/**
 * backfill-sentiment.js — Analyze sentiment for existing conversation_messages.
 * Processes messages that have content but no text_sentiment_score.
 *
 * Usage: DATABASE_URL=... node scripts/backfill-sentiment.js [--limit 500]
 */
import pg from "pg";
import { analyzeMessage } from "../analysis/sentiment.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const BATCH = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 500 : 500;

// Emoji lookup using the same DB
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
  const { rows: pending } = await pool.query(
    `SELECT id, content FROM conversation_messages
     WHERE text_sentiment_score IS NULL AND content IS NOT NULL AND content != ''
     ORDER BY id ASC LIMIT $1`,
    [BATCH]
  );

  console.log(`[backfill] ${pending.length} messages to analyze (batch ${BATCH})`);
  let done = 0, errors = 0;

  for (const msg of pending) {
    try {
      const a = await analyzeMessage(msg.content, getEmojiSentimentBatch);
      await pool.query(
        `UPDATE conversation_messages SET
          emoji_list = $2, emoji_count = $3, emoji_sentiment_avg = $4,
          text_sentiment_score = $5, word_count = $6, has_question = $7,
          detected_signals = $8
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
        ]
      );
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${pending.length}...`);
    } catch (err) {
      errors++;
      if (errors < 5) console.error(`  Error msg ${msg.id}:`, err.message);
    }
  }

  // Check remaining
  const { rows: remaining } = await pool.query(
    `SELECT count(*)::int AS remaining FROM conversation_messages
     WHERE text_sentiment_score IS NULL AND content IS NOT NULL AND content != ''`
  );

  console.log(`[backfill] Done: ${done} analyzed, ${errors} errors, ${remaining[0].remaining} remaining`);
  if (remaining[0].remaining > 0) {
    console.log(`  Run again to process more: node scripts/backfill-sentiment.js --limit ${BATCH}`);
  }
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
