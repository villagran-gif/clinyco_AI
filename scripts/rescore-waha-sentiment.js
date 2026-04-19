#!/usr/bin/env node
import "dotenv/config";
/**
 * rescore-waha-sentiment.js — Daily cron job that re-classifies WAHA messages
 * with low confidence or keyword-only model using the LLM classifier with
 * fresh few-shot from gold samples.
 *
 * Usage: node scripts/rescore-waha-sentiment.js [--limit 500] [--days 30]
 */
import pg from "pg";
import { analyzeMessage, ANALYSIS_VERSION } from "../analysis/sentiment.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const args = process.argv.slice(2);
const LIMIT = parseInt(args[args.indexOf("--limit") + 1]) || 500;
const DAYS = parseInt(args[args.indexOf("--days") + 1]) || 30;
const THRESHOLD = parseFloat(process.env.SENTIMENT_LOW_CONFIDENCE_THRESHOLD) || 0.7;

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

async function getGoldSamples(limit = 20) {
  const { rows } = await pool.query(
    `SELECT f.human_label, f.human_score, f.rationale, m.body
     FROM waha_sentiment_feedback f
     JOIN agent_direct_messages m ON m.id = f.message_id
     ORDER BY f.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function main() {
  const start = Date.now();

  const { rows: pending } = await pool.query(
    `SELECT id, body, sentiment_confidence AS old_confidence FROM agent_direct_messages
     WHERE (sentiment_confidence < $1 OR sentiment_model = 'keyword-v1')
       AND sent_at >= now() - ($2 || ' days')::interval
       AND body IS NOT NULL AND LENGTH(body) > 10
     ORDER BY sentiment_confidence ASC NULLS FIRST
     LIMIT $3`,
    [THRESHOLD, DAYS, LIMIT]
  );

  console.log(`[rescore] ${pending.length} messages to re-score (threshold=${THRESHOLD}, days=${DAYS})`);
  let processed = 0, changed = 0, errors = 0;
  let totalOldConf = 0, totalNewConf = 0;

  for (const msg of pending) {
    try {
      const a = await analyzeMessage(msg.body, getEmojiSentimentBatch, {
        useLLM: true,
        getGoldSamples,
      });

      if (a.sentimentModel === "keyword-v1") {
        processed++;
        continue;
      }

      await pool.query(
        `UPDATE agent_direct_messages SET
           text_sentiment_score = $2,
           sentiment_model = $3, sentiment_confidence = $4,
           sentiment_rationale = $5, sentiment_scored_at = now(),
           analysis_version = $6
         WHERE id = $1`,
        [
          msg.id,
          a.textSentimentScore,
          a.sentimentModel, a.sentimentConfidence,
          a.sentimentRationale,
          ANALYSIS_VERSION,
        ]
      );

      totalOldConf += parseFloat(msg.old_confidence) || 0;
      totalNewConf += a.sentimentConfidence;
      processed++;
      changed++;

      if (processed % 50 === 0) console.log(`  ${processed}/${pending.length}...`);
    } catch (err) {
      errors++;
      if (errors < 5) console.error(`  Error msg ${msg.id}:`, err.message);
    }
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const avgConfidenceDelta = changed > 0
    ? ((totalNewConf - totalOldConf) / changed).toFixed(3)
    : 0;

  const summary = { processed, changed, errors, avgConfidenceDelta, durationSeconds: parseFloat(duration) };
  console.log(`[rescore] Done:`, JSON.stringify(summary));

  // Drift alert
  const driftWebhook = process.env.SENTIMENT_DRIFT_WEBHOOK_URL;
  if (driftWebhook) {
    try {
      const { rows: [accuracy] } = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE
            CASE WHEN f.human_label = 'positive' THEN m.text_sentiment_score > 0.1
                 WHEN f.human_label = 'negative' THEN m.text_sentiment_score < -0.1
                 ELSE m.text_sentiment_score BETWEEN -0.1 AND 0.1 END
          )::int AS correct
        FROM waha_sentiment_feedback f
        JOIN agent_direct_messages m ON m.id = f.message_id
        WHERE f.created_at >= now() - '7 days'::interval
      `);
      if (accuracy.total > 0) {
        const pct = Math.round((accuracy.correct / accuracy.total) * 100);
        console.log(`[rescore] Weekly accuracy: ${pct}% (${accuracy.correct}/${accuracy.total})`);
        if (pct < 70) {
          console.warn(`[rescore] ⚠️ Accuracy below 70% — sending drift alert`);
          await fetch(driftWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: `⚠️ Sentiment accuracy dropped to ${pct}% (${accuracy.correct}/${accuracy.total}) this week` }),
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`[rescore] Drift check error:`, err.message);
    }
  }

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
