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
import { graphGet } from "../meta-content/client.js";

const DAY_MS = 86_400_000;

const args = parseArgs(process.argv.slice(2));
if (!args.account) {
  console.error("Usage: --account=<name> --months=<n> [--out=<file>] [--no-carousel-children]");
  process.exit(1);
}
const monthsBack = Number(args.months ?? 2);
const includeChildren = !args["no-carousel-children"];

async function main() {
  const page = await findPage(args.account);
  console.error(`→ ${page.name} (@${page.igUsername}) — últimos ${monthsBack} meses`);
  if (!page.igUserId) throw new Error(`${page.name} has no linked Instagram account`);

  const items = await fetchWindowWithImageFields(page.igUserId, monthsBack, page.accessToken);
  console.error(`  ${items.length} posts en la ventana`);

  const posts = [];
  for (const m of items) {
    const entry = {
      id: m.id,
      timestamp: m.timestamp,
      date: m.timestamp?.slice(0, 10) ?? null,
      mediaType: m.media_type,
      caption: (m.caption ?? "").slice(0, 200),
      permalink: m.permalink,
      engagement: (m.like_count ?? 0) + (m.comments_count ?? 0),
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      images: [],
    };
    if (m.media_type === "IMAGE" && m.media_url) {
      entry.images.push({ url: m.media_url, kind: "image" });
    } else if (m.media_type === "VIDEO" && m.thumbnail_url) {
      entry.images.push({ url: m.thumbnail_url, kind: "video-cover" });
    } else if (m.media_type === "CAROUSEL_ALBUM" && includeChildren) {
      try {
        const kids = await graphGet(`/${m.id}/children`, {
          params: { fields: "id,media_type,media_url,thumbnail_url" },
          token: page.accessToken,
        });
        for (const child of kids.data ?? []) {
          const url = child.media_url || child.thumbnail_url;
          if (url) entry.images.push({ url, kind: child.media_type?.toLowerCase() ?? "child", childId: child.id });
        }
      } catch (err) {
        console.error(`  ⚠ carousel ${m.id}: ${err.message}`);
      }
    }
    posts.push(entry);
  }

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

async function fetchWindowWithImageFields(igUserId, monthsBack, token) {
  const cutoff = Date.now() - monthsBack * 30 * DAY_MS;
  const all = [];
  let after;
  for (let safety = 0; safety < 100; safety++) {
    const page = await instagram.listMedia(igUserId, {
      limit: 100,
      after,
      token,
      fields:
        "id,caption,media_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count",
    });
    if (!page.data.length) break;
    for (const m of page.data) {
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      if (ts && ts < cutoff) return all;
      all.push(m);
    }
    after = page.paging?.cursors?.after;
    if (!after) break;
  }
  return all;
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
