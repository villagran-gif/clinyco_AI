import {
  getSubscriberInfo,
  sendDirectMessage,
  verifyManyChatRequest,
} from './manychat.js';
import {
  ensureContact,
  ensureConversation,
  postIncomingMessage,
} from './chatwoot.js';

export function registerTikTokBridge(app) {
  // ManyChat External Request → Chatwoot incoming
  app.post('/webhooks/tiktok', async (req, res) => {
    if (!verifyManyChatRequest(req)) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const { subscriber_id, name, text, channel } = req.body || {};
    if (!subscriber_id || !text) {
      return res.status(400).json({ error: 'missing subscriber_id or text' });
    }

    try {
      let displayName = name;
      let avatarUrl;
      if (!displayName) {
        const info = await getSubscriberInfo(subscriber_id).catch(() => null);
        if (info) {
          displayName = [info.first_name, info.last_name].filter(Boolean).join(' ') || info.name;
          avatarUrl = info.profile_pic;
        }
      }

      await ensureContact({
        sourceId: subscriber_id,
        name: displayName || `TikTok ${subscriber_id}`,
        avatarUrl,
        identifier: `manychat:${channel || 'tiktok'}:${subscriber_id}`,
      });
      const conv = await ensureConversation({ contactSourceId: subscriber_id });
      await postIncomingMessage({
        contactSourceId: subscriber_id,
        conversationId: conv.id,
        content: text,
      });
      res.json({ ok: true, conversation_id: conv.id });
    } catch (err) {
      console.error('[manychat→chatwoot]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Chatwoot agent reply → ManyChat → TikTok user
  app.post('/webhooks/chatwoot/tiktok', async (req, res) => {
    const payload = req.body || {};

    if (payload.event !== 'message_created') return res.json({ ignored: true });
    if (payload.message_type !== 'outgoing') return res.json({ ignored: true });
    if (payload.private) return res.json({ ignored: true });

    const subscriberId =
      payload.conversation?.contact_inbox?.source_id ||
      payload.contact_inbox?.source_id ||
      payload.sender?.identifier?.split(':').pop();
    const text = payload.content;

    if (!subscriberId || !text) {
      return res.status(400).json({ error: 'missing subscriber_id or content' });
    }

    try {
      await sendDirectMessage({ subscriberId, text });
      res.json({ ok: true });
    } catch (err) {
      console.error('[chatwoot→manychat]', err);
      res.status(500).json({ error: err.message });
    }
  });
}
