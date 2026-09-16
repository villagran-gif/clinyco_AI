import { Router } from 'express';

// Mounted behind reviewAuth. Read-only dashboard path: use the shared Postgres
// directly instead of proxying another service over HTTP.
export function directAttendanceRouter({getPool}={}) {
  const r=Router();
  r.get('/',async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    const date=String(req.query.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'Selecciona una fecha válida.'});
    try {
      const pool=getPool?.();
      if(!pool)throw Error('database_unavailable');
      const result=await pool.query(`SELECT id,snapshot->>'patient' AS patient,snapshot->>'professional' AS professional,snapshot->>'branch' AS branch,snapshot->>'date' AS date,snapshot->>'time' AS time,phone,trial,state,delivery,reply,intent,medinet_status,verified_at,error,chatwoot_conversation_id FROM attendance_direct.requests WHERE snapshot->>'date'=$1 ORDER BY snapshot->>'time',id LIMIT 501`,[date]);
      const attention=await pool.query(`SELECT phone,state,payload->>'text' AS reply,created_at FROM attendance_direct.events WHERE state IN ('needs_review','human_paused') AND (created_at AT TIME ZONE 'America/Santiago')::date=$1::date ORDER BY created_at DESC LIMIT 100`,[date]);
      res.json({mode:'live',sendsEnabled:true,inboundMode:'chatwoot_bridge',items:result.rows.slice(0,500),truncated:result.rows.length>500,attention:attention.rows});
    }catch(e){console.error('[review/attendance-direct]',e.message);res.status(503).json({error:'No se pudo consultar el registro de confirmaciones directas.'});}
  });
  return r;
}
