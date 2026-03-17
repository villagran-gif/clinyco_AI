#!/usr/bin/env node

/**
 * Exporta cuerpos de conversación desde Zendesk usando:
 * GET /api/v2/tickets/{ticket_id}/conversation_log?page[size]=100
 *
 * Uso:
 *   node scripts/zendesk/export-conversation-log.js tickets_buenos_resueltos.csv
 *   node scripts/zendesk/export-conversation-log.js tickets_malos_resueltos.csv
 *
 * Variables de entorno requeridas:
 *   ZENDESK_SUBDOMAIN=clinyco
 *   ZENDESK_EMAIL=tu_correo
 *   ZENDESK_API_TOKEN=tu_token
 *
 * Salida:
 *   data/zendesk-exports/conversation_log_<input>_<timestamp>.jsonl
 */

const fs = require("fs");
const path = require("path");

const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || "clinyco";
const EMAIL = process.env.ZENDESK_EMAIL;
const API_TOKEN = process.env.ZENDESK_API_TOKEN;

const INPUT_FILE = process.argv[2];

if (!INPUT_FILE) {
  console.error("Falta archivo CSV.\nUso: node scripts/zendesk/export-conversation-log.js tickets_buenos_resueltos.csv");
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
  `conversation_log_${inputBase}_${timestamp}.jsonl`
);

const authHeader = "Basic " + Buffer.from(`${EMAIL}/token:${API_TOKEN}`).toString("base64");

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
  const idIndex = header.findIndex((h) => ["ticket_id", "id"].includes(h.trim().toLowerCase()));

  if (idIndex === -1) {
    throw new Error(`No encontré columna 'ticket_id' ni 'id'. Encabezados: ${header.join(", ")}`);
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
        "Content-Type": "application/json",
      },
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

function getNextUrl(payload) {
  if (payload?.links?.next) return payload.links.next;
  if (payload?.meta?.has_more && payload?.meta?.after_cursor) {
    return payload.links?.next || null;
  }
  if (payload?.next_page) return payload.next_page;
  return null;
}

function getRecords(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.conversation_log)) return payload.conversation_log;
  if (Array.isArray(payload?.records)) return payload.records;
  return [];
}

async function fetchConversationLog(ticketId) {
  let url = `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/conversation_log?page[size]=100`;
  const all = [];

  while (url) {
    const payload = await zendeskGet(url);
    const records = getRecords(payload);
    all.push(...records);
    url = getNextUrl(payload);
    await sleep(150);
  }

  return all;
}

async function main() {
  const ticketIds = readTicketIdsFromCsv(INPUT_PATH);
  console.log(`Tickets a procesar: ${ticketIds.length}`);
  console.log(`Salida: ${outputPath}`);

  const out = fs.createWriteStream(outputPath, { flags: "a" });

  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < ticketIds.length; i += 1) {
    const ticketId = ticketIds[i];

    try {
      const rows = await fetchConversationLog(ticketId);

      for (const row of rows) {
        out.write(
          JSON.stringify(
            {
              ticket_id: ticketId,
              exported_at: new Date().toISOString(),
              source: "conversation_log",
              row,
            },
            null,
            0
          ) + "\n"
        );
      }

      okCount += 1;
      console.log(`[${i + 1}/${ticketIds.length}] OK ticket ${ticketId} -> ${rows.length} eventos`);
    } catch (error) {
      failCount += 1;
      out.write(
        JSON.stringify(
          {
            ticket_id: ticketId,
            exported_at: new Date().toISOString(),
            source: "conversation_log",
            error: String(error.message || error),
          },
          null,
          0
        ) + "\n"
      );
      console.error(`[${i + 1}/${ticketIds.length}] ERROR ticket ${ticketId} -> ${error.message}`);
    }

    await sleep(200);
  }

  out.end();

  console.log("\nListo.");
  console.log(`OK: ${okCount}`);
  console.log(`ERROR: ${failCount}`);
  console.log(`Archivo generado: ${outputPath}`);
}

main().catch((err) => {
  console.error("Fallo general:", err);
  process.exit(1);
});
