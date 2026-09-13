import test from 'node:test';
import assert from 'node:assert/strict';
import { antoniaAIConfig, claudeRequest, createAntoniaClient } from '../analysis/antonia-provider.js';
import { estimateTextCost, tokenUsage, recordAIUsage } from '../review/ai-usage.js';
import { createReviewer, reviewErrorCode } from '../antonia-improvements/reviewer.js';

test('explicit provider selection reuses Anthropic key; rollback preserves OpenAI client', () => {
  assert.deepEqual(antoniaAIConfig({ ANTONIA_AI_PROVIDER: 'anthropic' }), { provider: 'anthropic', model: 'claude-sonnet-5' });
  assert.throws(() => antoniaAIConfig({ ANTONIA_AI_PROVIDER: 'typo' }));
  assert.throws(() => createAntoniaClient({ env: { ANTONIA_AI_PROVIDER: 'anthropic' } }), /ANTHROPIC_API_KEY/);
  const openai = {};
  assert.equal(createAntoniaClient({ env: {}, openai }), openai);
});
test('converts system, consecutive turns and images without mutating history or passing OpenAI parameters', () => {
  const input = { model: 'claude-sonnet-5', max_completion_tokens: 800, reasoning_effort: 'none', messages: [
    { role: 'system', content: 'Reglas' }, { role: 'system', content: 'Datos conocidos' },
    { role: 'user', content: 'Hola' }, { role: 'user', content: [{ type: 'text', text: 'Imagen' }, { type: 'image_url', image_url: { url: 'https://example.test/image.png' } }] }
  ] };
  const before = structuredClone(input);
  const result = claudeRequest(input);
  assert.deepEqual(input, before);
  assert.equal(result.system, 'Reglas\n\nDatos conocidos');
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.messages[0].content[2], { type: 'image', source: { type: 'url', url: 'https://example.test/image.png' } });
  assert.equal(result.max_tokens, 800);
  assert.equal(result.reasoning_effort, undefined);
  assert.equal(result.temperature, undefined);
  assert.deepEqual(result.thinking, { type: 'disabled' });
});
test('Claude response maps text and raw usage; no hidden fallback or provider retry', async () => {
  let calls = 0;
  const client = createAntoniaClient({ env: { ANTONIA_AI_PROVIDER: 'anthropic' }, anthropic: { messages: { create: async (req, options) => {
    calls++; assert.equal(options.maxRetries, 0); assert.equal(options.timeout, 45000);
    return { model: req.model, content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Hola' }], usage: { input_tokens: 100, output_tokens: 5 }, stop_reason: 'end_turn' };
  } } } });
  const result = await client.chat.completions.create({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'Hola' }] });
  assert.equal(result.choices[0].message.content, 'Hola'); assert.equal(result.provider, 'anthropic'); assert.equal(calls, 1);
  const broken = createAntoniaClient({ env: { ANTONIA_AI_PROVIDER: 'anthropic' }, anthropic: { messages: { create: async () => { throw Object.assign(new Error('Your credit balance is too low'), { status: 400 }); } } } });
  await assert.rejects(broken.chat.completions.create({ messages: [{ role: 'user', content: 'Hola' }] }), error => reviewErrorCode(error) === 'ai_quota_exhausted');
});
test('truncated history can begin with an assistant turn', () => {
  const messages = [{ role: 'assistant', content: '¿En qué te ayudo?' }, { role: 'user', content: 'Quiero tomar hora' }];
  assert.equal(claudeRequest({ messages }).messages[0].role, 'assistant');
  assert.throws(() => claudeRequest({ messages: [] }), /empty/);
});
test('Anthropic input excludes cache tokens; costs include separate 5-minute and 1-hour writes', async () => {
  const usage = { input_tokens: 100, cache_read_input_tokens: 300, cache_creation_input_tokens: 200, cache_creation: { ephemeral_1h_input_tokens: 50 }, output_tokens: 20 };
  assert.deepEqual(tokenUsage(usage), { input: 600, cached: 300, cacheWrite: 200, output: 20 });
  assert.equal(estimateTextCost('claude-sonnet-5', usage), (100*2 + 300*0.2 + 150*2.5 + 50*4 + 20*10)/1e6);
  const calls = []; const pool = { query: async (...args) => { calls.push(args); return { rows: [] }; } };
  await recordAIUsage(pool, { provider: 'anthropic', model: 'claude-sonnet-5', usage });
  assert.equal(calls[1][1][0], 'anthropic'); assert.equal(calls[1][1][3], 600);
});
test('suggestion reviewer uses Claude JSON response and records Anthropic usage', async () => {
  const item = { id: 'synthetic', verdict: 'factible', reason: 'Reduce repetición', proposal: 'Usar datos previos', checks: 'Validar con casos sintéticos' };
  const client = createAntoniaClient({ env: { ANTONIA_AI_PROVIDER: 'anthropic' }, anthropic: { messages: { create: async req => {
    assert.match(req.system, /anthropic/); assert.equal(req.response_format, undefined);
    return { model: req.model, content: [{ type: 'text', text: '```json\n' + JSON.stringify({ items: [item] }) + '\n```' }], usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'end_turn' };
  } } } });
  const calls = []; const pool = { query: async (...args) => { calls.push(args); return { rows: [] }; } };
  const review = createReviewer({ openai: client, provider: 'anthropic', model: 'claude-sonnet-5', pool });
  assert.deepEqual(await review([{ id: 'synthetic', problem: 'Repite ciudad', proposal: 'Recordar ciudad' }]), [item]);
  assert.equal(calls[1][1][0], 'anthropic');
});
