// lead-alerts/waha-client.js
//
// Cliente OUTBOUND mínimo para WAHA (instancia self-hosted del repo; ver waha-dev/).
// Envía un texto vía POST {WAHA_API_URL}/api/sendText con header X-Api-Key.
// Reusa las env vars que ya existen en el VPS (WAHA_API_URL, WAHA_API_KEY).
//
// Dry-run aware: con LEAD_ALERT_DRY_RUN != "false" NO hace HTTP, sólo loguea.
// Así se puede probar el flujo completo sin entregar mensajes reales.

function baseUrl() {
  return (process.env.WAHA_API_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function apiKey() {
  return process.env.WAHA_API_KEY || null;
}

export function isDryRun() {
  return String(process.env.LEAD_ALERT_DRY_RUN ?? "true").toLowerCase() !== "false";
}

// Sesión WAHA conectada desde la que se envía (un número real autenticado en el VPS).
export function defaultSession() {
  return process.env.LEAD_ALERT_WAHA_SESSION || "default";
}

// "+56944547790" -> "56944547790@c.us"
export function toChatId(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  return `${digits}@c.us`;
}

export async function sendText({ session = defaultSession(), phone, text }) {
  const chatId = toChatId(phone);
  if (!chatId) throw new Error("lead-alerts/waha: teléfono inválido");
  if (!text) throw new Error("lead-alerts/waha: texto vacío");

  if (isDryRun()) {
    console.log("[lead-alerts/dry-run] sendText", {
      session,
      chatId,
      text: String(text).slice(0, 160)
    });
    return { dryRun: true, messageId: `dry_${Date.now()}` };
  }

  const key = apiKey();
  const res = await fetch(`${baseUrl()}/api/sendText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {})
    },
    body: JSON.stringify({ session, chatId, text })
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`WAHA sendText ${res.status}: ${body.slice(0, 300)}`);
  }
  let json;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  return { messageId: json?.id || json?.key?.id || null };
}
