import Anthropic from '@anthropic-ai/sdk';

export function antoniaAIConfig(env = process.env) {
  const provider = env.ANTONIA_AI_PROVIDER || 'openai';
  if (!['openai', 'anthropic'].includes(provider)) throw new Error('Invalid ANTONIA_AI_PROVIDER');
  return { provider, model: provider === 'anthropic' ? (env.ANTONIA_CLAUDE_MODEL || 'claude-sonnet-5') : (env.OPENAI_MODEL || 'gpt-5.6-terra') };
}

export const CHILEAN_STYLE = 'Responde en español de Chile, cercano y profesional. Comprende modismos como al tiro, pega, lucas y tomar hora según el contexto; no fuerces jerga ni caricaturices el acento. Conserva las reglas comerciales y de seguridad del sistema. No inventes disponibilidad, precios ni acciones realizadas.';

export function claudeRequest(request) {
  const system = [];
  const messages = [];
  for (const item of request.messages) {
    if (item.role === 'system') { if (item.content) system.push(String(item.content)); continue; }
    if (!['user', 'assistant'].includes(item.role)) throw new Error('Unsupported Antonia message role');
    const content = typeof item.content === 'string'
      ? [{ type: 'text', text: item.content }]
      : (item.content || []).map(block => {
        if (block.type === 'text') return { type: 'text', text: block.text };
        if (block.type === 'image_url' && /^https?:\/\//i.test(block.image_url?.url || '')) return { type: 'image', source: { type: 'url', url: block.image_url.url } };
        throw new Error('Unsupported Antonia content block');
      });
    const nonempty = content.filter(block => block.type !== 'text' || block.text?.trim());
    if (!nonempty.length) continue;
    if (messages.at(-1)?.role === item.role) messages.at(-1).content.push(...nonempty);
    else messages.push({ role: item.role, content: nonempty });
  }
  if (!messages.length) throw new Error('Antonia history is empty');
  if (request.response_format?.type === 'json_object') system.push('Devuelve exclusivamente un objeto JSON válido, sin Markdown ni texto fuera del JSON.');
  return { model: request.model, max_tokens: request.max_completion_tokens || 800, thinking: { type: 'disabled' }, system: system.join('\n\n'), messages };
}

// Keep the existing text-generation boundary; audio continues on its own client.
export function createAntoniaClient({ openai, env = process.env, anthropic } = {}) {
  const config = antoniaAIConfig(env);
  if (config.provider === 'openai') return openai;
  if (!anthropic && !env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY for Antonia');
  const client = anthropic || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 45000, maxRetries: 0 });
  return { chat: { completions: { async create(request) {
    const response = await client.messages.create(claudeRequest(request), { timeout: 45000, maxRetries: 0 });
    let text = response.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (request.response_format?.type === 'json_object') text = text.replace(/^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/, '$1');
    return { model: response.model, provider: 'anthropic', usage: response.usage, choices: [{ message: { content: text }, finish_reason: response.stop_reason === 'max_tokens' ? 'length' : response.stop_reason }] };
  } } } };
}
