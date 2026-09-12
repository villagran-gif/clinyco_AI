import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTextCost, tokenUsage } from '../review/ai-usage.js';

test('normaliza tokens de Chat Completions y separa cache', () => {
  assert.deepEqual(tokenUsage({prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:400,cache_write_tokens:100}}), {input:1000,cached:400,cacheWrite:100,output:200});
});

test('calcula el costo estándar de Terra con entrada cacheada', () => {
  const cost=estimateTextCost('gpt-5.6-terra',{prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:400,cache_write_tokens:100}});
  assert.equal(cost, ((500*2)+(400*0.2)+(100*2.5)+(200*12))/1_000_000);
});

test('no inventa precio para un modelo desconocido', () => {
  assert.equal(estimateTextCost('modelo-sin-tarifa',{prompt_tokens:100}),null);
});
