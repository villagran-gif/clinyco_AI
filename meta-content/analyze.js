// Analytics helpers for the meta-content module.
//
// Pulls a date-bounded window of media/posts and aggregates engagement by
// month, media type, weekday and hour-of-day. Designed to stay under Meta's
// rate limits by using basic fields (like_count, comments_count, reactions
// summary, comments summary, shares) — no per-media /insights calls. Add
// those later if reach/impressions become necessary.

import * as instagram from "./instagram.js";
import * as facebook from "./facebook.js";

const DAY_MS = 86_400_000;
// Spanish stopwords + a few generic English ones; tuned for IG captions.
const STOPWORDS = new Set([
  "de","la","el","los","las","un","una","unos","unas","y","o","u","en","a",
  "que","con","por","para","del","al","no","se","su","sus","es","son","fue",
  "ser","si","sí","muy","más","mas","también","tambien","ya","pero","como",
  "este","esta","estos","estas","eso","esa","ese","lo","le","les","tu","tú",
  "tus","mi","mis","te","me","nos","yo","él","ella","hay","ha","han","sobre",
  "todo","todos","cuando","donde","desde","hasta","entre","cada","ante","tras",
  "lugar","cómo","como","qué","que","quien","quién","cual","cuál","www","com",
  "https","http","the","and","for","you","your","with","this","that","are",
  "from","was","will","not","but","have","has","has","had","not","its","all",
  "any","can","may","one","two","new","get","old","out","ofrecemos","puedes",
]);

// Page through IG media until we cross the cutoff. Returns all items inside
// the window (chronologically newest first, the way Meta returns them).
export async function fetchIgWindow(igUserId, { monthsBack = 12, token } = {}) {
  const cutoff = Date.now() - monthsBack * 30 * DAY_MS;
  const all = [];
  let after;
  for (let safety = 0; safety < 100; safety++) {
    const page = await instagram.listMedia(igUserId, { limit: 100, after, token });
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

// Same for Facebook posts authored by the Page.
export async function fetchFbWindow(pageId, { monthsBack = 12, token } = {}) {
  const cutoff = Date.now() - monthsBack * 30 * DAY_MS;
  const all = [];
  let after;
  for (let safety = 0; safety < 100; safety++) {
    const page = await facebook.listPosts(pageId, { limit: 100, after, token });
    if (!page.data.length) break;
    for (const p of page.data) {
      const ts = p.created_time ? new Date(p.created_time).getTime() : 0;
      if (ts && ts < cutoff) return all;
      all.push(p);
    }
    after = page.paging?.cursors?.after;
    if (!after) break;
  }
  return all;
}

// Aggregate one platform's items into engagement breakdowns + top/bottom lists.
// platform: "ig" | "fb". Engagement model is intentionally additive (likes +
// comments [+ shares for FB]) — not weighted — so trends are easy to read.
export function aggregate(items, platform) {
  const byMonth = {};
  const byKind = {};
  const byWeekday = {};
  const byHour = {};
  const enriched = [];

  for (const item of items) {
    const tsRaw = platform === "ig" ? item.timestamp : item.created_time;
    if (!tsRaw) continue;
    const d = new Date(tsRaw);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const weekday = d.getUTCDay();
    const hour = d.getUTCHours();

    let engagement;
    let kind;
    let caption;
    let permalink;
    if (platform === "ig") {
      engagement = (item.like_count ?? 0) + (item.comments_count ?? 0);
      kind = item.media_type ?? "UNKNOWN";
      caption = item.caption ?? "";
      permalink = item.permalink ?? null;
    } else {
      const reactions = item.reactions?.summary?.total_count ?? 0;
      const comments = item.comments?.summary?.total_count ?? 0;
      const shares = item.shares?.count ?? 0;
      engagement = reactions + comments + shares;
      kind = "POST";
      caption = item.message ?? "";
      permalink = item.permalink_url ?? null;
    }

    bump(byMonth, month, engagement);
    bump(byKind, kind, engagement);
    bump(byWeekday, weekday, engagement);
    bump(byHour, hour, engagement);

    enriched.push({
      id: item.id,
      timestamp: tsRaw,
      kind,
      engagement,
      caption: caption.slice(0, 140),
      permalink,
    });
  }

  enriched.sort((a, b) => b.engagement - a.engagement);
  const top = enriched.slice(0, 10);
  const bottom = enriched.slice(-5).reverse();

  const wordFreq = {};
  for (const item of enriched) {
    const tokens = String(item.caption)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/);
    for (const w of tokens) {
      if (w.length < 4 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
      wordFreq[w] = (wordFreq[w] ?? 0) + 1;
    }
  }
  const topWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  return {
    total: enriched.length,
    byMonth,
    byKind,
    byWeekday,
    byHour,
    top,
    bottom,
    topWords,
  };
}

function bump(bucket, key, engagement) {
  if (!bucket[key]) bucket[key] = { count: 0, engagement: 0 };
  bucket[key].count++;
  bucket[key].engagement += engagement;
}

// Compute an "average engagement per post" view of a bucket, sorted desc.
export function rankByAvg(bucket) {
  return Object.entries(bucket)
    .map(([key, { count, engagement }]) => ({
      key,
      count,
      total: engagement,
      avg: count ? engagement / count : 0,
    }))
    .sort((a, b) => b.avg - a.avg);
}

const WEEKDAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Render a markdown report for one account (both platforms).
export function formatAccountReport(account, igAgg, fbAgg, monthsBack) {
  const lines = [];
  lines.push(`## ${account.name} (@${account.igUsername ?? "?"})`);
  lines.push("");
  lines.push(`- Instagram posts (últimos ${monthsBack}m): **${igAgg.total}**`);
  lines.push(`- Facebook posts (últimos ${monthsBack}m): **${fbAgg.total}**`);
  lines.push("");

  if (igAgg.total > 0) {
    lines.push(`### Instagram — formato con mejor engagement`);
    lines.push("");
    lines.push("| Formato | Posts | Engagement total | Avg/post |");
    lines.push("|---|---:|---:|---:|");
    for (const r of rankByAvg(igAgg.byKind)) {
      lines.push(`| ${r.key} | ${r.count} | ${r.total} | ${r.avg.toFixed(1)} |`);
    }
    lines.push("");

    lines.push(`### Instagram — mejor día de la semana (UTC)`);
    lines.push("");
    lines.push("| Día | Posts | Avg engagement |");
    lines.push("|---|---:|---:|");
    for (const r of rankByAvg(igAgg.byWeekday)) {
      lines.push(`| ${WEEKDAY_NAMES[r.key] ?? r.key} | ${r.count} | ${r.avg.toFixed(1)} |`);
    }
    lines.push("");

    lines.push(`### Instagram — top 10 posts`);
    lines.push("");
    for (const p of igAgg.top) {
      const when = p.timestamp.slice(0, 10);
      lines.push(`- **♥${p.engagement}** · ${when} · ${p.kind} · ${truncate(p.caption, 100)}`);
      if (p.permalink) lines.push(`  ${p.permalink}`);
    }
    lines.push("");

    lines.push(`### Instagram — keywords recurrentes (top 20)`);
    lines.push("");
    lines.push(igAgg.topWords.map(([w, n]) => `\`${w}\`×${n}`).join(" · "));
    lines.push("");
  }

  if (fbAgg.total > 0) {
    lines.push(`### Facebook — top 10 posts`);
    lines.push("");
    for (const p of fbAgg.top) {
      const when = p.timestamp.slice(0, 10);
      lines.push(`- **${p.engagement} engagement** · ${when} · ${truncate(p.caption, 100)}`);
      if (p.permalink) lines.push(`  ${p.permalink}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function truncate(s, n) {
  const flat = String(s).replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}
