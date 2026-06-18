// Read-only smoke test for the meta-content module.
//
// Verifies the token + Page + Instagram link without writing anything:
//   - bootstrap() resolves the IG Business account from the Page
//   - lists the most recent Facebook posts
//   - lists the most recent Instagram media
//
// Usage (from repo root, with META_CONTENT_TOKEN + META_PAGE_ID in env):
//   node scripts/test-meta-content.mjs
//
// Nothing here publishes or mutates. Safe to run repeatedly.
import { bootstrap, instagram, facebook } from "../meta-content/index.js";

async function main() {
  console.log("→ bootstrap()…");
  const ctx = await bootstrap();
  console.log("  Page:", ctx.pageName, `(${ctx.pageId})`);
  console.log("  IG:  ", ctx.igUsername ?? "(no username)", `(${ctx.igUserId})`);

  console.log("\n→ recent Facebook posts…");
  const fb = await facebook.listPosts(ctx.pageId, { limit: 3 });
  for (const p of fb.data) {
    const when = p.created_time?.slice(0, 10) ?? "?";
    const text = (p.message ?? "(no text)").slice(0, 60);
    console.log(`  [${when}] ${text}`);
  }
  if (!fb.data.length) console.log("  (none)");

  console.log("\n→ recent Instagram media…");
  const ig = await instagram.listMedia(ctx.igUserId, { limit: 3 });
  for (const m of ig.data) {
    const when = m.timestamp?.slice(0, 10) ?? "?";
    const text = (m.caption ?? "(no caption)").slice(0, 60);
    console.log(`  [${when}] ${m.media_type} · ♥${m.like_count ?? 0} · ${text}`);
  }
  if (!ig.data.length) console.log("  (none)");

  console.log("\n✓ Read-only smoke test passed — token, Page and IG link are healthy.");
}

main().catch((err) => {
  console.error("\n✗ Smoke test failed:", err.message);
  process.exit(1);
});
