import { pool } from "./db.js";

// Imprime la estructura real de pipelines + stages de Sell
// para poder mapear pipeline_id → pipeline_key en forma confiable.

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  PIPELINES & STAGES EN SELL (leídos de sell_deals_cache)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const pipelines = await pool.query(`
    SELECT pipeline_id, pipeline_name, pipeline_key,
           count(*) AS deals,
           count(*) FILTER (WHERE is_closed_won) AS won,
           count(*) FILTER (WHERE stage_category = 'lost') AS lost,
           count(*) FILTER (WHERE stage_category = 'open') AS open
    FROM sell_deals_cache
    GROUP BY pipeline_id, pipeline_name, pipeline_key
    ORDER BY deals DESC
  `);

  console.log("## Pipelines");
  for (const p of pipelines.rows) {
    console.log(`\n  id=${p.pipeline_id}  name="${p.pipeline_name}"  key="${p.pipeline_key}"`);
    console.log(`    deals=${p.deals}  won=${p.won}  lost=${p.lost}  open=${p.open}`);

    const stages = await pool.query(`
      SELECT stage_id, stage_name, stage_category, outcome_score, count(*) AS n
      FROM sell_deals_cache
      WHERE pipeline_id = $1
      GROUP BY stage_id, stage_name, stage_category, outcome_score
      ORDER BY outcome_score DESC NULLS LAST, n DESC
    `, [p.pipeline_id]);

    for (const s of stages.rows) {
      const cat = s.stage_category ?? "?";
      const score = s.outcome_score ?? "—";
      console.log(`      [${cat.padEnd(4)}] ${String(score).padStart(3)}  id=${s.stage_id}  "${s.stage_name}"  (${s.n})`);
    }
  }

  console.log();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
