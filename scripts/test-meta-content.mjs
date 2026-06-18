// Read-only smoke test for the meta-content module.
//
// Verifies the token + Pages + Instagram links without writing anything:
//   - listPages() discovers every Page the token can manage
//   - lists the most recent Facebook posts for each Page
//   - lists the most recent Instagram media for each linked IG account
//
// Usage (from repo root, with META_CONTENT_TOKEN in env):
//   node scripts/test-meta-content.mjs
//
// Nothing here publishes or mutates. Safe to run repeatedly.
import { listPages, instagram, facebook } from "../meta-content/index.js";

async function main() {
  console.log("→ listPages()…");
  const pages = await listPages();
  console.log(`  Discovered ${pages.length} page(s):`);
  for (const p of pages) {
    const ig = p.igUserId ? `IG @${p.igUsername ?? "?"} (${p.igUserId})` : "IG: not linked";
    console.log(`  • ${p.name} (${p.pageId}) — ${ig}`);
  }

  let ok = 0;
  let failed = 0;

  for (const page of pages) {
    console.log(`\n─── ${page.name} ───`);

    try {
      const fb = await facebook.listPosts(page.pageId, {
        limit: 3,
        token: page.accessToken,
      });
      console.log(`  FB posts (${fb.data.length}):`);
      if (!fb.data.length) console.log("    (none)");
      for (const post of fb.data) {
        const when = post.created_time?.slice(0, 10) ?? "?";
        const text = (post.message ?? "(no text)").slice(0, 60);
        console.log(`    [${when}] ${text}`);
      }
      ok++;
    } catch (err) {
      console.log(`  ✗ FB error: ${err.message}`);
      failed++;
    }

    if (page.igUserId) {
      try {
        const ig = await instagram.listMedia(page.igUserId, {
          limit: 3,
          token: page.accessToken,
        });
        console.log(`  IG media (${ig.data.length}):`);
        if (!ig.data.length) console.log("    (none)");
        for (const m of ig.data) {
          const when = m.timestamp?.slice(0, 10) ?? "?";
          const text = (m.caption ?? "(no caption)").slice(0, 60);
          console.log(`    [${when}] ${m.media_type} · ♥${m.like_count ?? 0} · ${text}`);
        }
        ok++;
      } catch (err) {
        console.log(`  ✗ IG error: ${err.message}`);
        failed++;
      }
    } else {
      console.log("  IG: not linked (skipping)");
    }
  }

  console.log(`\n${failed === 0 ? "✓" : "⚠"}  ${ok} check(s) ok, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n✗ Smoke test failed:", err.message);
  process.exit(1);
});
