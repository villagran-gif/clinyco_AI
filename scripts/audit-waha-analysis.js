#!/usr/bin/env node
import "dotenv/config";
/**
 * audit-waha-analysis.js — Read-only diagnostic of agent_direct_messages analysis state.
 * Reports NULLs, stale versions, and a sample of 10 messages for human review.
 *
 * Usage: node scripts/audit-waha-analysis.js
 */
import pg from "pg";
import { ANALYSIS_VERSION } from "../analysis/sentiment.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log(`[audit] ANALYSIS_VERSION = ${ANALYSIS_VERSION}\n`);

  const { rows: [stats] } = await pool.query(
    `SELECT
       COUNT(*)::int                                                      AS total,
       COUNT(*) FILTER (WHERE text_sentiment_score IS NULL)::int          AS null_text_sentiment,
       COUNT(*) FILTER (WHERE emoji_sentiment_avg IS NULL
                          AND emoji_count > 0)::int                       AS missing_emoji_sent,
       COUNT(*) FILTER (WHERE detected_signals IS NULL)::int              AS null_signals,
       COUNT(*) FILTER (WHERE analysis_version IS NULL
                          OR analysis_version < $1)::int                  AS stale_version,
       COUNT(*) FILTER (WHERE sentiment_model IS NULL)::int               AS null_model,
       COUNT(*) FILTER (WHERE sentiment_confidence IS NULL)::int          AS null_confidence,
       MIN(sent_at)                                                       AS oldest,
       MAX(sent_at)                                                       AS newest
     FROM agent_direct_messages`,
    [ANALYSIS_VERSION]
  );

  console.log("── Summary ──");
  console.table(stats);

  const { rows: sample } = await pool.query(
    `SELECT id, LEFT(body, 80) AS body_preview,
            text_sentiment_score, emoji_sentiment_avg, sentiment_model,
            sentiment_confidence, analysis_version,
            array_length(detected_signals, 1) AS signal_count,
            sent_at
     FROM agent_direct_messages
     ORDER BY RANDOM()
     LIMIT 10`
  );

  console.log("\n── Random sample (10 messages) ──");
  console.table(sample);

  const { rows: byModel } = await pool.query(
    `SELECT COALESCE(sentiment_model, 'NULL') AS model,
            COUNT(*)::int AS count,
            ROUND(AVG(sentiment_confidence)::numeric, 3) AS avg_confidence
     FROM agent_direct_messages
     GROUP BY sentiment_model
     ORDER BY count DESC`
  );

  console.log("\n── By sentiment_model ──");
  console.table(byModel);

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
