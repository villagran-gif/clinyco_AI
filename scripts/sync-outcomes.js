#!/usr/bin/env node
/**
 * sync-outcomes.js — Cruza eugenia_predictions con deal phases en Zendesk Sell.
 * Para cada prediction sin outcome, busca el deal asociado y actualiza outcome + Gold Sample.
 *
 * Uso: node scripts/sync-outcomes.js [--dry-run] [--limit 100]
 */

import pg from "pg";
import { getOutcomeScore } from "../db.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ZENDESK_SELL_TOKEN = process.env.ZENDESK_SELL_API_TOKEN || process.env.ZENDESK_API_TOKEN_SELL;
const ZENDESK_SELL_BASE = "https://api.getbase.com/v2";

if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (!ZENDESK_SELL_TOKEN) { console.error("ZENDESK_SELL_API_TOKEN required"); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 100 : 100;

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function sellGet(path) {
  const res = await fetch(`${ZENDESK_SELL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${ZENDESK_SELL_TOKEN}`, "Content-Type": "application/json" }
  });
  if (!res.ok) throw new Error(`Sell API ${res.status}: ${await res.text()}`);
  return res.json();
}

function inferPipelineKey(pipeline) {
  const p = String(pipeline || "").toLowerCase();
  if (p.includes("bari") || p.includes("⚖")) return "bariatrica";
  if (p.includes("bal") || p.includes("🎈")) return "balon";
  if (p.includes("plast") || p.includes("💎")) return "plastica";
  return "general";
}

function shouldFlagGold(matchScore, outcomeScore) {
  if (matchScore == null || outcomeScore == null) return { flag: false, reason: null };
  if (matchScore >= 0.8 && outcomeScore >= 80) return { flag: true, reason: "high_match_good_outcome" };
  if (matchScore <= 0.2 && outcomeScore >= 80) return { flag: true, reason: "low_match_good_outcome_learn_from_human" };
  if (matchScore >= 0.8 && outcomeScore <= 20) return { flag: true, reason: "high_match_bad_outcome" };
  return { flag: false, reason: null };
}

async function main() {
  console.log(`sync-outcomes: ${dryRun ? "DRY RUN" : "LIVE"} limit=${limit}`);

  // Get predictions with comparison done but no outcome yet
  const { rows: predictions } = await pool.query(
    `select ep.*, c.state_json
     from eugenia_predictions ep
     left join conversations c on c.conversation_id = ep.conversation_id
     where ep.compared_at is not null and ep.outcome_at is null
     order by ep.created_at desc
     limit $1`,
    [limit]
  );

  console.log(`Found ${predictions.length} predictions pending outcome`);
  let updated = 0, skipped = 0, errors = 0;

  for (const pred of predictions) {
    try {
      // Extract deal info from state snapshot or conversation state
      const stateJson = pred.state_snapshot_json || pred.state_json;
      const state = typeof stateJson === "string" ? JSON.parse(stateJson) : stateJson;
      const sellRaw = state?.identity?.sellRaw;
      const dealId = sellRaw?.dealId || sellRaw?.deals?.[0]?.id;

      if (!dealId) {
        skipped++;
        continue;
      }

      // Fetch current deal phase from Sell
      const dealResponse = await sellGet(`/deals/${dealId}`);
      const deal = dealResponse?.data;
      if (!deal) { skipped++; continue; }

      const phase = deal.stage_name || deal.stage?.name || "";
      const pipelineKey = inferPipelineKey(pred.pipeline);
      const outcomeScore = getOutcomeScore(pipelineKey, phase);

      if (outcomeScore == null) { skipped++; continue; }

      const gold = shouldFlagGold(pred.match_score, outcomeScore);

      console.log(`  pred=${pred.id} deal=${dealId} phase="${phase}" outcomeScore=${outcomeScore} gold=${gold.flag}${dryRun ? " [DRY]" : ""}`);

      if (!dryRun) {
        await pool.query(
          `update eugenia_predictions
           set outcome_phase = $2, outcome_score = $3, outcome_at = now(),
               is_gold_sample = $4, gold_reason = $5
           where id = $1`,
          [pred.id, phase, outcomeScore, gold.flag, gold.reason]
        );
      }
      updated++;
    } catch (err) {
      console.error(`  ERROR pred=${pred.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`Done: updated=${updated} skipped=${skipped} errors=${errors}`);
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
