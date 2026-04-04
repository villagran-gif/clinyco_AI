/**
 * scripts/import-deals.js — Import deals from Zendesk Sell CSV export.
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

const pool = new pg.Pool({ connectionString: DATABASE_URL });

function clean(val) {
  const s = String(val || "").trim();
  return s || null;
}

function parseDate(val) {
  const s = clean(val);
  if (!s) return null;
  // Handle "YYYY-MM-DD" and "YYYY-MM-DD HH:MM:SS"
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

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

  for (const row of records) {
    const dealId = clean(row["ID del trato"]);
    if (!dealId) { skipped++; continue; }

    try {
      await pool.query(
        `INSERT INTO deals (
          deal_name, deal_id, pipeline_phase, owner_name, added_at,
          contact_name, contact_id, contact_email, contact_phone,
          rut, ciudad, cirugia, fecha_cirugia, sucursal, origen,
          probabilidad_ganar, fecha_cambio_fase, fecha_cierre
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18
        ) ON CONFLICT (deal_id) DO UPDATE SET
          pipeline_phase = EXCLUDED.pipeline_phase,
          owner_name = EXCLUDED.owner_name,
          fecha_cambio_fase = EXCLUDED.fecha_cambio_fase,
          fecha_cierre = EXCLUDED.fecha_cierre`,
        [
          clean(row["Nombre del trato"]),
          dealId,
          clean(row["Fase del pipeline"]),
          clean(row["Propiedad"]),
          parseDate(row["Agregado el"]),
          clean(row["Contacto"]),
          clean(row["ID de contacto"]),
          clean(row["Correo electrónico"]) || clean(row["Correo"]) || clean(row["correo electrónico"]),
          clean(row["Teléfono"]) || clean(row["Telefono"]) || clean(row["Numero de teléfono"]),
          clean(row["RUT o ID"]) || clean(row["RUT O ID"]),
          clean(row["Ciudad"]),
          clean(row["CIRUGIA"]),
          parseDate(row["FECHA DE CIRUGÍA"]),
          clean(row["SUCURSAL"]),
          clean(row["Origen"]),
          clean(row["Probabilidad de ganar"]),
          parseDate(row["Fecha de cambio de la última fase"]),
          parseDate(row["Fecha de cierre"]),
        ]
      );
      inserted++;
    } catch (err) {
      console.error(`Error deal ${dealId}:`, err.message);
      skipped++;
    }
  }

  console.log(`Done: ${inserted} inserted/updated, ${skipped} skipped`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
