// Extract Instagram image URLs for a date-bounded window of one account.
//
// Carousel posts trigger an extra /{media_id}/children call to pull every
// frame (one image per child). Videos contribute their thumbnail_url (the
// cover frame) since the visual pattern study cares about the still image.
//
// Output is JSON to stdout (or --out file) with everything needed to
// download and label the images — public CDN URLs, no auth required to
// fetch the bytes downstream.
//
// Usage:
//   node scripts/extract-meta-image-urls.mjs --account=clinyco --months=2
//   node scripts/extract-meta-image-urls.mjs --account=doctorvillagran --months=6 --out=dv-6m.json
//   node scripts/extract-meta-image-urls.mjs --account=clinyco --months=2 --no-carousel-children
import fs from "node:fs";
import { findPage, instagram } from "../meta-content/index.js";

const args = parseArgs(process.argv.slice(2));
if (!args.account) {
  console.error("Usage: --account=<name> --months=<n> [--out=<file>] [--no-carousel-children]");
  process.exit(1);
}
const monthsBack = Number(args.months ?? 2);
const includeCarouselChildren = !args["no-carousel-children"];

async function main() {
  const page = await findPage(args.account);
  console.error(`→ ${page.name} (@${page.igUsername}) — últimos ${monthsBack} meses`);
  if (!page.igUserId) throw new Error(`${page.name} has no linked Instagram account`);

  const posts = await instagram.fetchWindowWithImages(page.igUserId, {
    monthsBack,
    includeCarouselChildren,
    token: page.accessToken,
  });
  console.error(`  ${posts.length} posts en la ventana`);

  // Trim caption for size (raw fetch returns full caption — only need a
  // snippet for downstream image-pattern study; permalink covers the rest).
  for (const p of posts) p.caption = p.caption.slice(0, 200);

  const payload = {
    account: {
      pageId: page.pageId,
      name: page.name,
      igUsername: page.igUsername,
      igUserId: page.igUserId,
    },
    window: { monthsBack, generatedAt: new Date().toISOString() },
    totalPosts: posts.length,
    totalImages: posts.reduce((s, e) => s + e.images.length, 0),
    posts,
  };

  const serialized = JSON.stringify(payload, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, serialized);
    console.error(`  → ${args.out}  (${payload.totalImages} image URLs, ${(serialized.length / 1024).toFixed(1)} KB)`);
  } else {
    process.stdout.write(serialized);
  }
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

main().catch((err) => {
  console.error("\n✗ Failed:", err.message);
  process.exit(1);
});
