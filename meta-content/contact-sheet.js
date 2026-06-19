// HTML contact-sheet generator for visual pattern study (IG + Facebook).
//
// Given posts (already normalized — each post has source: "instagram" or
// "facebook"), emits a self-contained HTML page with a CSS grid of cards.
// Each card carries: engagement metrics, source badge, every image side-by-
// side, caption snippet, and the permalink. Stories (live last-24h IG ring)
// are rendered as a separate strip above the post grid when available.
// The page is self-contained (inline CSS) so the route handler can stream
// it straight to the browser.

import { explain } from "./glossary.js";

const SOURCE_LABEL = {
  all: "Instagram + Facebook",
  ig: "solo Instagram",
  fb: "solo Facebook",
};

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s, n) {
  const flat = String(s).replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

function sourceBadge(source) {
  if (source === "instagram") {
    return `<span class="src ig" title="Instagram">IG</span>`;
  }
  if (source === "facebook") {
    return `<span class="src fb" title="Facebook">FB</span>`;
  }
  return "";
}

function emptyMessage({ counts, source, monthsBack }) {
  const where =
    source === "ig"
      ? "Instagram"
      : source === "fb"
        ? "Facebook"
        : "Instagram ni Facebook";
  const hint =
    counts.ig + counts.fb === 0
      ? "Esta cuenta no publicó nada en el período seleccionado. Prueba ampliar a 12 meses, o esta cuenta puede estar inactiva."
      : "Con el filtro actual no hay posts; cambia el filtro de fuente arriba para ver lo que sí existe.";
  return `
    <div style="padding: 60px 32px; text-align: center; color: #8b949e;">
      <p style="font-size:16px;margin:0 0 8px">
        Sin posts en ${escape(where)} en los últimos ${monthsBack} meses.
      </p>
      <p style="font-size:13px;margin:0">${escape(hint)}</p>
      <p style="font-size:12px;margin:14px 0 0;color:#6e7681">
        Conteos totales en la ventana: ${counts.ig} en Instagram · ${counts.fb} en Facebook
      </p>
    </div>`;
}

export function renderContactSheet({
  account,
  monthsBack,
  source = "all",
  sort = "engagement",
  posts,
  stories = [],
  counts = { ig: 0, fb: 0 },
  generatedAt,
}) {
  const totalImages = posts.reduce((s, p) => s + p.images.length, 0);
  const sortGloss = explain(sort);
  const sortLabel = sortGloss?.name ?? sort;
  const sourceLabel = SOURCE_LABEL[source] ?? source;

  const cards = posts.length
    ? posts
        .map((p) => {
          const thumbs = p.images.length
            ? p.images
                .map((img) => `<img loading="lazy" src="${escape(img.url)}" alt="" />`)
                .join("")
            : `<div class="no-image">sin imagen</div>`;
          const caption = truncate(p.caption ?? "", 220);
          // Foreground the active sort metric, keep the others as a row
          const metrics = `
            <div class="metrics">
              <span class="m ${sort === "likes" ? "active" : ""}">♥ ${p.likes ?? 0}</span>
              <span class="m ${sort === "comments" ? "active" : ""}">💬 ${p.comments ?? 0}</span>
              ${p.source === "facebook" ? `<span class="m ${sort === "shares" ? "active" : ""}">↗ ${p.shares ?? 0}</span>` : ""}
              <span class="m total ${sort === "engagement" ? "active" : ""}">Σ ${p.engagement ?? 0}</span>
            </div>`;
          return `
            <article class="card">
              <header>
                ${sourceBadge(p.source)}
                <span class="kind">${escape(p.mediaType)}</span>
                <span class="date">${escape(p.date ?? "")}</span>
              </header>
              ${metrics}
              <div class="strip">${thumbs}</div>
              <p class="caption">${escape(caption)}</p>
              ${p.permalink ? `<a class="perma" href="${escape(p.permalink)}" target="_blank" rel="noopener">abrir post ↗</a>` : ""}
            </article>`;
        })
        .join("\n")
    : emptyMessage({ counts, source, monthsBack });

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escape(account.name)} — últimos ${monthsBack} meses</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #0d1117;
    color: #c9d1d9;
    font: 14px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  header.page {
    padding: 24px 32px 14px;
    border-bottom: 1px solid #21262d;
  }
  header.page h1 {
    margin: 0 0 6px;
    font-size: 19px;
    font-weight: 600;
  }
  header.page .meta {
    color: #8b949e;
    font-size: 12px;
    line-height: 1.6;
  }
  header.page .meta b { color: #c9d1d9; font-weight: 600; }
  header.page .explain {
    margin-top: 8px;
    padding: 12px 14px;
    background: #161b22;
    border-left: 3px solid #f78166;
    border-radius: 4px;
    color: #c9d1d9;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .explain-row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    line-height: 1.55;
  }
  .explain-tag {
    flex: 0 0 auto;
    padding: 1px 7px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.3px;
    white-space: nowrap;
    margin-top: 1px;
  }
  .explain-tag.basic { background: #1f6feb; color: #fff; }
  .explain-tag.tech { background: #6e3edc; color: #fff; }
  .explain-sources { color: #8b949e; font-size: 11px; padding-top: 2px; }
  .explain-sources code {
    background: #21262d;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    color: #c9d1d9;
  }
  .stories {
    background: #161b22;
    border-bottom: 1px solid #21262d;
    padding: 12px 32px;
  }
  .stories-head {
    display: flex;
    gap: 12px;
    align-items: baseline;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .story-pill {
    background: linear-gradient(135deg, #f56040, #c13584, #833ab4);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    padding: 3px 10px;
    border-radius: 12px;
  }
  .story-pill b { font-weight: 700; }
  .stories-hint { color: #8b949e; font-size: 11px; }
  .stories-strip {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .story {
    flex: 0 0 auto;
    width: 120px;
    text-decoration: none;
    color: #c9d1d9;
  }
  .story img {
    width: 120px;
    height: 200px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid #21262d;
    background: #0d1117;
  }
  .story-meta {
    display: block;
    font-size: 10px;
    color: #8b949e;
    padding-top: 4px;
    text-align: center;
  }
  main {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 18px;
    padding: 24px 32px 48px;
  }
  .card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .card header {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid #21262d;
    font-size: 12px;
  }
  .src {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .src.ig { background: #6e3edc; color: #fff; }
  .src.fb { background: #1d4ed8; color: #fff; }
  .card .kind {
    color: #8b949e;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .card .date {
    margin-left: auto;
    color: #8b949e;
    font-variant-numeric: tabular-nums;
  }
  .metrics {
    display: flex;
    gap: 12px;
    padding: 8px 14px;
    border-bottom: 1px solid #21262d;
    font-size: 12px;
    color: #8b949e;
  }
  .metrics .m { font-variant-numeric: tabular-nums; }
  .metrics .m.active { color: #f78166; font-weight: 600; }
  .metrics .m.total { margin-left: auto; }
  .strip {
    display: flex;
    overflow-x: auto;
    background: #0d1117;
  }
  .strip img {
    height: 240px;
    width: auto;
    flex: 0 0 auto;
    border-right: 1px solid #21262d;
    object-fit: cover;
  }
  .strip img:last-child { border-right: 0; }
  .strip .no-image {
    padding: 60px 24px;
    color: #6e7681;
    font-size: 12px;
    width: 100%;
    text-align: center;
  }
  .caption {
    margin: 0;
    padding: 12px 14px;
    color: #c9d1d9;
    font-size: 13px;
  }
  .perma {
    display: block;
    padding: 0 14px 12px;
    color: #58a6ff;
    text-decoration: none;
    font-size: 12px;
  }
  .perma:hover { text-decoration: underline; }
  @media (max-width: 600px) {
    main { padding: 16px; grid-template-columns: 1fr; }
    .strip img { height: 200px; }
  }
</style>
</head>
<body>
<header class="page">
  <h1>${escape(account.name)} <span style="color:#8b949e;font-weight:400">— @${escape(account.igUsername ?? "?")}</span></h1>
  <div class="meta">
    Últimos <b>${monthsBack}</b> meses · Fuente: <b>${escape(sourceLabel)}</b> ·
    Ordenado por <b>${escape(sortLabel)}</b>
    <br />
    <b>${posts.length}</b> posts (${counts.ig} IG + ${counts.fb} FB) · <b>${totalImages}</b> imágenes ·
    Generado ${escape(generatedAt)}
  </div>
  ${sortGloss ? renderExplainPanel(sortGloss) : ""}
</header>
${renderStoriesStrip(stories)}
<main>${cards}</main>
</body>
</html>`;
}

function renderExplainPanel(g) {
  const sources = g.sources?.length
    ? `<div class="explain-sources">Fuentes: ${g.sources.map((s) => `<code>${escape(s)}</code>`).join(" · ")}</div>`
    : "";
  return `
    <div class="explain">
      <div class="explain-row">
        <span class="explain-tag basic">🧒 Básico</span>
        <span>${escape(g.basic)}</span>
      </div>
      <div class="explain-row">
        <span class="explain-tag tech">👨‍⚕️ Técnico</span>
        <span>${escape(g.technical)}</span>
      </div>
      ${sources}
    </div>`;
}

function renderStoriesStrip(stories) {
  if (!stories.length) return "";
  const items = stories
    .map((s) => {
      const url = s.media_type === "VIDEO" ? s.thumbnail_url : s.media_url;
      if (!url) return "";
      const ago = humanAgo(s.timestamp);
      return `
        <a class="story" href="${escape(s.permalink ?? "#")}" target="_blank" rel="noopener" title="${escape(ago)}">
          <img loading="lazy" src="${escape(url)}" alt="" />
          <span class="story-meta">${escape(s.media_type ?? "")} · ${escape(ago)}</span>
        </a>`;
    })
    .join("");
  return `
    <section class="stories">
      <div class="stories-head">
        <span class="story-pill">STORIES activas <b>${stories.length}</b></span>
        <span class="stories-hint">Estos son los Stories de las últimas 24 h. El archivo histórico no es consultable vía API — para tendencias hay que registrarlos diariamente.</span>
      </div>
      <div class="stories-strip">${items}</div>
    </section>`;
}

function humanAgo(timestamp) {
  if (!timestamp) return "?";
  const ms = Date.now() - new Date(timestamp).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
