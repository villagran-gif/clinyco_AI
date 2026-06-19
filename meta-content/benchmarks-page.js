// Reads the most recent benchmarks markdown file from data/benchmarks/
// and renders it as a styled HTML page. The directory is sorted by
// filename so naming files medical-YYYY-MM.md keeps "latest" predictable.

import fs from "node:fs";
import path from "node:path";
import { markdownToHtml } from "./markdown.js";

const DIR = "data/benchmarks";

export function listBenchmarkReports({ prefix = "" } = {}) {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".md") && (!prefix || f.startsWith(prefix)))
    .sort() // YYYY-MM filenames sort lexically = chronologically
    .reverse(); // newest first
}

export function readBenchmarkReport(filename) {
  const safe = path.basename(filename); // defense against ../ traversal
  const full = path.join(DIR, safe);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

const BASE_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #f8fafc;
  color: #1e293b;
  font: 15px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif;
}
.wrap {
  max-width: 980px;
  margin: 0 auto;
  padding: 32px 28px 64px;
}
.toolbar {
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 14px;
  margin-bottom: 24px;
}
.toolbar h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #64748b;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.toolbar .version {
  font-size: 12px;
  color: #475569;
}
.toolbar select {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  background: white;
  font-size: 13px;
}
h1 { font-size: 26px; margin: 0 0 16px; line-height: 1.3; }
h2 { font-size: 20px; margin: 32px 0 12px; padding-top: 8px; border-top: 1px solid #e2e8f0; }
h3 { font-size: 16px; margin: 24px 0 8px; color: #334155; }
p { margin: 12px 0; }
ul, ol { margin: 12px 0; padding-left: 24px; }
li { margin: 4px 0; }
strong { color: #0f172a; }
blockquote {
  border-left: 4px solid #7c3aed;
  background: #faf5ff;
  margin: 16px 0;
  padding: 12px 16px;
  font-size: 13px;
  color: #475569;
  border-radius: 0 6px 6px 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 13px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}
th {
  background: #f1f5f9;
  text-align: left;
  padding: 8px 10px;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: #475569;
}
td { padding: 8px 10px; border-top: 1px solid #e2e8f0; vertical-align: top; }
tr:nth-child(even) td { background: #f8fafc; }
code {
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  color: #0f766e;
}
hr {
  border: 0;
  border-top: 1px solid #e2e8f0;
  margin: 32px 0;
}
a { color: #2563eb; }
@media (max-width: 600px) {
  .wrap { padding: 20px 16px; }
  table { font-size: 12px; }
}
`;

export function renderBenchmarksPage({ markdown, currentFile, allFiles }) {
  const html = markdownToHtml(markdown ?? "_Sin reporte disponible._\n");
  const options = allFiles
    .map(
      (f) =>
        `<option value="${escape(f)}"${f === currentFile ? " selected" : ""}>${escape(humanize(f))}</option>`,
    )
    .join("");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Benchmarks redes médicas — ${escape(humanize(currentFile ?? ""))}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="wrap">
  <div class="toolbar">
    <h2>Benchmarks de redes sociales</h2>
    <span class="version">Reporte:</span>
    <select onchange="location.search='?file='+encodeURIComponent(this.value)">${options}</select>
    <span class="version" style="margin-left:auto;color:#94a3b8">Datos curados — fuentes citadas al final</span>
  </div>
  ${html}
</div>
</body>
</html>`;
}

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function humanize(filename) {
  // medical-2026-06.md → "Medical · 2026-06"
  // recomendaciones-2026-06.md → "Recomendaciones · 2026-06"
  return filename
    .replace(/\.md$/, "")
    .replace(/^(\w+)-(\d{4})-(\d{2})$/, (_, kind, y, m) => {
      const label = kind.charAt(0).toUpperCase() + kind.slice(1);
      return `${label} · ${y}-${m}`;
    });
}
