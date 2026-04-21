// WAHA send-message client. Thin wrapper over POST /api/sendText.
// WAHA docs: https://waha.devlike.pro/

function normalizeChatId(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return `${digits}@c.us`;
}

function getEnv() {
  return {
    baseUrl: (process.env.WAHA_API_URL || "").replace(/\/$/, ""),
    apiKey: process.env.WAHA_API_KEY || "",
    session: process.env.WAHA_SESSION_NAME || "default",
  };
}

export async function sendWhatsApp(phone, text) {
  const { baseUrl, apiKey, session } = getEnv();
  if (!baseUrl) {
    console.warn("[waha-client] WAHA_API_URL not set — skipping send to", phone);
    return { sent: false, skipped: true, reason: "waha_not_configured" };
  }
  const chatId = normalizeChatId(phone);
  if (!chatId) {
    return { sent: false, skipped: true, reason: "invalid_phone" };
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const res = await fetch(`${baseUrl}/api/sendText`, {
    method: "POST",
    headers,
    body: JSON.stringify({ session, chatId, text }),
  });
  const bodyText = await res.text();
  let data;
  try { data = JSON.parse(bodyText); } catch { data = { raw: bodyText }; }

  if (!res.ok) {
    const err = new Error(`waha sendText ${res.status}: ${bodyText.slice(0, 200)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return { sent: true, messageId: data?.id || null, raw: data };
}
