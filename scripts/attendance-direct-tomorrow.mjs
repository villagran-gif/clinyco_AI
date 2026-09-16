const base=String(process.env.SELL_MEDINET_BACKEND_URL||'').trim().replace(/\/+$/,'');
const token=String(process.env.SELL_MEDINET_INTAKE_TOKEN||'').trim();
if(!base)throw Error('SELL_MEDINET_BACKEND_URL missing');
if(!token)throw Error('SELL_MEDINET_INTAKE_TOKEN missing');

const response=await fetch(`${base}/attendance-direct/batch-tomorrow`,{
  method:'POST',
  headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
  body:JSON.stringify({commit:true}),
  signal:AbortSignal.timeout(120000),
});
const data=await response.json().catch(()=>({error:'invalid_json'}));
if(!response.ok)throw Error(`attendance_batch_${response.status}_${data.error||'failed'}`);
console.log(JSON.stringify({at:new Date().toISOString(),...data}));
