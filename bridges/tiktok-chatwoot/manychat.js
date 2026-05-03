import fetch from 'node-fetch';

const BASE = 'https://api.manychat.com';

function authHeader() {
  const key = process.env.MANYCHAT_API_KEY;
  if (!key) throw new Error('MANYCHAT_API_KEY not set');
  return `Bearer ${key}`;
}

async function request(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === 'error') {
    throw new Error(`ManyChat ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function getSubscriberInfo(subscriberId) {
  const res = await fetch(`${BASE}/fb/subscriber/getInfo?subscriber_id=${subscriberId}`, {
    headers: { Authorization: authHeader() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === 'error') {
    throw new Error(`ManyChat getInfo ${res.status}: ${JSON.stringify(data)}`);
  }
  return data.data;
}

export async function sendDirectMessage({ subscriberId, text, messageTag = 'ACCOUNT_UPDATE' }) {
  return request('/fb/sending/sendContent', {
    subscriber_id: subscriberId,
    data: {
      version: 'v2',
      content: {
        messages: [{ type: 'text', text }],
      },
    },
    message_tag: messageTag,
  });
}

export function verifyManyChatRequest(req) {
  const expected = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!expected) return true;
  const got = req.get('X-Bridge-Secret');
  return got === expected;
}
