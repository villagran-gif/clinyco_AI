import { createHmac } from "crypto";

function getBaseUrl() {
  return (process.env.TELEMEDICINE_SESSION_BASE_URL || "https://telemedicina.clinyco.cl/sesion").replace(/\/$/, "");
}

function getSecret() {
  return process.env.TELEMEDICINE_SESSION_SECRET || "dev-secret-change-me";
}

export function buildSessionUrl({ appointmentId, startsAt }) {
  const payload = `${appointmentId}:${new Date(startsAt).getTime()}`;
  const signature = createHmac("sha256", getSecret()).update(payload).digest("hex").slice(0, 24);
  const token = Buffer.from(payload).toString("base64url") + "." + signature;
  return { url: `${getBaseUrl()}/${token}`, token };
}

export function verifySessionToken(token) {
  const [payloadB64, signature] = String(token || "").split(".");
  if (!payloadB64 || !signature) return null;
  let payload;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", getSecret()).update(payload).digest("hex").slice(0, 24);
  if (expected !== signature) return null;
  const [appointmentId, ts] = payload.split(":");
  return { appointmentId, startsAt: new Date(Number(ts)).toISOString() };
}
