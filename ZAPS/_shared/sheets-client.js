/**
 * Google Sheets v4 client — just enough primitives to replace Zapier's
 * lookup_row / update_row / search_or_write actions.
 *
 * Auth: JWT signed with GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY
 * (same convention as eugenia/feedback-sheet.js).
 *
 * Exports:
 *   - resolveTabName({ spreadsheetId, gid }) → tab title
 *   - lookupRowByColumn({ ..., column, value }) → { rowNumber } | null
 *   - updateRowCells({ ..., rowNumber, cells }) → { updated }
 *   - appendRowCells({ ..., cells }) → { rowNumber }
 *   - upsertRowByKey({ ..., lookupColumn, keyValue, updateCells, insertOnlyCells })
 */

import crypto from "node:crypto";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedToken = { token: null, expiresAt: 0 };

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildSignedJwt({ serviceAccountEmail, privateKey, scope }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccountEmail,
    scope,
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

export async function getSheetsAccessToken() {
  if (cachedToken.token && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const serviceAccountEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();

  if (!serviceAccountEmail || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  }

  const assertion = buildSignedJwt({
    serviceAccountEmail,
    privateKey,
    scope: SHEETS_SCOPE
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Google token error: ${JSON.stringify(data)}`);
  }

  const expiresInMs = Number(data.expires_in || 3600) * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + expiresInMs };
  return cachedToken.token;
}

async function sheetsFetch(url, options = {}) {
  const token = await getSheetsAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets API ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Resolve a worksheet GID (numeric sheetId, as used in sheet URLs) to its tab title.
 * The v4 API uses tab titles in A1 notation, not GIDs.
 */
export async function resolveTabName({ spreadsheetId, gid }) {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  const data = await sheetsFetch(url);
  const sheet = (data.sheets || []).find(
    (s) => String(s?.properties?.sheetId) === String(gid)
  );
  if (!sheet) {
    throw new Error(`Sheet gid ${gid} not found in spreadsheet ${spreadsheetId}`);
  }
  return sheet.properties.title;
}

/**
 * Find the first row where column `column` (e.g. "A") equals `value`.
 * Returns { rowNumber } or null. Scans up to maxRows (default 2000).
 */
export async function lookupRowByColumn({
  spreadsheetId,
  tabName,
  column,
  value,
  maxRows = 2000
}) {
  const range = encodeURIComponent(`${tabName}!${column}1:${column}${maxRows}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=COLUMNS`;
  const data = await sheetsFetch(url);
  const col = (data.values && data.values[0]) || [];
  const target = String(value);
  const idx = col.findIndex((v) => String(v) === target);
  if (idx === -1) return null;
  return { rowNumber: idx + 1 };
}

/**
 * Update specific cells in a row. `cells` is a map { "A": "foo", "B": "bar", ... }.
 * Uses values:batchUpdate, so only the listed columns are written.
 */
export async function updateRowCells({ spreadsheetId, tabName, rowNumber, cells }) {
  const entries = Object.entries(cells || {});
  if (!entries.length) return { updated: 0 };
  const data = entries.map(([col, val]) => ({
    range: `${tabName}!${col}${rowNumber}`,
    values: [[val == null ? "" : String(val)]]
  }));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
  const result = await sheetsFetch(url, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data })
  });
  return { updated: result.totalUpdatedCells || 0 };
}

/**
 * Append a new row at the first empty row after the last populated cell in column A.
 * Returns { rowNumber }.
 */
export async function appendRowCells({ spreadsheetId, tabName, cells }) {
  const rangeA = encodeURIComponent(`${tabName}!A:A`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${rangeA}`;
  const data = await sheetsFetch(url);
  const nextRow = ((data.values || []).length || 0) + 1;
  await updateRowCells({ spreadsheetId, tabName, rowNumber: nextRow, cells });
  return { rowNumber: nextRow };
}

/**
 * Upsert semantics to mirror Zapier's "Lookup + (optional) Write".
 *
 *   - `updateCells`      → written on BOTH insert and update (fields that should always be fresh)
 *   - `insertOnlyCells`  → written ONLY when the row is new (fields the user may edit by hand)
 *
 * Lookup is by a single column = keyValue match.
 */
export async function upsertRowByKey({
  spreadsheetId,
  tabName,
  lookupColumn,
  keyValue,
  updateCells,
  insertOnlyCells = {},
  maxRows = 2000
}) {
  const existing = await lookupRowByColumn({
    spreadsheetId,
    tabName,
    column: lookupColumn,
    value: keyValue,
    maxRows
  });
  if (existing) {
    await updateRowCells({
      spreadsheetId,
      tabName,
      rowNumber: existing.rowNumber,
      cells: updateCells
    });
    return { rowNumber: existing.rowNumber, inserted: false };
  }
  const { rowNumber } = await appendRowCells({
    spreadsheetId,
    tabName,
    cells: { ...insertOnlyCells, ...updateCells }
  });
  return { rowNumber, inserted: true };
}
