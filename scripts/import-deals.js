/**
 * scripts/import-deals.js — Import deals from Zendesk Sell CSV export.
 *
 * Includes: collaborators (phase 1/2/3), commissions (BAR1-6),
 * 75-day bonus calculation, and safe date parsing.
 *
 * Usage: DATABASE_URL=... node scripts/import-deals.js [csv-path]
 * Default CSV: data/input/deals_20260401_0752.csv
 */
import fs from "fs";
import pg from "pg";
import { parse } from "csv-parse/sync";

const CSV_PATH = process.argv[2] || "data/input/deals_20260401_0752.csv";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function clean(val) {
  const s = String(val || "").trim();
  return s || null;
}

function parseInt0(val) {
  const n = parseInt(String(val || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse date safely.
 * Zendesk native fields: YYYY-MM-DD (unambiguous)
 * Zendesk custom fields: could be DD/MM/YYYY or MM/DD/YYYY
 * Strategy: if format is YYYY-MM-DD, use as-is. Otherwise try DD/MM/YYYY first.
 */
function parseDate(val) {
  const s = clean(val);
  if (!s) return null;

  // YYYY-MM-DD (possibly with time)
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0].slice(0, 10);

  // DD/MM/YYYY or DD-MM-YYYY (custom Zendesk fields)
  const dmyMatch = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

/** Calculate days between two YYYY-MM-DD date strings */
function daysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

const SUCCESS_PHASES = new Set([
  "CERRADO OPERADO", "CERRADO AGENDADO", "CERRADO INSTALADO",
]);

async function main() {
  console.log(`Reading ${CSV_PATH}...`);
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: ",",
  });

  console.log(`Parsed ${records.length} deals. Importing...`);

  let inserted = 0;
  let skipped = 0;
  let bonusCount = 0;

  for (const row of records) {
    const dealId = clean(row["ID del trato"]);
    if (!dealId) { skipped++; continue; }

    const addedAt = parseDate(row["Agregado el"]);
    const fechaCirugia = parseDate(row["FECHA DE CIRUGÍA"]);
    const phase = clean(row["Fase del pipeline"]);

    // Calculate 75-day bonus eligibility
    const dias = daysBetween(addedAt, fechaCirugia);
    const bono75 = dias !== null && dias >= 0 && dias <= 75 && SUCCESS_PHASES.has(phase);
    if (bono75) bonusCount++;

    try {
      await pool.query(
        `INSERT INTO deals (
          deal_name, deal_id, pipeline_phase, owner_name, added_at,
          contact_name, contact_id, contact_email, contact_phone,
          rut, ciudad, cirugia, fecha_cirugia, sucursal, origen,
          probabilidad_ganar, fecha_cambio_fase, fecha_cierre,
          colaborador1, colaborador2, colaborador3,
          comision_bar1, comision_bar2, comision_bar3,
          comision_bar4, comision_bar5, comision_bar6,
          dias_added_cirugia, bono_75_dias
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
        ) ON CONFLICT (deal_id) DO UPDATE SET
          pipeline_phase = EXCLUDED.pipeline_phase,
          owner_name = EXCLUDED.owner_name,
          fecha_cambio_fase = EXCLUDED.fecha_cambio_fase,
          fecha_cierre = EXCLUDED.fecha_cierre,
          colaborador1 = EXCLUDED.colaborador1,
          colaborador2 = EXCLUDED.colaborador2,
          colaborador3 = EXCLUDED.colaborador3,
          comision_bar1 = EXCLUDED.comision_bar1,
          comision_bar2 = EXCLUDED.comision_bar2,
          comision_bar3 = EXCLUDED.comision_bar3,
          comision_bar4 = EXCLUDED.comision_bar4,
          comision_bar5 = EXCLUDED.comision_bar5,
          comision_bar6 = EXCLUDED.comision_bar6,
          dias_added_cirugia = EXCLUDED.dias_added_cirugia,
          bono_75_dias = EXCLUDED.bono_75_dias`,
        [
          clean(row["Nombre del trato"]),
          dealId,
          phase,
          clean(row["Propiedad"]),
          addedAt,
          clean(row["Contacto"]),
          clean(row["ID de contacto"]),
          clean(row["Correo electrónico"]) || clean(row["Correo"]) || clean(row["correo electrónico"]),
          clean(row["Teléfono"]) || clean(row["Telefono"]) || clean(row["Numero de teléfono"]),
          clean(row["RUT o ID"]) || clean(row["RUT O ID"]),
          clean(row["Ciudad"]),
          clean(row["CIRUGIA"]),
          fechaCirugia,
          clean(row["SUCURSAL"]),
          clean(row["Origen"]),
          clean(row["Probabilidad de ganar"]),
          parseDate(row["Fecha de cambio de la última fase"]),
          parseDate(row["Fecha de cierre"]),
          clean(row["Colaborador 1 (BAR)"]),
          clean(row["Colaborador 2 (BAR)"]),
          clean(row["Colaborador 3 (BAR)"]),
          parseInt0(row["ComisionBAR1"]),
          parseInt0(row["ComisionBAR2"]),
          parseInt0(row["ComisionBAR3"]),
          parseInt0(row["ComisionBAR4"]),
          parseInt0(row["ComisionBAR5"]),
          parseInt0(row["ComisionBAR6"]),
          dias,
          bono75,
        ]
      );
      inserted++;
    } catch (err) {
      console.error(`Error deal ${dealId}:`, err.message);
      skipped++;
    }
  }

  console.log(`Done: ${inserted} inserted/updated, ${skipped} skipped`);
  console.log(`Deals with 75-day bonus: ${bonusCount}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
