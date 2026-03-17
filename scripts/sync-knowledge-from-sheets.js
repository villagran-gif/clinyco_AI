#!/usr/bin/env node
import crypto from "crypto";
import { writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { knowledgeSheetDefinitions } from "../knowledge/sheet-definitions.js";
import { normalizeBooleanLike, normalizeCurrencyClp, normalizeDurationMinutes, normalizeTelemedicine, summarizeRowForAi } from "../knowledge/normalizers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const knowledgeDir = path.resolve(__dirname, "../knowledge");

function getEnv(name, fallback = null) {
  return process.env[name] ?? fallback;
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function parseBoolean(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return ["si", "s", "true", "1", "yes"].includes(text);
}

function parseList(value) {
  const text = clean(value);
  if (!text) return [];
  return text
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSignedJwt({ serviceAccountEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsignedToken), privateKey);
  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function getAccessToken() {
  const serviceAccountEmail = clean(getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"));
  const privateKey = String(getEnv("GOOGLE_PRIVATE_KEY", "")).replace(/\\n/g, "\n").trim();

  if (!serviceAccountEmail || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  }

  const assertion = buildSignedJwt({ serviceAccountEmail, privateKey });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Google token error: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

function rowsToObjects(values = []) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const headers = values[0].map((item) => String(item || "").trim());
  return values.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
  );
}

function normalizeRecord(definition, row) {
  const record = {};
  for (const column of definition.columns) {
    const rawValue = row[column.header];
    if (column.type === "boolean") {
      record[column.key] = parseBoolean(rawValue);
      continue;
    }
    if (column.type === "list") {
      record[column.key] = parseList(rawValue);
      continue;
    }
    record[column.key] = clean(rawValue);
  }

  if (record.valor) {
    const currency = normalizeCurrencyClp(record.valor);
    record.valor_normalizado_clp = currency.amount;
    record.valor_interpretado = currency.label;
  }

  if (record.duracion) {
    const duration = normalizeDurationMinutes(record.duracion);
    record.duracion_minutos = duration.minutes;
    record.duracion_interpretada = duration.label;
  }

  if (record.previo_pago !== undefined && record.previo_pago !== null) {
    const prev = normalizeBooleanLike(record.previo_pago);
    record.previo_pago_interpretado = prev.label;
  }

  if (record.telemedicina) {
    const tele = normalizeTelemedicine(record.telemedicina);
    record.telemedicina_interpretada = tele.label;
    record.telemedicina_codigo = tele.mode;
  }

  const ai = summarizeRowForAi(record, definition.key);
  record.interpretacion_ia = ai.preview || null;
  record.observaciones_ia = ai.notes;

  return record;
}

async function fetchSheetTab({ spreadsheetId, accessToken, definition }) {
  const range = encodeURIComponent(`${definition.tabName}!A:ZZ`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets error for ${definition.tabName}: ${JSON.stringify(data)}`);
  }

  const rows = rowsToObjects(data.values || []);
  return rows.map((row) => normalizeRecord(definition, row));
}

async function main() {
  const spreadsheetId = clean(getEnv("GOOGLE_SHEETS_SPREADSHEET_ID"));
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID");
  }

  const accessToken = await getAccessToken();
  const syncedAt = new Date().toISOString();

  for (const definition of knowledgeSheetDefinitions) {
    const records = await fetchSheetTab({ spreadsheetId, accessToken, definition });
    const payload = {
      version: 1,
      source: "google_sheets",
      spreadsheet_id: spreadsheetId,
      sheet_tab: definition.tabName,
      synced_at: syncedAt,
      descripcion: definition.description,
      mensaje_para_equipo: definition.agentHelp,
      columns: definition.columns,
      records
    };

    const outputPath = path.join(knowledgeDir, definition.fileName);
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Synced ${definition.tabName} -> ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
