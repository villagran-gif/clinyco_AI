import { Router } from 'express';
// Mounted behind reviewAuth; Meta and gateway credentials never reach the browser.
export function directAttendanceRouter({fetchImpl=fetch,env=process.env}={}) {
  const r=Router();
  r.get('/',async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    const date=String(req.query.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'Selecciona una fecha válida.'});
    const token=env.CONFIRMATIONS_INTAKE_TOKEN;
    if(!token)return res.status(503).json({error:'Confirmaciones directas pendientes de conectar.'});
    try {
      const response=await fetchImpl(`https://sell-medinet-backend.onrender.com/attendance-direct/review?date=${encodeURIComponent(date)}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('unavailable');
      const data=await response.json();
      if(!Array.isArray(data.items)||!Array.isArray(data.attention))throw Error('invalid_response');
      res.json(data);
    }catch{res.status(503).json({error:'No se pudo consultar el registro de confirmaciones directas.'});}
  });return r;
}
