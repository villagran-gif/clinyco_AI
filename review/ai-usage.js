const USD_PER_MILLION = Object.freeze({
  // Anthropic standard rates verified 2026-09-13.
  'claude-sonnet-5': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, cacheWriteHour: 4, output: 10 },
  'gpt-6-astra': { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, cacheWrite: 0.25, output: 2 },
});

const schema = `
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL DEFAULT 'openai',
  purpose text NOT NULL,
  model text NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0,
  cached_input_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(14,8),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_events_created ON ai_usage_events(created_at);
CREATE INDEX IF NOT EXISTS ai_usage_events_model_created ON ai_usage_events(model,created_at);
ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS cache_write_tokens bigint NOT NULL DEFAULT 0;`;

const initialized = new WeakMap();

async function ensureUsageTable(pool) {
  if (!pool) return false;
  if (!initialized.has(pool)) initialized.set(pool, pool.query(schema).catch(error => {
    initialized.delete(pool);
    throw error;
  }));
  await initialized.get(pool);
  return true;
}

function nonNegativeInteger(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export function tokenUsage(usage = {}) {
  if (usage.prompt_tokens === undefined && ('cache_read_input_tokens' in usage || 'cache_creation_input_tokens' in usage)) {
    const cached = nonNegativeInteger(usage.cache_read_input_tokens);
    const cacheWrite = nonNegativeInteger(usage.cache_creation_input_tokens);
    return { input: nonNegativeInteger(usage.input_tokens) + cached + cacheWrite, cached, cacheWrite, output: nonNegativeInteger(usage.output_tokens) };
  }
  const input = nonNegativeInteger(usage.prompt_tokens ?? usage.input_tokens);
  const output = nonNegativeInteger(usage.completion_tokens ?? usage.output_tokens);
  const cached = Math.min(input, nonNegativeInteger(
    usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.input_cached_tokens
  ));
  const cacheWrite = Math.min(input - cached, nonNegativeInteger(
    usage.prompt_tokens_details?.cache_write_tokens ?? usage.input_tokens_details?.cache_write_tokens ?? usage.input_cache_write_tokens
  ));
  return { input, cached, cacheWrite, output };
}

export function estimateTextCost(model, usage = {}) {
  const rates = USD_PER_MILLION[model];
  if (!rates) return null;
  const { input, cached, cacheWrite, output } = tokenUsage(usage);
  const hourWrite = Math.min(cacheWrite, nonNegativeInteger(usage.cache_creation?.ephemeral_1h_input_tokens));
  return (hourWrite * ((rates.cacheWriteHour || rates.cacheWrite) - rates.cacheWrite) + (input - cached - cacheWrite) * rates.input + cached * rates.cachedInput + cacheWrite * rates.cacheWrite + output * rates.output) / 1_000_000;
}

export async function recordAIUsage(pool, { model, usage, purpose = 'antonia_chat', provider = 'openai' }) {
  const tokens = tokenUsage(usage);
  if (!pool || !model || (!tokens.input && !tokens.output)) return;
  await ensureUsageTable(pool);
  await pool.query(
    `INSERT INTO ai_usage_events(provider,purpose,model,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,estimated_cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [provider, purpose, model, tokens.input, tokens.cached, tokens.cacheWrite, tokens.output, estimateTextCost(model, usage)]
  );
}

function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? String(value) : null;
}

export async function usageDashboard(pool, { month, budgetUsd = 100, activeModel = '' } = {}) {
  await ensureUsageTable(pool);
  const dateParts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const currentMonth = `${dateParts.year}-${dateParts.month}`;
  const selectedMonth = validMonth(month) || currentMonth;
  const safeBudget = Number.isFinite(Number(budgetUsd)) && Number(budgetUsd) > 0 ? Number(budgetUsd) : 100;
  const { rows } = await pool.query(`
    WITH bounds AS (
      SELECT (($1 || '-01')::date::timestamp AT TIME ZONE 'America/Santiago') AS start_at,
             ((($1 || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'America/Santiago') AS end_at
    )
    SELECT model,
           count(*)::int AS requests,
           coalesce(sum(input_tokens),0)::bigint AS input_tokens,
           coalesce(sum(cached_input_tokens),0)::bigint AS cached_input_tokens,
           coalesce(sum(cache_write_tokens),0)::bigint AS cache_write_tokens,
           coalesce(sum(output_tokens),0)::bigint AS output_tokens,
           coalesce(sum(estimated_cost_usd),0)::numeric AS estimated_cost_usd,
           max(created_at) AS last_event_at
      FROM ai_usage_events, bounds
     WHERE created_at >= start_at AND created_at < end_at
     GROUP BY model ORDER BY estimated_cost_usd DESC NULLS LAST, model`, [selectedMonth]);
  const today = await pool.query(`
    SELECT count(*)::int AS requests, coalesce(sum(estimated_cost_usd),0)::numeric AS estimated_cost_usd
      FROM ai_usage_events
     WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago')`);
  const models = rows.map(row => ({
    model: row.model,
    requests: Number(row.requests),
    inputTokens: Number(row.input_tokens),
    cachedInputTokens: Number(row.cached_input_tokens),
    cacheWriteTokens: Number(row.cache_write_tokens),
    outputTokens: Number(row.output_tokens),
    estimatedCostUsd: row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
    lastEventAt: row.last_event_at,
  }));
  const estimatedCostUsd = models.reduce((total, item) => total + (item.estimatedCostUsd || 0), 0);
  const [year, monthNumber] = selectedMonth.split('-').map(Number);
  const elapsedDays = selectedMonth === currentMonth ? Number(dateParts.day) : new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const projectedCostUsd = elapsedDays ? estimatedCostUsd / elapsedDays * daysInMonth : 0;
  return {
    month: selectedMonth,
    activeModel,
    currency: 'USD',
    estimated: true,
    budgetUsd: safeBudget,
    today: { requests: Number(today.rows[0].requests), estimatedCostUsd: Number(today.rows[0].estimated_cost_usd) },
    totals: {
      requests: models.reduce((total, item) => total + item.requests, 0),
      inputTokens: models.reduce((total, item) => total + item.inputTokens, 0),
      cachedInputTokens: models.reduce((total, item) => total + item.cachedInputTokens, 0),
      cacheWriteTokens: models.reduce((total, item) => total + item.cacheWriteTokens, 0),
      outputTokens: models.reduce((total, item) => total + item.outputTokens, 0),
      estimatedCostUsd,
      projectedCostUsd,
      budgetUsedPercent: safeBudget ? estimatedCostUsd / safeBudget * 100 : 0,
    },
    models,
  };
}
