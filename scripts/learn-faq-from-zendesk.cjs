#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {
    envFile: null,
    query: "type:ticket via:whatsapp",
    limit: 40,
    minFrequency: 2,
    outDir: path.resolve("data", "zendesk-exports")
  };

  for (const token of argv.slice(2)) {
    if (!token.startsWith("--")) continue;
    const [rawKey, rawValue = ""] = token.slice(2).split("=");
    const key = rawKey.trim();
    const value = rawValue.trim();

    if (key === "env-file") args.envFile = value || null;
    if (key === "query") args.query = value || args.query;
    if (key === "limit") args.limit = Number(value) || args.limit;
    if (key === "min-frequency") args.minFrequency = Number(value) || args.minFrequency;
    if (key === "out-dir") args.outDir = value ? path.resolve(value) : args.outDir;
  }

  return args;
}

function parseEnvFile(filePath) {
  const env = {};
  if (!filePath) return env;
  if (!fs.existsSync(filePath)) return env;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    env[key] = value;
  }
  return env;
}

function getEnv(name, fallback = null, envFile = {}) {
  if (process.env[name]) return process.env[name];
  if (envFile[name]) return envFile[name];
  return fallback;
}

function buildAuthHeader(email, token) {
  return "Basic " + Buffer.from(`${email}/token:${token}`).toString("base64");
}

async function zendeskGetJson(url, authHeader) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Zendesk HTTP ${response.status}: ${raw.slice(0, 240)}`);
  }
  return raw ? JSON.parse(raw) : {};
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQuestion(text) {
  return cleanText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9?\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSignature(text) {
  return cleanText(text)
    .replace(/(Saludos|Quedo atenta|Atte\.?|Gracias).*$/i, "")
    .replace(/\b(Antonia|Answer Bot)\b/gi, "")
    .trim();
}

function extractQuestionCandidate(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;

  const lines = cleaned
    .split(/\s{2,}|\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);

  const preferred = lines.find((line) => /[?¿]/.test(line));
  const candidate = preferred || lines[0] || cleaned;

  if (candidate.length < 10) return null;
  if (!/[?¿]/.test(candidate) && !/(quiero|necesito|tienen|como|cual|cuanto|agendar|hora|valor)/i.test(candidate)) {
    return null;
  }
  return candidate;
}

async function fetchRecentTickets({ subdomain, authHeader, query, limit }) {
  const perPage = 100;
  let page = 1;
  const tickets = [];

  while (tickets.length < limit) {
    const url = `https://${subdomain}.zendesk.com/api/v2/search.json?query=${encodeURIComponent(query)}&sort_by=updated_at&sort_order=desc&page=${page}&per_page=${perPage}`;
    const payload = await zendeskGetJson(url, authHeader);
    const pageTickets = (payload.results || []).filter((item) => item?.result_type === "ticket");
    if (!pageTickets.length) break;
    tickets.push(...pageTickets);
    if (!payload.next_page) break;
    page += 1;
  }

  return tickets.slice(0, limit);
}

async function fetchTicketAudits({ subdomain, authHeader, ticketId }) {
  let url = `https://${subdomain}.zendesk.com/api/v2/tickets/${ticketId}/audits.json?page=1&per_page=100`;
  const all = [];

  while (url) {
    const payload = await zendeskGetJson(url, authHeader);
    all.push(...(payload.audits || []));
    url = payload.next_page || null;
  }

  return all;
}

function extractHistoryFromAudits(audits = []) {
  const byId = new Map();

  for (const audit of audits) {
    for (const event of audit.events || []) {
      if (event?.type !== "ChatStartedEvent") continue;
      const history = Array.isArray(event?.value?.history) ? event.value.history : [];
      for (const item of history) {
        if (item?.type !== "ChatMessage") continue;
        const message = cleanText(item.message);
        if (!message) continue;
        const id =
          item.message_id ||
          item.event_id ||
          `${item.actor_type || "unknown"}:${item.actor_id || "unknown"}:${item.timestamp || Date.now()}:${message.slice(0, 24)}`;
        if (!byId.has(id)) {
          byId.set(id, {
            id,
            timestamp: Number(item.timestamp || 0),
            actorType: cleanText(item.actor_type || ""),
            actorName: cleanText(item.actor_name || ""),
            message
          });
        }
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function isHumanAgentMessage(entry) {
  const actorType = String(entry?.actorType || "").toLowerCase();
  const actorName = String(entry?.actorName || "").toLowerCase();
  if (actorType !== "agent") return false;
  if (actorName.includes("answer bot") || actorName.includes("antonia") || actorName.includes("chat bot")) return false;
  return Boolean(cleanText(entry?.message));
}

function isEndUserMessage(entry) {
  const actorType = String(entry?.actorType || "").toLowerCase();
  if (actorType !== "end-user") return false;
  return Boolean(cleanText(entry?.message));
}

function toTsv(rows) {
  const headers = [
    "Activo",
    "Pregunta frecuente",
    "Respuesta aprobada",
    "Cuando derivar a persona",
    "No prometer",
    "Notas para el bot"
  ];
  const lines = [headers.join("\t")];
  for (const row of rows) {
    const values = headers.map((key) => String(row[key] || "").replace(/\t/g, " ").replace(/\r?\n/g, " "));
    lines.push(values.join("\t"));
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const args = parseArgs(process.argv);
  const envFile = parseEnvFile(args.envFile);
  const subdomain = getEnv("ZENDESK_SUBDOMAIN", null, envFile);
  const email = getEnv("ZENDESK_SUPPORT_EMAIL", getEnv("ZENDESK_EMAIL", null, envFile), envFile);
  const token = getEnv("ZENDESK_SUPPORT_TOKEN", getEnv("ZENDESK_API_TOKEN", null, envFile), envFile);

  if (!subdomain || !email || !token) {
    throw new Error("Missing Zendesk credentials (subdomain/email/token).");
  }

  const authHeader = buildAuthHeader(email, token);
  fs.mkdirSync(args.outDir, { recursive: true });

  const tickets = await fetchRecentTickets({
    subdomain,
    authHeader,
    query: args.query,
    limit: args.limit
  });

  const pairsByQuestion = new Map();
  let processedTickets = 0;

  for (const ticket of tickets) {
    const audits = await fetchTicketAudits({
      subdomain,
      authHeader,
      ticketId: ticket.id
    });
    if (!audits.length) continue;

    const history = extractHistoryFromAudits(audits);
    if (!history.length) continue;

    let pendingQuestion = null;

    for (const entry of history) {
      if (isEndUserMessage(entry)) {
        const candidate = extractQuestionCandidate(entry.message);
        if (candidate) {
          pendingQuestion = candidate;
        }
        continue;
      }

      if (pendingQuestion && isHumanAgentMessage(entry)) {
        const normalized = normalizeQuestion(pendingQuestion);
        if (!normalized) {
          pendingQuestion = null;
          continue;
        }

        const answer = stripSignature(entry.message);
        if (!answer || answer.length < 12) {
          pendingQuestion = null;
          continue;
        }

        if (!pairsByQuestion.has(normalized)) {
          pairsByQuestion.set(normalized, {
            question: pendingQuestion,
            total: 0,
            answers: new Map(),
            ticketIds: new Set()
          });
        }

        const bucket = pairsByQuestion.get(normalized);
        bucket.total += 1;
        bucket.ticketIds.add(ticket.id);
        bucket.answers.set(answer, (bucket.answers.get(answer) || 0) + 1);
        pendingQuestion = null;
      }
    }

    processedTickets += 1;
  }

  const suggestions = [...pairsByQuestion.values()]
    .filter((item) => item.total >= args.minFrequency)
    .map((item) => {
      const bestAnswer = [...item.answers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      return {
        Activo: "SI",
        "Pregunta frecuente": item.question,
        "Respuesta aprobada": bestAnswer,
        "Cuando derivar a persona":
          "Derivar si piden confirmacion de agenda exacta, evaluacion clinica o cobertura personalizada.",
        "No prometer":
          "No prometer cupos, cobertura final ni resultados medicos sin validacion profesional.",
        "Notas para el bot": `Aprendido desde Zendesk Support. Frecuencia=${item.total}. Tickets=${item.ticketIds.size}.`
      };
    })
    .sort((a, b) => {
      const fa = Number((a["Notas para el bot"].match(/Frecuencia=(\d+)/) || [0, 0])[1]);
      const fb = Number((b["Notas para el bot"].match(/Frecuencia=(\d+)/) || [0, 0])[1]);
      return fb - fa;
    });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(args.outDir, `faq_suggestions_from_zendesk_${stamp}.json`);
  const tsvPath = path.join(args.outDir, `faq_suggestions_from_zendesk_${stamp}.tsv`);
  const summaryPath = path.join(args.outDir, `faq_suggestions_from_zendesk_${stamp}.summary.txt`);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        query: args.query,
        limit_tickets: args.limit,
        min_frequency: args.minFrequency,
        tickets_scanned: tickets.length,
        tickets_processed: processedTickets,
        suggestions_count: suggestions.length,
        suggestions
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.writeFileSync(tsvPath, toTsv(suggestions), "utf8");

  fs.writeFileSync(
    summaryPath,
    [
      `tickets_scanned=${tickets.length}`,
      `tickets_processed=${processedTickets}`,
      `suggestions_count=${suggestions.length}`,
      `json=${jsonPath}`,
      `tsv=${tsvPath}`
    ].join("\n") + "\n",
    "utf8"
  );

  console.log(`Zendesk learning done. Tickets scanned: ${tickets.length}`);
  console.log(`Suggestions generated: ${suggestions.length}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`TSV:  ${tsvPath}`);
  console.log(`Summary: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
