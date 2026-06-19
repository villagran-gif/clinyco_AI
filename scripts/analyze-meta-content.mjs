// 12-month analytics for every Page discovered by meta-content/index.js.
//
// Outputs:
//   data/meta-content-analysis/<account>-<YYYY-MM-DD>.json   (raw + aggregated)
//   data/meta-content-analysis/report-<YYYY-MM-DD>.md         (human-readable)
//
// Usage:
//   node scripts/analyze-meta-content.mjs              # default: 12 months
//   node scripts/analyze-meta-content.mjs --months=6   # custom window
//   node scripts/analyze-meta-content.mjs --only=clinyco  # one account
//
// Read-only against Meta. Safe to run as often as you like; rate-limits are
// generous for these endpoints (no /insights per-media calls used).
import fs from "node:fs";
import path from "node:path";
import { listPages, instagram, facebook } from "../meta-content/index.js";
import {
  fetchIgWindow,
  fetchFbWindow,
  aggregate,
  formatAccountReport,
  rankByAvg,
} from "../meta-content/analyze.js";

const args = parseArgs(process.argv.slice(2));
const monthsBack = Number(args.months ?? 12);
const only = args.only ? String(args.only).toLowerCase() : null;

const outDir = "data/meta-content-analysis";
const today = new Date().toISOString().slice(0, 10);

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`→ Discovering pages…`);
  const pages = await listPages();
  const targets = only
    ? pages.filter((p) => p.name.toLowerCase().includes(only) || (p.igUsername ?? "").toLowerCase().includes(only))
    : pages;
  if (!targets.length) {
    throw new Error(`No pages matched --only=${only}. Available: ${pages.map((p) => p.name).join(", ")}`);
  }
  console.log(`  ${targets.length} of ${pages.length} page(s) selected.`);

  const reportLines = [];
  reportLines.push(`# Meta Content Analysis — ${today}`);
  reportLines.push("");
  reportLines.push(`Window: últimos ${monthsBack} meses · Generated: ${new Date().toISOString()}`);
  reportLines.push("");

  for (const page of targets) {
    console.log(`\n─── ${page.name} ───`);

    let igItems = [];
    let igAgg = empty();
    if (page.igUserId) {
      process.stdout.write("  IG fetch… ");
      igItems = await fetchIgWindow(page.igUserId, { monthsBack, token: page.accessToken });
      igAgg = aggregate(igItems, "ig");
      console.log(`${igItems.length} posts`);
    } else {
      console.log("  IG: not linked, skipping");
    }

    process.stdout.write("  FB fetch… ");
    const fbItems = await fetchFbWindow(page.pageId, { monthsBack, token: page.accessToken });
    const fbAgg = aggregate(fbItems, "fb");
    console.log(`${fbItems.length} posts`);

    // Per-account JSON dump
    const accountSlug = (page.igUsername || slugify(page.name)).replace(/^@/, "");
    const jsonPath = path.join(outDir, `${accountSlug}-${today}.json`);
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          window: { monthsBack },
          account: {
            pageId: page.pageId,
            name: page.name,
            igUserId: page.igUserId,
            igUsername: page.igUsername,
          },
          instagram: { items: igItems, aggregations: igAgg },
          facebook: { items: fbItems, aggregations: fbAgg },
        },
        null,
        2,
      ),
    );
    console.log(`  → ${jsonPath}`);

    reportLines.push(formatAccountReport(page, igAgg, fbAgg, monthsBack));
    reportLines.push("");
    reportLines.push("---");
    reportLines.push("");
  }

  // Cross-account comparison
  reportLines.push(`## Comparativa entre cuentas`);
  reportLines.push("");
  reportLines.push("| Cuenta | IG posts | IG ♥+💬 total | IG avg/post | FB posts | FB engagement total |");
  reportLines.push("|---|---:|---:|---:|---:|---:|");
  for (const page of targets) {
    const j = JSON.parse(
      fs.readFileSync(
        path.join(outDir, `${(page.igUsername || slugify(page.name)).replace(/^@/, "")}-${today}.json`),
        "utf8",
      ),
    );
    const igTotal = sumEngagement(j.instagram.aggregations.byKind);
    const fbTotal = sumEngagement(j.facebook.aggregations.byKind);
    const igAvg = j.instagram.aggregations.total ? (igTotal / j.instagram.aggregations.total).toFixed(1) : "—";
    reportLines.push(
      `| ${page.name} | ${j.instagram.aggregations.total} | ${igTotal} | ${igAvg} | ${j.facebook.aggregations.total} | ${fbTotal} |`,
    );
  }
  reportLines.push("");

  const reportPath = path.join(outDir, `report-${today}.md`);
  fs.writeFileSync(reportPath, reportLines.join("\n"));
  console.log(`\n✓ Report written: ${reportPath}`);
  console.log(`  Open it locally or cat it: cat ${reportPath}`);
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = true;
  }
  return out;
}

function slugify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function empty() {
  return { total: 0, byMonth: {}, byKind: {}, byWeekday: {}, byHour: {}, top: [], bottom: [], topWords: [] };
}

function sumEngagement(byKind) {
  return Object.values(byKind).reduce((s, v) => s + (v.engagement ?? 0), 0);
}

main().catch((err) => {
  console.error("\n✗ Analysis failed:", err.message);
  process.exit(1);
});
