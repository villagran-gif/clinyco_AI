#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || "clinyco";
const EMAIL = process.env.ZENDESK_EMAIL;
const API_TOKEN = process.env.ZENDESK_API_TOKEN;

const INPUT_FILE = process.argv[2];

if (!INPUT_FILE) {
  console.error("Uso: node scripts/export-audits.cjs data/input/tickets_buenos_resueltos.csv");
  process.exit(1);
}

if (!EMAIL || !API_TOKEN) {
  console.error("Faltan variables de entorno: ZENDESK_EMAIL y/o ZENDESK_API_TOKEN");
  process.exit(1);
}

const INPUT_PATH = path.resolve(INPUT_FILE);
if (!fs.existsSync(INPUT_PATH)) {
  console.error(`No existe el archivo: ${INPUT_PATH}`);
  process.exit(1);
}

const EXPORT_DIR = path.resolve("data", "zendesk-exports");
fs.mkdirSync(EXPORT_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const inputBase = path.basename(INPUT_FILE, path.extname(INPUT_FILE));
const outputPath = path.join(
  EXPORT_DIR,
  `audits_${inputBase}_${timestamp}.jsonl`
);

const authHeader =
  "Basic " + Buffer.from(`${EMAIL}/token:${API_TOKEN}`).toString("base64");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((v) => v.trim());
}

function readTicketIdsFromCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV vacío o sin filas de datos");
  }

  const header = parseCsvLine(lines[0]);
  const idIndex = header.findIndex((h) =>
    ["ticket_id", "id"].includes(h.trim().toLowerCase())
  );

  if (idIndex === -1) {
    throw new Error(
      `No encontré columna 'ticket_id' ni 'id'. Encabezados: ${header.join(", ")}`
    );
  }

  const ids = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const ticketId = (cols[idIndex] || "").trim();
    if (ticketId) ids.push(ticketId);
  }

  return [...new Set(ids)];
}

async function zendeskGet(url) {
  while (true) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || 5);
      console.warn(`Rate limit. Esperando ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} - ${text.slice(0, 500)}`);
    }

    return res.json();
  }
}

async function fetchAudits(ticketId) {
  let url = `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/audits.json`;
  const audits = [];

  while (url) {
    const payload = await zendeskGet(url);
    const rows = Array.isArray(payload?.audits) ? payload.audits : [];
    audits.push(...rows);
    url = payload?.next_page || null;
    await sleep(150);
  }

  return audits;
}

function extractCommentEvents(audit) {
  const events = Array.isArray(audit?.events) ? audit.events : [];
  return events
    .filter((event) =>
      ["Comment", "VoiceComment", "ChatStartedEvent", "ChatEndedEvent"].includes(event?.type)
    )
    .map((event) => ({
      audit_id: audit.id,
      created_at: audit.created_at,
      author_id: audit.author_id,
      via: audit.via || null,
      event_type: event.type,
      public: typeof event.public === "boolean" ? event.public : null,
      body: event.body || null,
      html_body: event.html_body || null,
      plain_body: event.plain_body || null,
      attachments: event.attachments || [],
      metadata: event.metadata || null
    }));
}

async function main() {
  const ticketIds = readTicketIdsFromCsv(INPUT_PATH);
  console.log(`Tickets a procesar: ${ticketIds.length}`);
  console.log(`Salida: ${outputPath}`);

  const out = fs.createWriteStream(outputPath, { flags: "a" });

  let okCount = 0;
  let failCount = 0;
  let totalComments = 0;

  for (let i = 0; i < ticketIds.length; i += 1) {
    const ticketId = ticketIds[i];

    try {
      const audits = await fetchAudits(ticketId);
      let commentCount = 0;

      for (const audit of audits) {
        const comments = extractCommentEvents(audit);

        if (comments.length) {
          for (const comment of comments) {
            out.write(
              JSON.stringify({
                ticket_id: ticketId,
                exported_at: new Date().toISOString(),
                source: "ticket_audits",
                ...comment
              }) + "\n"
            );
            commentCount += 1;
          }
        }
      }

      totalComments += commentCount;
      okCount += 1;
      console.log(
        `[${i + 1}/${ticketIds.length}] OK ticket ${ticketId} -> ${audits.length} audits, ${commentCount} comentarios`
      );
    } catch (error) {
      failCount += 1;
      out.write(
        JSON.stringify({
          ticket_id: ticketId,
          exported_at: new Date().toISOString(),
          source: "ticket_audits",
          error: String(error.message || error)
        }) + "\n"
      );
      console.error(`[${i + 1}/${ticketIds.length}] ERROR ticket ${ticketId} -> ${error.message}`);
    }

    await sleep(200);
  }

  out.end();

  console.log("\nListo.");
  console.log(`OK: ${okCount}`);
  console.log(`ERROR: ${failCount}`);
  console.log(`Comentarios extraídos: ${totalComments}`);
  console.log(`Archivo generado: ${outputPath}`);
}

main().catch((err) => {
  console.error("Fallo general:", err);
  process.exit(1);
});
