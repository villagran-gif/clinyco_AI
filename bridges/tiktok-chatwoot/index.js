import { ensureContact, ensureConversation, postIncomingMessage } from './chatwoot.js';
import { sendDirectMessage, verifyTikTokSignature } from './tiktok.js';

export function registerTikTokBridge(app) {
  app.post('/webhooks/tiktok', async (req, res) => {
    if (!verifyTikTokSignature(req)) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];

    try {
      for (const evt of events) {
        if (evt?.type !== 'message') continue;
        const senderId = evt.sender?.id;
        const text = evt.message?.text;
        if (!senderId || !text) continue;

        await ensureContact({
          tiktokUserId: senderId,
          name: evt.sender?.display_name,
          avatarUrl: evt.sender?.avatar_url,
        });
        const conv = await ensureConversation({ contactSourceId: senderId });
        await postIncomingMessage({
          contactSourceId: senderId,
          conversationId: conv.id,
          content: text,
        });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[tiktok→chatwoot]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/webhooks/chatwoot/tiktok', async (req, res) => {
    const payload = req.body || {};

    if (payload.event !== 'message_created') return res.json({ ignored: true });
    if (payload.message_type !== 'outgoing') return res.json({ ignored: true });
    if (payload.private) return res.json({ ignored: true });

    const recipientUserId = payload.conversation?.contact_inbox?.source_id
      || payload.conversation?.meta?.sender?.identifier?.replace(/^tiktok:/, '');
    const text = payload.content;

    if (!recipientUserId || !text) {
      return res.status(400).json({ error: 'missing recipient or content' });
    }

    try {
      await sendDirectMessage({ recipientUserId, text });
      res.json({ ok: true });
    } catch (err) {
      console.error('[chatwoot→tiktok]', err);
      res.status(500).json({ error: err.message });
    }
  });
}
