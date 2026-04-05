#!/usr/bin/env node
import "dotenv/config";
/**
 * scripts/reevaluate-predictions.js — Re-evaluate EugenIA predictions with Claude Opus.
 * Replaces Jaccard similarity (match_score=0.000) with LLM intent comparison.
 *
 * Updates eugenia_predictions with new match_type, match_score from Opus.
 *
 * Usage: DATABASE_URL=... ANTHROPIC_API_KEY=... node scripts/reevaluate-predictions.js [--limit 100]
 */
import pg from "pg";
import { evaluateIntentOnly } from "../analysis/evaluate.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY required"); process.exit(1); }

const args = process.argv.slice(2);
const LIMIT = parseInt(args[args.indexOf("--limit") + 1]) || 100;

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Get predictions that have been compared (have human_actual_action) but have match_score = 0
  const { rows: predictions } = await pool.query(`
    SELECT id, conversation_id, prediction_type, ai_suggested_action,
           human_actual_action, pipeline, lead_score_at_prediction
    FROM eugenia_predictions
    WHERE human_actual_action IS NOT NULL
      AND (match_score IS NULL OR match_score = 0)
      AND prediction_type = 'action'
    ORDER BY created_at DESC
    LIMIT $1
  `, [LIMIT]);

  console.log(`[reevaluate] Found ${predictions.length} predictions to re-evaluate with Opus`);

  let updated = 0, errors = 0, totalTokens = 0;

  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];

    try {
      const result = await evaluateIntentOnly({
        predictedAction: pred.ai_suggested_action,
        predictedQuestion: null,
        actualMessage: pred.human_actual_action,
        pipeline: pred.pipeline,
        leadScore: pred.lead_score_at_prediction,
      });

      if (result?.intent_comparison) {
        const ic = result.intent_comparison;
        const score = ic.score / 4; // Normalize 0-4 to 0-1
        const matchType = score >= 0.6 ? "same_intent"
          : score >= 0.3 ? "partial_match"
          : "different_topic";

        await pool.query(`
          UPDATE eugenia_predictions
          SET match_score = $2, match_type = $3, compared_at = now()
          WHERE id = $1
        `, [pred.id, Math.round(score * 100) / 100, matchType]);

        updated++;
        totalTokens += (result._tokens?.input || 0) + (result._tokens?.output || 0);

        if ((i + 1) % 10 === 0) {
          console.log(`  ${i + 1}/${predictions.length} | score=${score.toFixed(2)} ${matchType} | "${pred.ai_suggested_action}" vs "${(pred.human_actual_action || '').slice(0, 50)}..."`);
        }
      }
    } catch (err) {
      errors++;
      if (errors <= 3) console.error(`  ERROR pred ${pred.id}: ${err.message}`);
      if (err.message.includes("credit balance")) {
        console.error("[reevaluate] Out of credits. Stopping.");
        break;
      }
    }
  }

  const cost = (totalTokens * 0.000015).toFixed(2);
  console.log(`\n[reevaluate] Done: ${updated} updated, ${errors} errors, ~${totalTokens} tokens, ~$${cost}`);

  // Show new distribution
  const { rows: dist } = await pool.query(`
    SELECT match_type, count(*)::int AS total, round(avg(match_score)::numeric, 3) AS avg_score
    FROM eugenia_predictions
    WHERE human_actual_action IS NOT NULL
    GROUP BY match_type ORDER BY total DESC
  `);
  console.log("\nNew distribution:");
  for (const d of dist) {
    console.log(`  ${d.match_type}: ${d.total} (avg score: ${d.avg_score})`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
