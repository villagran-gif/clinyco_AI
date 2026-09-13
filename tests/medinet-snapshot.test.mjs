import test from 'node:test';
import assert from 'node:assert/strict';
import { readDailySnapshot,PendingSnapshotError,snapshotDays } from '../review/medinet-snapshot.js';
import { createChileanMedinetClient } from '../workers/medinet-daily-source.js';
import { syncOneDay } from '../workers/medinet-daily-sync.js';
const day='2026-09-14',now=new Date('2026-09-14T12:00:00Z');
const fakePool=rows=>{const writes=[];return {writes,query:async(sql,args)=>{if(sql.startsWith('SELECT'))return {rows};writes.push({sql,args});return {rows:[]};}};};
test('only bounded real calendar dates can request snapshots',()=>{assert.deepEqual(snapshotDays(day,'2026-09-15'),[day,'2026-09-15']);assert.throws(()=>snapshotDays('2026-02-30',day));assert.throws(()=>snapshotDays(day,'2026-09-17'));});
test('fresh VPS snapshot is returned with its actual timestamp; Render does not contact Medinet',async()=>{
 const pool=fakePool([{day,appointments:[{id:4}],synced_at:now}]);const r=await readDailySnapshot(day,day,{pool,now});
 assert.deepEqual(r,{appointments:[{id:4}],syncedAt:now.toISOString()});assert.equal(pool.writes.filter(w=>w.sql.startsWith('INSERT')).length,0);
});
test('missing or stale snapshots enqueue a refresh and never appear as an empty day',async()=>{
 for(const rows of [[],[{day,appointments:[],synced_at:'2026-09-13T12:00:00Z'}]]){
  const pool=fakePool(rows);await assert.rejects(readDailySnapshot(day,day,{pool,now}),PendingSnapshotError);
  assert.equal(pool.writes.filter(w=>w.sql.startsWith('INSERT')).length,1);
 }
});
test('recent failed sync is reported, not silently replaced by stale appointments',async()=>{
 const pool=fakePool([{day,appointments:[{id:4}],synced_at:'2026-09-13T12:00:00Z',attempt_at:now,error_code:'medinet_access_denied'}]);
 await assert.rejects(readDailySnapshot(day,day,{pool,now}),e=>e.code==='snapshot_failed');
});
test('VPS client refreshes rejected JWT once, stays on HTTPS, and hides error body',async()=>{
 let logins=0,gets=0;
 const client=createChileanMedinetClient({env:{MEDINET_USER:'test',MEDINET_USER_KEY:'secret'},http:async(url,options)=>{
  assert.ok(url.startsWith('https://clinyco.medinetapp.com/'));assert.equal(options.redirect,'error');
  if(url.endsWith('/token-login/')){logins++;return {ok:true,json:async()=>({token:'token'+logins})};}
  gets++;if(gets===1)return {status:401,ok:false};return {ok:true,json:async()=>[{id:3}]};
 }});
 assert.deepEqual(await client(day,day),[{id:3}]);assert.equal(logins,2);assert.equal(gets,2);
});
test('failed or paginated VPS fetch is not published as a successful snapshot',async()=>{
 const writes=[];const pool={query:async(sql,args)=>{writes.push({sql,args});return {rows:sql.includes('RETURNING day')?[{day}]:[]};}};
 const r=await syncOneDay({pool,appointments:async()=>({results:[{id:4}],next:'page2'})});
 assert.equal(r.ok,false);assert.ok(!writes.some(w=>w.sql.includes('appointments=$3')));assert.equal(writes.at(-1).args[2],'medinet_unavailable');
});
