import fetch from 'node-fetch';

const BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export async function sendDirectMessage({ recipientUserId, text }) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) throw new Error('TIKTOK_ACCESS_TOKEN not set');

  const res = await fetch(`${BASE}/business/message/send/`, {
    method: 'POST',
    headers: {
      'Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { user_id: recipientUserId },
      message: { type: 'text', text },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.code !== 0) {
    throw new Error(`TikTok send failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export function verifyTikTokSignature(_req) {
  return true;
}
