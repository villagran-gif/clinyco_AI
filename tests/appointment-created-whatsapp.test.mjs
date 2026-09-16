import test from 'node:test';
import assert from 'node:assert/strict';
import { newlyCreated } from '../workers/medinet-daily-sync.js';

test('first snapshot is baseline and never backfills old appointments',()=>{
  const current=[{id:100},{id:101}];
  assert.deepEqual(newlyCreated(null,current),[]);
  assert.deepEqual(newlyCreated(undefined,current),[]);
});

test('only appointment ids absent from previous snapshot are new',()=>{
  const previous=[{id:100},{id:101}];
  const current=[{id:100},{id:101},{id:102},{id:103}];
  assert.deepEqual(newlyCreated(previous,current).map(x=>x.id),[102,103]);
});

test('same appointment id changing fields is not a new appointment',()=>{
  const previous=[{id:100,hora:'10:00',estado:{nombre:'Agendado'}}];
  const current=[{id:100,hora:'10:20',estado:{nombre:'Confirmado'}}];
  assert.deepEqual(newlyCreated(previous,current),[]);
});
