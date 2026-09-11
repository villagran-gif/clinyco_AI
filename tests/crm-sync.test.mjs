import test from 'node:test';
import assert from 'node:assert/strict';
import {syncCrmBatch} from '../review/crm-sync.js';
function fakePool() {
  const statements=[];
  const query=async(sql,args)=>{
    statements.push({sql,args});
    if(sql.includes('pg_try_advisory'))return {rows:[{acquired:true}]};
    if(sql.startsWith('SELECT last_id'))return {rows:[{last_id:'0',last_received:'2026-09-01T04:00:00Z'}]};
    if(sql.startsWith('SELECT id,received_at'))return {rows:[{id:'123',received_at:'2026-09-02T12:00:00Z',payload:{event:'message_created'}}]};
    return {rows:[]};
  };
  return {statements,query,connect:async()=>({query,release(){}})};
}
test('sync checkpoints only after successful projection; failed batch is retryable',async()=>{
  const pool=fakePool();
  const result=await syncCrmBatch(pool,'2026-09-01',100,async()=>true);
  assert.equal(result.imported,1);assert.equal(result.more,false);
  const update=pool.statements.find(x=>x.sql.startsWith('UPDATE crm_sync_progress'));
  assert.deepEqual(update.args,['chatwoot:2026-09-01','123',1,'2026-09-02T12:00:00Z']);
  const failed=fakePool();
  await assert.rejects(syncCrmBatch(failed,'2026-09-01',100,async()=>{throw new Error('projection failed');}));
  assert.equal(failed.statements.some(x=>x.sql.startsWith('UPDATE crm_sync_progress')),false);
  assert.equal(failed.statements.at(-1).sql,'ROLLBACK');
});
