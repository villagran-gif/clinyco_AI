import { pool } from "../db.js";

export async function getCuratedExamples({ channel = null, stage = null, intent = null, limit = 3 } = {}) {
  if (!pool) return [];

  const clauses = ["active = true"];
  const params = [];

  if (channel) {
    params.push(channel);
    clauses.push(`(channel = $${params.length} or channel = 'any')`);
  }
  if (stage) {
    params.push(stage);
    clauses.push(`stage = $${params.length}`);
  }
  if (intent) {
    params.push(intent);
    clauses.push(`(intent = $${params.length} or intent = 'generic')`);
  }

  params.push(limit);

  const sql = `
    select example_id, channel, intent, stage, outcome, quality_score, messages_json
    from curated_examples
    where ${clauses.join(" and ")}
    order by quality_score desc, updated_at desc
    limit $${params.length}
  `;

  const { rows } = await pool.query(sql, params);
  return rows.map((row) => ({
    exampleId: row.example_id,
    channel: row.channel,
    intent: row.intent,
    stage: row.stage,
    outcome: row.outcome,
    qualityScore: row.quality_score,
    messages: row.messages_json || []
  }));
}
