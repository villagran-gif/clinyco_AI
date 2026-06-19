// queue/calendar-notify.js
//
// Notifica a villagran@clinyco.cl creando un evento en su Google Calendar
// cuando hay un candidato nuevo pending para aprobar/rechazar. Reemplaza
// (por ahora) el WhatsApp mientras el cliente consigue el número WAHA sin
// restricciones.
//
// Autenticación: service account de Google (GOOGLE_SERVICE_ACCOUNT_EMAIL +
// GOOGLE_PRIVATE_KEY que ya están en .env.example para Sheets). Pide token
// firmando un JWT RS256 contra https://oauth2.googleapis.com/token. No usa
// el SDK de googleapis para no sumar dependencia.
//
// Cómo "llega" el evento a villagran@clinyco.cl: dos estrategias en orden
//
//   1. Domain-wide delegation: si el admin de Workspace de clinyco.cl
//      autoriza al service account a impersonar a villagran@clinyco.cl
//      con scope calendar.events, creamos el evento DIRECTO en su
//      calendario primario (FONASAPAD_CALENDAR_USE_DWD=true).
//
//   2. Fallback (cero admin work): creamos el evento en el calendario
//      propio del service account y agregamos villagran@clinyco.cl
//      (y opcionalmente rodrigo@clinyco.cl) como attendees con
//      sendUpdates=all → Google les manda una invitación por mail. Al
//      "Aceptar" el evento aparece en el calendario de cada uno.
//
// Si las env vars de Google no están seteadas, la función NO falla — solo
// loguea un warning y sigue. Así el flujo del dashboard no depende de esto.

import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

function isConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

function privateKey() {
  // En la .env el private key suele venir con \n escapados; los desescapamos.
  return String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

function targetUser() {
  return process.env.FONASAPAD_CALENDAR_USER || "villagran@clinyco.cl";
}

function extraAttendee() {
  // Opcional. Si en algún momento existe rodrigo@clinyco.cl o similar.
  return process.env.FONASAPAD_CALENDAR_EXTRA_ATTENDEE || "";
}

function useDomainWideDelegation() {
  return process.env.FONASAPAD_CALENDAR_USE_DWD === "true";
}

function calendarIdForDwd() {
  // Cuando impersonamos, escribimos en su calendario primario.
  return "primary";
}

function calendarIdForFallback() {
  // Si no hay DWD, el evento vive en el calendario propio del service
  // account; podemos especificar uno alterno si queremos.
  return process.env.FONASAPAD_CALENDAR_ID || "primary";
}

// ── JWT firmado con la private key de la cuenta de servicio ──
function signAccessTokenJwt({ subject } = {}) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
    ...(subject ? { sub: subject } : {}),
  };
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const toSign = `${b64(header)}.${b64(claims)}`;
  const signature = crypto.createSign("RSA-SHA256").update(toSign).sign(privateKey());
  const sigB64 = Buffer.from(signature)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${toSign}.${sigB64}`;
}

let cachedToken = null;
async function getAccessToken() {
  if (cachedToken && cachedToken.exp > Date.now() / 1000 + 60) return cachedToken.access_token;
  const subject = useDomainWideDelegation() ? targetUser() : undefined;
  const jwt = signAccessTokenJwt({ subject });
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Google token ${res.status}: ${txt.slice(0, 300)}`);
  const j = JSON.parse(txt);
  cachedToken = { access_token: j.access_token, exp: Date.now() / 1000 + (j.expires_in || 3600) };
  return cachedToken.access_token;
}

// ── Render del evento ──

// PostgreSQL devuelve TIMESTAMPTZ como objeto Date cuando se lee con `pg`,
// no como string. Date.slice() no existe — por eso el botón "Notificar al
// Calendar" rompía con "(row.source_timestamp || '').slice is not a
// function". Helper normaliza ambos casos.
export function toISODateString(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function buildEventBody({ row, publicBaseUrl }) {
  const account = row.source_account;
  const dateStr = toISODateString(row.source_timestamp);
  const engagement = row.source_engagement ?? 0;
  const captionSnippet = (row.adapted_caption || row.source_caption || "").slice(0, 280);
  const approveUrl = `${publicBaseUrl}/api/review/queue/action/${row.action_token}?action=approve&actor=calendar`;
  const rejectUrl = `${publicBaseUrl}/api/review/queue/action/${row.action_token}?action=reject&actor=calendar`;
  const dashboardUrl = "https://clinyco-ai.netlify.app";
  const summary = `📸 Aprobar post @fonasapad · ${account} · ♥${engagement}`;
  // Description: HTML está soportado por Calendar (campo description acepta
  // anchor tags básicos). Incluye preview de la imagen y dos enlaces.
  const description =
    `<b>Origen:</b> @${account}<br>` +
    `<b>Fecha del post original:</b> ${dateStr}<br>` +
    `<b>Engagement original:</b> ${engagement} (likes + comments)<br><br>` +
    `<b>Caption:</b><br><i>${escapeHtml(captionSnippet)}…</i><br><br>` +
    `<a href="${row.source_image_url}">🖼 Ver imagen del candidato</a><br><br>` +
    `<b>¿Republicar este post en @fonasapad?</b><br><br>` +
    `✅ <a href="${approveUrl}"><b>APROBAR Y PUBLICAR</b></a><br>` +
    `❌ <a href="${rejectUrl}"><b>RECHAZAR Y TRAER OTRO</b></a><br><br>` +
    `o entra al dashboard: ${dashboardUrl}`;
  // Evento "all-day" hoy. Si quieres horario específico, esto se cambia.
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  const dateOnly = `${y}-${m}-${d}`;
  const next = new Date(today.getTime() + 86_400_000);
  const dateOnlyNext = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  const event = {
    summary,
    description,
    start: { date: dateOnly },
    end: { date: dateOnlyNext },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
  };
  if (!useDomainWideDelegation()) {
    // Fallback: invitamos al usuario para que el evento llegue por mail.
    const attendees = [{ email: targetUser() }];
    if (extraAttendee()) attendees.push({ email: extraAttendee() });
    event.attendees = attendees;
  }
  return event;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Función principal ──
export async function notifyCandidateViaCalendar({ row, publicBaseUrl }) {
  if (!isConfigured()) {
    console.warn("[calendar-notify] GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY no configurados — skipping");
    return { skipped: true };
  }
  const token = await getAccessToken();
  const calendarId = encodeURIComponent(
    useDomainWideDelegation() ? calendarIdForDwd() : calendarIdForFallback(),
  );
  const event = buildEventBody({ row, publicBaseUrl });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?sendUpdates=all`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`Calendar insert ${res.status}: ${txt.slice(0, 400)}`);
  }
  return { ok: true, event: JSON.parse(txt) };
}
