import crypto from "node:crypto";

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

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

async function getSheetsAccessToken() {
  const serviceAccountEmail = clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const privateKey = String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();

  if (!serviceAccountEmail || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  }

  const assertion = buildSignedJwt({
    serviceAccountEmail,
    privateKey,
    scope: "https://www.googleapis.com/auth/spreadsheets"
  });

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

export function getEugeniaFeedbackSheetTab() {
  return clean(process.env.EUGENIA_FEEDBACK_SHEET_TAB) || "faq_por_resolver";
}

export function getEugeniaFeedbackSheetUrl() {
  const explicit = clean(process.env.EUGENIA_FEEDBACK_SHEET_URL);
  if (explicit) return explicit;
  const spreadsheetId = clean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
  return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : null;
}

export async function appendEugeniaFeedbackRow({
  ticketId,
  conversationId,
  authorId,
  feedbackText,
  state,
  sourcePublic = false
}) {
  const spreadsheetId = clean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID");
  }

  const tabName = getEugeniaFeedbackSheetTab();
  const accessToken = await getSheetsAccessToken();
  const values = [[
    new Date().toISOString(),
    String(ticketId || ""),
    String(conversationId || ""),
    String(authorId || ""),
    String(state?.leadScore?.score ?? ""),
    String(state?.leadScore?.category || ""),
    String(state?.leadScore?.pipeline || ""),
    String(state?.contactDraft?.c_nombres || ""),
    String(state?.contactDraft?.c_apellidos || ""),
    String(state?.contactDraft?.c_tel1 || ""),
    String(state?.contactDraft?.c_email || ""),
    sourcePublic === true ? "public" : "private",
    String(feedbackText || "")
  ]];

  const range = encodeURIComponent(`${tabName}!A:M`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      values
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets append error: ${JSON.stringify(data)}`);
  }

  const updatedRange = data?.updates?.updatedRange || "";
  const rowMatch = updatedRange.match(/![A-Z]+(\d+):/i);
  return {
    sheetTab: tabName,
    sheetUrl: getEugeniaFeedbackSheetUrl(),
    rowNumber: rowMatch ? Number(rowMatch[1]) : null
  };
}
