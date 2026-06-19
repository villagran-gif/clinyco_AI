// HTML contact-sheet generator for visual pattern study.
//
// Given a window of IG media (already expanded — carousels split into
// children), emits a self-contained HTML page with a CSS grid of cards,
// sorted by engagement desc. Each card shows every frame side-by-side so
// the carousel narrative is visible at a glance.
//
// The page is self-contained (inline CSS, no external assets) so the
// route handler can stream it straight to the browser.

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

// Build the HTML. `posts` is the same shape as
// scripts/extract-meta-image-urls.mjs returns:
//   { id, timestamp, date, mediaType, caption, permalink, engagement, images: [{url, kind}] }
export function renderContactSheet({ account, monthsBack, posts, generatedAt }) {
  const sorted = [...posts].sort((a, b) => b.engagement - a.engagement);
  const totalImages = sorted.reduce((s, p) => s + p.images.length, 0);

  const cards = sorted
    .map((p) => {
      const thumbs = p.images
        .map((img) => `<img loading="lazy" src="${escape(img.url)}" alt="" />`)
        .join("");
      const caption = truncate(p.caption ?? "", 220);
      return `
        <article class="card">
          <header>
            <span class="eng">♥ ${p.engagement}</span>
            <span class="kind">${escape(p.mediaType)}</span>
            <span class="date">${escape(p.date ?? "")}</span>
          </header>
          <div class="strip">${thumbs}</div>
          <p class="caption">${escape(caption)}</p>
          ${p.permalink ? `<a class="perma" href="${escape(p.permalink)}" target="_blank" rel="noopener">abrir en Instagram ↗</a>` : ""}
        </article>`;
    })
    .join("\n");

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
    padding: 28px 32px 12px;
    border-bottom: 1px solid #21262d;
  }
  header.page h1 {
    margin: 0 0 6px;
    font-size: 20px;
    font-weight: 600;
  }
  header.page .meta {
    color: #8b949e;
    font-size: 12px;
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
  .card .eng {
    color: #f78166;
    font-weight: 600;
  }
  .card .kind {
    color: #8b949e;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .card .date {
    margin-left: auto;
    color: #8b949e;
    font-variant-numeric: tabular-nums;
  }
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
    Últimos ${monthsBack} meses · ${sorted.length} posts · ${totalImages} imágenes · ordenado por engagement
    · generado ${escape(generatedAt)}
  </div>
</header>
<main>${cards}</main>
</body>
</html>`;
}
