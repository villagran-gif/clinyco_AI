#!/usr/bin/env node

/**
 * EugenIA Outcome Sync — cruza predicciones con deal phases en Zendesk Sell.
 *
 * Para cada predicción sin outcome:
 *   1. Extrae RUT del state_snapshot_json
 *   2. Consulta Sell API para obtener deal phase actual
 *   3. Mapea phase → score con getOutcomeScore()
 *   4. Auto-flaggea Gold Samples según match_score + outcome_score
 *   5. Actualiza la predicción con updateOutcome()
 *
 * Uso:
 *   node scripts/sync-outcomes.js                   # sync completo
 *   node scripts/sync-outcomes.js --dry-run          # solo log, sin update
 *   node scripts/sync-outcomes.js --limit 10         # máximo 10 conversaciones
 *
 * Variables de entorno:
 *   DATABASE_URL        — PostgreSQL connection string
 *   BOX_AI_BASE_URL     — URL del servicio Box AI (para search-rut)
 */

import pg from "pg";
import { getOutcomeScore, updateOutcome } from "../db.js";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || null;
const DATABASE_SSL = String(process.env.DATABASE_SSL || "false").toLowerCase() === "true";
const BOX_AI_BASE_URL = String(process.env.BOX_AI_BASE_URL || "").trim();

function parseArgs(argv) {
  const args = { dryRun: false, limit: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    if (argv[i] === "--limit" && argv[i + 1]) {
      args.limit = parseInt(argv[i + 1], 10) || null;
      i++;
    }
  }
  return args;
}

function classifyGoldSample(matchScore, outcomeScore) {
  if (matchScore == null || outcomeScore == null) return { isGold: false, reason: null };
  if (matchScore >= 0.8 && outcomeScore >= 80) return { isGold: true, reason: "accurate_positive" };
  if (matchScore <= 0.2 && outcomeScore >= 80) return { isGold: true, reason: "human_better" };
  if (matchScore >= 0.8 && outcomeScore <= 20) return { isGold: true, reason: "accurate_negative" };
  return { isGold: false, reason: null };
}

async function searchSellByRut(rut) {
  if (!BOX_AI_BASE_URL || !rut) return null;
  const endpoint = `${BOX_AI_BASE_URL}/api/search-rut`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rut })
  });
  if (!response.ok) {
    console.error(`  Sell API error: ${response.status} for rut=${rut}`);
    return null;
  }
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function extractRutFromSnapshot(snapshot) {
  if (!snapshot) return null;
  // Direct path
  if (snapshot.contactDraft?.c_rut) return snapshot.contactDraft.c_rut;
  // Nested in state
  if (snapshot.c_rut) return snapshot.c_rut;
  return null;
}

function normalizePipelineKey(pipeline) {
  if (!pipeline) return "bariatrica";
  const p = String(pipeline).toLowerCase();
  if (p.includes("balón") || p.includes("balon")) return "balon";
  if (p.includes("plástica") || p.includes("plastica")) return "plastica";
  if (p.includes("general")) return "general";
  return "bariatrica";
}

async function main() {
  const args = parseArgs(process.argv);

  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL no configurada");
    process.exitCode = 1;
    return;
  }

  if (!BOX_AI_BASE_URL) {
    console.error("WARNING: BOX_AI_BASE_URL no configurada — no se podrá consultar Sell API");
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false
  });

  console.log(`EugenIA Outcome Sync${args.dryRun ? " [DRY RUN]" : ""}`);
  console.log("─".repeat(50));

  try {
    // 1. Get predictions without outcome that already have been compared
    const limitClause = args.limit ? `LIMIT ${args.limit}` : "";
    const { rows: pendingGroups } = await pool.query(`
      SELECT DISTINCT ON (conversation_id)
        conversation_id,
        pipeline,
        state_snapshot_json
      FROM eugenia_predictions
      WHERE outcome_phase IS NULL
        AND compared_at IS NOT NULL
      ORDER BY conversation_id, created_at DESC
      ${limitClause}
    `);

    console.log(`Conversaciones pendientes: ${pendingGroups.length}`);
    if (pendingGroups.length === 0) {
      console.log("Nada que sincronizar.");
      return;
    }

    let updated = 0;
    let skipped = 0;
    let goldCount = 0;

    for (const group of pendingGroups) {
      const { conversation_id, pipeline, state_snapshot_json } = group;
      const snapshot = typeof state_snapshot_json === "string"
        ? JSON.parse(state_snapshot_json)
        : state_snapshot_json;

      const rut = extractRutFromSnapshot(snapshot);
      if (!rut) {
        console.log(`  SKIP ${conversation_id} — sin RUT en snapshot`);
        skipped++;
        continue;
      }

      // 2. Query Sell API for current deal phase
      const sellData = await searchSellByRut(rut);
      const deal = sellData?.deals?.[0] || sellData?.deal || null;
      if (!deal) {
        console.log(`  SKIP ${conversation_id} — sin deal en Sell para rut=${rut}`);
        skipped++;
        continue;
      }

      const phase = deal.stage_name || deal.stage || null;
      if (!phase) {
        console.log(`  SKIP ${conversation_id} — deal sin stage_name`);
        skipped++;
        continue;
      }

      const pipelineKey = normalizePipelineKey(pipeline);
      const outcomeScore = getOutcomeScore(pipelineKey, phase);

      console.log(`  ${conversation_id}: pipeline=${pipelineKey} phase="${phase}" score=${outcomeScore}`);

      // 3. Get ALL predictions for this conversation without outcome
      const { rows: predictions } = await pool.query(`
        SELECT id, match_score, prediction_type
        FROM eugenia_predictions
        WHERE conversation_id = $1
          AND outcome_phase IS NULL
          AND compared_at IS NOT NULL
        ORDER BY turn_number, prediction_type
      `, [conversation_id]);

      for (const pred of predictions) {
        const { isGold, reason } = classifyGoldSample(
          pred.match_score != null ? parseFloat(pred.match_score) : null,
          outcomeScore
        );

        if (args.dryRun) {
          console.log(`    [DRY] id=${pred.id} type=${pred.prediction_type} outcome=${outcomeScore} gold=${isGold}${reason ? ` (${reason})` : ""}`);
        } else {
          await updateOutcome(pred.id, {
            outcomePhase: phase,
            outcomeScore: outcomeScore ?? 0,
            isGoldSample: isGold,
            goldReason: reason
          });
          console.log(`    UPDATED id=${pred.id} type=${pred.prediction_type} outcome=${outcomeScore} gold=${isGold}${reason ? ` (${reason})` : ""}`);
        }

        updated++;
        if (isGold) goldCount++;
      }

      // Rate limit: 500ms between Sell API calls
      await new Promise(r => setTimeout(r, 500));
    }

    console.log("─".repeat(50));
    console.log(`Resumen: ${updated} predictions actualizadas, ${skipped} conversaciones skipped, ${goldCount} gold samples`);
  } catch (error) {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
