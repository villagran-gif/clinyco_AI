import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {directAttendanceRouter} from '../review/attendance-direct.js';
test('dashboard proxy keeps token server-side and propagates only report JSON',async()=>{
 let seen;const app=express();app.use(directAttendanceRouter({env:{CONFIRMATIONS_INTAKE_TOKEN:'synthetic'},fetchImpl:async(url,opts)=>{seen={url,opts};return {ok:true,json:async()=>({items:[],attention:[],mode:'test'})};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/?date=invalid')).status,400);assert.equal(seen,undefined);
 const r=await fetch(base+'/?date=2026-09-15');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.equal(seen.opts.headers.Authorization,'Bearer synthetic');assert.equal((await r.text()).includes('synthetic'),false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('missing gateway config cannot appear as an empty successful report',async()=>{
 const app=express();app.use(directAttendanceRouter({env:{}}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/?date=2026-09-15`);assert.equal(r.status,503);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
