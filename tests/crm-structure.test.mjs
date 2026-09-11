import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const catalog = JSON.parse(await readFile(new URL('../review/site/crm-structure.json', import.meta.url), 'utf8'));
test('preserves Sell distinctions and never marks scheduled procedures completed', () => {
  assert.deepEqual(catalog.pipelines.map(p => p.id), ['bariatrica','balon','plastica']);
  assert.deepEqual(catalog.pipelines.map(p => p.stages.length), [8,8,7]);
  for (const pipeline of catalog.pipelines) {
    assert.equal(pipeline.stages.find(s => s.name === 'CERRADO AGENDADO').completed, false);
    assert.equal(pipeline.stages.filter(s => s.completed).length, 1);
  }
  assert.equal(catalog.orderVerified, false);
  assert.equal(catalog.pipelines[1].stages[0].name, 'CANDIDATOS');
});
