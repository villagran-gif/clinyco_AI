// Minimal GitHub-flavored-markdown → HTML renderer.
//
// Handles only the subset our benchmarks reports use:
//   - ATX headings (# .. ######)
//   - Paragraphs
//   - Tables (| col | col |, with separator row)
//   - Unordered lists (-, *) and ordered lists (1.)
//   - Bold (**text**), italic (*text*), code (`text`)
//   - Links ([text](url))
//   - Blockquotes (> text)
//   - Horizontal rules (---)
//   - Footnote-style references [n] (kept as plain text)
//
// Anything more elaborate (nested lists, fenced code blocks, images) is
// rendered as-is rather than failing — the report content is what it is.

function escape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Inline-formatting pass: bold/italic/code/links. Operates on already-
// escaped text so the HTML stays safe.
function inline(text) {
  return text
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`)
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_, c) => `<em>${c}</em>`)
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_, t, url) =>
        `<a href="${escape(url)}" target="_blank" rel="noopener">${t}</a>`,
    );
}

function renderTable(lines) {
  const rows = lines
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, ""))
    .map((l) => l.split("|").map((c) => c.trim()));
  if (rows.length < 2) return "";
  const [head, , ...body] = rows; // skip the separator row
  const thead =
    "<thead><tr>" +
    head.map((c) => `<th>${inline(escape(c))}</th>`).join("") +
    "</tr></thead>";
  const tbody =
    "<tbody>" +
    body
      .map(
        (r) =>
          "<tr>" + r.map((c) => `<td>${inline(escape(c))}</td>`).join("") + "</tr>",
      )
      .join("") +
    "</tbody>";
  return `<table>${thead}${tbody}</table>`;
}

export function markdownToHtml(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];

  let i = 0;
  let inList = false;
  let inPara = [];

  const flushPara = () => {
    if (inPara.length) {
      out.push(`<p>${inline(escape(inPara.join(" ")))}</p>`);
      inPara = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escape(heading[2]))}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      flushPara();
      closeList();
      out.push("<hr/>");
      i++;
      continue;
    }

    // Table — header line followed by a separator line
    if (trimmed.startsWith("|") && /^\|[\s|:-]+\|$/.test((lines[i + 1] || "").trim())) {
      flushPara();
      closeList();
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        block.push(lines[i]);
        i++;
      }
      out.push(renderTable(block));
      continue;
    }

    // Blockquote
    if (/^>\s+/.test(trimmed)) {
      flushPara();
      closeList();
      const block = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        block.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(escape(block.join(" ")))}</blockquote>`);
      continue;
    }

    // List item
    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      const text = trimmed.replace(/^[-*]\s+/, "");
      out.push(`<li>${inline(escape(text))}</li>`);
      i++;
      continue;
    }

    // Numbered list — render as <ol> if we hit one (rare in our reports)
    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara();
      if (!inList) {
        out.push("<ol>");
        inList = "ol";
      }
      const text = trimmed.replace(/^\d+\.\s+/, "");
      out.push(`<li>${inline(escape(text))}</li>`);
      i++;
      continue;
    }

    // Blank line → end of paragraph / list
    if (trimmed === "") {
      flushPara();
      if (inList === "ol") {
        out.push("</ol>");
        inList = false;
      } else {
        closeList();
      }
      i++;
      continue;
    }

    // Otherwise: paragraph accumulation
    closeList();
    inPara.push(trimmed);
    i++;
  }

  flushPara();
  closeList();
  if (inList === "ol") out.push("</ol>");

  return out.join("\n");
}
