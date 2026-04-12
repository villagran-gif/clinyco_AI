import { pool } from "./db.js";
import { computeAggregateMetrics } from "./behavior-tracker.js";

// Metric types that are conversation-level aggregates (recomputed every 5 msgs,
// so they accumulate stale rows). We wipe and recompute once cleanly.
const AGGREGATE_METRIC_TYPES = [
  "session_duration",
  "message_cadence",
  "turn_taking_ratio",
  "question_density_agent",
  "question_density_client",
  "longest_agent_streak",
  "longest_client_streak",
  "conversation_gap_max",
  "active_hours",
  "response_time_trend",
  "formality_shift",
  "lexical_convergence",
  "personalization_score",
  "media_sharing_rate",
  "sentiment_trajectory",
  "emoji_mirroring",
];

async function main() {
  console.log("[recompute] Starting aggregate metrics recompute...");

  const { rows: convs } = await pool.query(
    `SELECT id FROM agent_direct_conversations ORDER BY id ASC`
  );
  console.log(`[recompute] Found ${convs.length} conversations`);

  // Wipe stale aggregate rows in one batch (per-message metrics are kept)
  const { rowCount: deleted } = await pool.query(
    `DELETE FROM agent_behavior_metrics
     WHERE metric_type = ANY($1) OR metric_type LIKE 'emoji_diversity_%'`,
    [AGGREGATE_METRIC_TYPES]
  );
  console.log(`[recompute] Deleted ${deleted} stale aggregate rows`);

  let processed = 0;
  let errors = 0;
  for (const { id } of convs) {
    try {
      await computeAggregateMetrics(id);
    } catch (err) {
      errors++;
      console.error(`[recompute] conv ${id} failed:`, err.message);
    }
    processed++;
    if (processed % 10 === 0) {
      console.log(`[recompute] ${processed}/${convs.length} done (${errors} errors)`);
    }
  }

  console.log(`[recompute] Complete: ${processed} convs, ${errors} errors`);
  await pool.end();
}

main().catch((err) => {
  console.error("[recompute] Fatal:", err);
  process.exit(1);
});
