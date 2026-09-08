import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../chatwoot-adapter/parse.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ process: { env: {} } });
vm.runInContext(source.replaceAll('export function ', 'function '), ctx);
const base = () => ({ event: 'message_created', id: 7, account: { id: 162472 },
  message_type: 'incoming', content: 'Quiero una hora', sender: { type: 'contact' },
  inbox: { id: 110652, name: 'WhatsApp' }, conversation: { id: 11075, channel: 'Channel::Whatsapp' } });
for (const [name, patch, reason] of [
  ['Clinyco voice inbox', { inbox: { id: 114783 } }, 'voice_inbox'],
  ['voice channel', { conversation: { id: 1, channel: 'Channel::Voice' } }, 'voice_channel'],
  ['voice name', { inbox: { name: 'Voice (+56229148460)' } }, 'voice_channel'],
  ['missed call', { content: 'Missed call' }, 'call_status'],
  ['call ended', { content: 'Call ended' }, 'call_status'],
  ['transcription', { content: '🤖 Transcripción de la llamada (34s) Hola' }, 'call_transcription'],
  ['private incoming note', { private: true }, 'private_note'],
  ['activity', { message_type: 'activity' }, 'activity'],
  ['call content type', { content_type: 'call' }, 'call_event'],
  ['call metadata', { content_attributes: { call_id: 'abc' } }, 'call_event'],
  ['bot', { sender: { type: 'AgentBot' } }, 'bot_message'],
]) {
  test(`ignores ${name} before the core's message gate`, () => {
    const info = ctx.parseChatwootInbound({ ...base(), ...patch });
    assert.equal(info.eventType, 'conversation:ignored');
    assert.equal(info.skipReason, reason);
  });
}
test('patient reply following a call still reaches Antonia', () => {
  const p = base(); p.content = 'Sí, necesito una hora. Tengo una llamada perdida de ustedes';
  p.conversation.messages = [{ id: 6, content_type: 'call', private: true }];
  const info = ctx.parseChatwootInbound(p);
  assert.equal(info.eventType, 'conversation:message');
  assert.equal(info.authorType, 'user'); assert.equal(info.userText, p.content);
});
test('private flags in the matching nested message are respected', () => {
  const p = base(); p.conversation.messages = [{ id: 7, private: true }];
  assert.equal(ctx.parseChatwootInbound(p).skipReason, 'private_note');
});
test('human public replies retain takeover semantics', () => {
  const p = { ...base(), message_type: 'outgoing', sender: { type: 'user' } };
  const info = ctx.parseChatwootInbound(p);
  assert.equal(info.eventType, 'conversation:message'); assert.equal(info.isHumanAgent, true);
  assert.equal(info.authorType, 'business');
});
test('patient images and voice notes are not phone-call events', () => {
  for (const kind of ['image', 'audio']) {
    const p = base(); p.content = ''; p.attachments = [{ file_type: kind, data_url: `https://example.com/patient.${kind === 'image' ? 'jpg' : 'ogg'}` }];
    assert.equal(ctx.parseChatwootInbound(p).eventType, 'conversation:message');
  }
});
test('voice inbox ID is scoped to the clinic account', () => {
  const p = { ...base(), account: { id: 123 }, inbox: { id: 114783, name: 'WhatsApp' } };
  assert.equal(ctx.parseChatwootInbound(p).skipReason, null);
});
test('server stops ignored events before hydration and history', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const handler = server.slice(server.indexOf('const handleInboundWebhook ='));
  assert.ok(handler.indexOf('if (eventType !== "conversation:message")') < handler.indexOf('await hydrateConversationCache'));
  assert.match(handler, /if \(eventType !== "conversation:message"\) \{\s*return res\.json\(\{ ok: true, skipped: "non_message_event" \}\);/);
});
