import fetch from 'node-fetch';

const BASE = process.env.CHATWOOT_BASE_URL || 'https://app.chatwoot.com';
const INBOX_ID = process.env.CHATWOOT_TIKTOK_INBOX_IDENTIFIER;

function publicUrl(path) {
  if (!INBOX_ID) throw new Error('CHATWOOT_TIKTOK_INBOX_IDENTIFIER not set');
  return `${BASE}/public/api/v1/inboxes/${INBOX_ID}${path}`;
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Chatwoot ${res.status}: ${text}`);
  return body;
}

export async function ensureContact({ tiktokUserId, name, avatarUrl }) {
  return request(publicUrl('/contacts'), {
    method: 'POST',
    body: JSON.stringify({
      source_id: tiktokUserId,
      name: name || `TikTok ${tiktokUserId}`,
      avatar_url: avatarUrl,
      identifier: `tiktok:${tiktokUserId}`,
    }),
  });
}

export async function ensureConversation({ contactSourceId }) {
  return request(publicUrl(`/contacts/${contactSourceId}/conversations`), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function postIncomingMessage({ contactSourceId, conversationId, content, attachments }) {
  return request(publicUrl(`/contacts/${contactSourceId}/conversations/${conversationId}/messages`), {
    method: 'POST',
    body: JSON.stringify({ content, message_type: 'incoming', attachments }),
  });
}
