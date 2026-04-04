#!/usr/bin/env node
/**
 * sync-deals.js — Sync deals from Zendesk Sell API to local DB.
 *
 * Fetches ALL deals from all 4 pipelines (all stages), upserts to DB,
 * detects collaborator changes (audit log) and deleted deals (deletion log).
 *
 * Usage:
 *   node scripts/sync-deals.js                  # Full sync
 *   node scripts/sync-deals.js --dry-run        # Show what would change
 *   node scripts/sync-deals.js --pipeline 1290779  # Sync one pipeline
 *
 * Environment: DATABASE_URL, SELL_ACCESS_TOKEN (or ZENDESK_SELL_API_TOKEN)
 *
 * Designed to run every 10 minutes via PM2/cron.
 */
import pg from "pg";
import crypto from "crypto";

// ── Config ──
const DATABASE_URL = process.env.DATABASE_URL;
const SELL_TOKEN = process.env.SELL_ACCESS_TOKEN || process.env.ZENDESK_SELL_API_TOKEN || process.env.ZENDESK_API_TOKEN_SELL;
const SELL_BASE = process.env.SELL_BASE_URL || "https://api.getbase.com";
const PER_PAGE = 100;
const RETRY_MAX = 5;

if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (!SELL_TOKEN) { console.error("SELL_ACCESS_TOKEN or ZENDESK_SELL_API_TOKEN required"); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const pipelineFilter = args.includes("--pipeline") ? parseInt(args[args.indexOf("--pipeline") + 1]) : null;

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const BATCH_ID = `sync-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

// ── Pipeline & Stage config (all 4 pipelines) ──
const PIPELINES = {
  1290779: {
    name: "Cirugía Bariátricas",
    stages: {
      10693252: "CANDIDATO",
      35699717: "EXAMENES PRE-PAD ENVIADOS",
      10693253: "EXAMENES ENVIADOS",
      10693255: "PROCESO PREOP",
      35531166: "CERRADO AGENDADO",
      10693256: "CERRADO OPERADO",
      10693257: "SUSPENDIDO",
      10693258: "SIN RESPUESTA",
    },
  },
  4823817: {
    name: "Pipeline Balones",
    stages: {
      36009807: "CANDIDATOS",
      36009808: "EXAMENES ALLURION",
      36009814: "EXAMENES ORBERA",
      36009809: "CONTROLES PRE-INSTALACIÓN",
      36009810: "CERRADO AGENDADO",
      36009811: "CERRADO INSTALADO",
      36009812: "DESCALIFICADO",
      36009813: "SIN RESPUESTA",
    },
  },
  4959507: {
    name: "Pipeline Cirugía Plástica",
    stages: {
      36975471: "CANDIDATO",
      36975472: "ORDEN DE EXAMENES",
      37188752: "PROCESO PRE-OPERATORIO",
      36975473: "CERRADO AGENDADO",
      36975475: "CERRADO OPERADO",
      36975476: "DESCALIFICADO",
      36975477: "SIN RESPUESTA",
    },
  },
  5049979: {
    name: "Pipeline Cirugía General",
    stages: {
      37619387: "CANDIDATO",
      37619388: "ORDEN DE EXAMENES",
      37619389: "PROCESO PRE-OPERATORIO",
      37619390: "CERRADO AGENDADO",
      37619391: "CERRADO OPERADO",
      37619392: "DESCALIFICADO",
      37619393: "SIN RESPUESTA",
    },
  },
};

// ── Zendesk Sell API ──
async function sellGet(path, attempt = 1) {
  const url = `${SELL_BASE}/v2${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SELL_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ClinycoSync/1.0",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (res.status === 429 && attempt <= RETRY_MAX) {
    const wait = Math.min(8000, 400 * Math.pow(2, attempt));
    console.warn(`  Rate limited, retry ${attempt}/${RETRY_MAX} in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
    return sellGet(path, attempt + 1);
  }
  if (res.status >= 500 && attempt <= RETRY_MAX) {
    const wait = Math.min(8000, 400 * Math.pow(2, attempt));
    console.warn(`  Server error ${res.status}, retry ${attempt}/${RETRY_MAX}`);
    await new Promise((r) => setTimeout(r, wait));
    return sellGet(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Sell API ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Fetch all deals from a given stage, handling pagination */
async function fetchAllDealsForStage(stageId) {
  const deals = [];
  let page = 1;
  while (true) {
    const data = await sellGet(`/deals?stage_id=${stageId}&per_page=${PER_PAGE}&page=${page}`);
    const items = data.items || [];
    deals.push(...items.map((i) => i.data));
    if (items.length < PER_PAGE) break;
    page++;
  }
  return deals;
}

// ── Field extraction helpers ──
function clean(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s || null;
}

function parseInt0(val) {
  const n = parseInt(String(val || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function parseDate(val) {
  const s = clean(val);
  if (!s) return null;
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[0];
  const dmyMatch = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
  return null;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(a), db = new Date(b);
  if (isNaN(da) || isNaN(db)) return null;
  return Math.round((db - da) / 86400000);
}

function extractDeal(raw, pipelineId, pipelineName, stageName) {
  const cf = raw.custom_fields || {};
  const addedAt = parseDate(raw.added_at);
  const fechaCir = parseDate(cf["FECHA DE CIRUGÍA"]);
  const dias = daysBetween(addedAt, fechaCir);
  const isSuccess = /^CERRADO (OPERADO|AGENDADO|INSTALADO)$/.test(stageName);
  const bono75 = dias !== null && dias >= 0 && dias <= 75 && isSuccess;

  return {
    deal_id: String(raw.id),
    deal_name: clean(raw.name),
    pipeline_phase: stageName,
    pipeline_id: pipelineId,
    pipeline_name: pipelineName,
    stage_id: raw.stage_id,
    owner_id: raw.owner_id,
    owner_name: null, // resolved later if needed
    added_at: addedAt,
    contact_name: clean(raw.contact?.name || cf["Contacto"]),
    contact_phone: clean(cf["Teléfono"] || cf["Telefono"]),
    contact_email: clean(cf["Correo electrónico"] || cf["correo electrónico"]),
    rut: clean(cf["RUT o ID"] || cf["RUT O ID"]),
    rut_normalizado: clean(cf["RUT_normalizado"]),
    ciudad: clean(cf["Ciudad"]),
    cirugia: clean(cf["CIRUGIA"] || cf["Interés"]),
    fecha_cirugia: fechaCir,
    sucursal: clean(cf["SUCURSAL"]),
    origen: null, // source_id needs separate lookup
    url_medinet: clean(cf["URL-MEDINET"]),
    colaborador1: clean(cf["Colaborador 1 (BAR)"]),
    colaborador2: clean(cf["Colaborador 2 (BAR)"]),
    colaborador3: clean(cf["Colaborador 3 (BAR)"]),
    comision_bar1: parseInt0(cf["ComisionBAR1"]),
    comision_bar2: parseInt0(cf["ComisionBAR2"]),
    comision_bar3: parseInt0(cf["ComisionBAR3"]),
    comision_bar4: parseInt0(cf["ComisionBAR4"]),
    comision_bar5: parseInt0(cf["ComisionBAR5"]),
    comision_bar6: parseInt0(cf["ComisionBAR6"]),
    dias_added_cirugia: dias,
    bono_75_dias: bono75,
    sell_updated_at: raw.updated_at,
  };
}

// ── Audit: detect changes ──
const TRACKED_FIELDS = [
  "pipeline_phase", "colaborador1", "colaborador2", "colaborador3",
  "comision_bar1", "comision_bar2", "comision_bar3",
  "comision_bar4", "comision_bar5", "comision_bar6",
  "owner_name", "fecha_cirugia",
];

async function detectChanges(newDeal) {
  const { rows } = await pool.query(
    `SELECT * FROM deals WHERE deal_id = $1`, [newDeal.deal_id]
  );
  if (!rows[0]) return []; // new deal, no changes to log

  const old = rows[0];
  const changes = [];
  for (const field of TRACKED_FIELDS) {
    const oldVal = old[field] == null ? null : String(old[field]);
    const newVal = newDeal[field] == null ? null : String(newDeal[field]);
    if (oldVal !== newVal) {
      changes.push({
        deal_id: newDeal.deal_id,
        deal_name: newDeal.deal_name,
        rut_normalizado: newDeal.rut_normalizado,
        field_name: field,
        old_value: oldVal,
        new_value: newVal,
        owner_name: newDeal.owner_name || old.owner_name,
      });
    }
  }
  return changes;
}

async function logChanges(changes) {
  for (const c of changes) {
    if (dryRun) {
      console.log(`  CHANGE ${c.deal_id} ${c.field_name}: "${c.old_value}" → "${c.new_value}"`);
    } else {
      await pool.query(
        `INSERT INTO deal_audit_log (deal_id, deal_name, rut_normalizado, field_name, old_value, new_value, owner_name, sync_batch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.deal_id, c.deal_name, c.rut_normalizado, c.field_name, c.old_value, c.new_value, c.owner_name, BATCH_ID]
      );
    }
  }
}

// ── Audit: detect deletions ──
async function detectDeletions(fetchedDealIds) {
  const { rows } = await pool.query(
    `SELECT * FROM deals WHERE deal_id != ALL($1::text[]) AND synced_at IS NOT NULL`,
    [fetchedDealIds]
  );
  return rows;
}

async function logDeletions(deletedDeals) {
  for (const d of deletedDeals) {
    if (dryRun) {
      console.log(`  DELETED deal=${d.deal_id} name="${d.deal_name}" rut=${d.rut_normalizado} owner=${d.owner_name}`);
    } else {
      await pool.query(
        `INSERT INTO deal_deletions_log (
          deal_id, deal_name, rut_normalizado, pipeline_phase, owner_name,
          colaborador1, colaborador2, colaborador3,
          comision_bar1, comision_bar2, comision_bar3,
          comision_bar4, comision_bar5, comision_bar6,
          added_at, fecha_cirugia, contact_name, contact_phone,
          snapshot_json, sync_batch_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          d.deal_id, d.deal_name, d.rut_normalizado, d.pipeline_phase, d.owner_name,
          d.colaborador1, d.colaborador2, d.colaborador3,
          d.comision_bar1, d.comision_bar2, d.comision_bar3,
          d.comision_bar4, d.comision_bar5, d.comision_bar6,
          d.added_at, d.fecha_cirugia, d.contact_name, d.contact_phone,
          JSON.stringify(d), BATCH_ID,
        ]
      );
      // Remove from deals table
      await pool.query(`DELETE FROM deals WHERE deal_id = $1`, [d.deal_id]);
    }
  }
}

// ── Upsert deal ──
async function upsertDeal(d) {
  await pool.query(
    `INSERT INTO deals (
      deal_id, deal_name, pipeline_phase, pipeline_id, pipeline_name, stage_id,
      owner_name, added_at, contact_name, contact_phone, rut, rut_normalizado,
      ciudad, cirugia, fecha_cirugia, sucursal, url_medinet,
      colaborador1, colaborador2, colaborador3,
      comision_bar1, comision_bar2, comision_bar3,
      comision_bar4, comision_bar5, comision_bar6,
      dias_added_cirugia, bono_75_dias, sell_updated_at, synced_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,now()
    ) ON CONFLICT (deal_id) DO UPDATE SET
      deal_name=EXCLUDED.deal_name, pipeline_phase=EXCLUDED.pipeline_phase,
      pipeline_id=EXCLUDED.pipeline_id, pipeline_name=EXCLUDED.pipeline_name,
      stage_id=EXCLUDED.stage_id, owner_name=EXCLUDED.owner_name,
      contact_name=EXCLUDED.contact_name, contact_phone=EXCLUDED.contact_phone,
      rut=EXCLUDED.rut, rut_normalizado=EXCLUDED.rut_normalizado,
      ciudad=EXCLUDED.ciudad, cirugia=EXCLUDED.cirugia,
      fecha_cirugia=EXCLUDED.fecha_cirugia, sucursal=EXCLUDED.sucursal,
      url_medinet=EXCLUDED.url_medinet,
      colaborador1=EXCLUDED.colaborador1, colaborador2=EXCLUDED.colaborador2,
      colaborador3=EXCLUDED.colaborador3,
      comision_bar1=EXCLUDED.comision_bar1, comision_bar2=EXCLUDED.comision_bar2,
      comision_bar3=EXCLUDED.comision_bar3, comision_bar4=EXCLUDED.comision_bar4,
      comision_bar5=EXCLUDED.comision_bar5, comision_bar6=EXCLUDED.comision_bar6,
      dias_added_cirugia=EXCLUDED.dias_added_cirugia, bono_75_dias=EXCLUDED.bono_75_dias,
      sell_updated_at=EXCLUDED.sell_updated_at, synced_at=now()`,
    [
      d.deal_id, d.deal_name, d.pipeline_phase, d.pipeline_id, d.pipeline_name, d.stage_id,
      d.owner_name, d.added_at, d.contact_name, d.contact_phone, d.rut, d.rut_normalizado,
      d.ciudad, d.cirugia, d.fecha_cirugia, d.sucursal, d.url_medinet,
      d.colaborador1, d.colaborador2, d.colaborador3,
      d.comision_bar1, d.comision_bar2, d.comision_bar3,
      d.comision_bar4, d.comision_bar5, d.comision_bar6,
      d.dias_added_cirugia, d.bono_75_dias, d.sell_updated_at,
    ]
  );
}

// ── Main ──
async function main() {
  const startTime = Date.now();
  console.log(`[sync-deals] ${dryRun ? "DRY RUN" : "LIVE"} batch=${BATCH_ID}`);

  const allFetchedIds = [];
  let totalDeals = 0, totalChanges = 0, totalNew = 0;

  const pipelineIds = pipelineFilter
    ? [pipelineFilter]
    : Object.keys(PIPELINES).map(Number);

  for (const pipelineId of pipelineIds) {
    const pipeline = PIPELINES[pipelineId];
    if (!pipeline) { console.error(`Unknown pipeline: ${pipelineId}`); continue; }

    console.log(`\n[${pipeline.name}] (${pipelineId})`);

    for (const [stageId, stageName] of Object.entries(pipeline.stages)) {
      const deals = await fetchAllDealsForStage(Number(stageId));
      console.log(`  ${stageName}: ${deals.length} deals`);

      for (const raw of deals) {
        const deal = extractDeal(raw, pipelineId, pipeline.name, stageName);
        allFetchedIds.push(deal.deal_id);

        // Detect changes before upsert
        const changes = await detectChanges(deal);
        if (changes.length) {
          totalChanges += changes.length;
          await logChanges(changes);
        }

        // Check if new
        const { rows } = await pool.query(`SELECT 1 FROM deals WHERE deal_id=$1`, [deal.deal_id]);
        if (!rows.length) totalNew++;

        if (!dryRun) await upsertDeal(deal);
        totalDeals++;
      }
    }
  }

  // Detect deletions (deals in DB but not in API)
  if (!pipelineFilter) {
    console.log("\n[Deletion check]");
    const deleted = await detectDeletions(allFetchedIds);
    if (deleted.length) {
      console.log(`  ${deleted.length} deals deleted from Zendesk Sell`);
      await logDeletions(deleted);
    } else {
      console.log("  No deletions detected");
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[sync-deals] Done in ${elapsed}s: ${totalDeals} deals, ${totalNew} new, ${totalChanges} field changes`);
  await pool.end();
}

main().catch((err) => {
  console.error("[sync-deals] FATAL:", err);
  process.exit(1);
});
