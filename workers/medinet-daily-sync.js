// Run only on the Chilean VPS. Render reads these snapshots through the shared DB.
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { fetchChileanAppointments as fetchAllAppointments } from './medinet-daily-source.js';
import { ensureSnapshotSchema,requestSnapshot } from '../review/medinet-snapshot.js';
const chileDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export const seedDays=(day,count=5)=>Array.from({length:Math.max(2,Number(count)||5)},(_,offset)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);});
export async function syncOneDay({pool,appointments=fetchAllAppointments}) {
  const lease=randomUUID();
  const claim=await pool.query(`UPDATE medinet_daily_snapshots SET attempt_at=now(),lease_until=now()+interval '2 minutes',lease_id=$1,error_code=NULL
    WHERE day=(SELECT day FROM medinet_daily_snapshots
      WHERE (requested_at>COALESCE(attempt_at,'epoch'::timestamptz) OR (lease_id IS NOT NULL AND lease_until<now())) AND (lease_until IS NULL OR lease_until<now())
      ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING day::text`,[lease]);
  if(!claim.rows.length)return null;const day=claim.rows[0].day;
  try {
    const raw=await appointments(day,day);
    const rows=Array.isArray(raw)?raw:(raw?.results||raw?.appointments||raw?.data||raw?.citas);
    if(!Array.isArray(rows)||raw?.next)throw new Error('incomplete_response');
    await pool.query(`UPDATE medinet_daily_snapshots SET appointments=$3::jsonb,synced_at=now(),lease_until=NULL,lease_id=NULL,error_code=NULL WHERE day=$1 AND lease_id=$2`,[day,lease,JSON.stringify(rows)]);
    return {day,ok:true,count:rows.length};
  }catch(error){
    const status=Number(error?.status || String(error?.message||'').match(/→ (\d{3})/)?.[1]);
    const code=[401,403].includes(status)?'medinet_access_denied':'medinet_unavailable';
    await pool.query('UPDATE medinet_daily_snapshots SET lease_until=NULL,lease_id=NULL,error_code=$3 WHERE day=$1 AND lease_id=$2',[day,lease,code]);
    return {day,ok:false,code};
  }
}
export async function startDailySync({pool,appointments=fetchAllAppointments,now=()=>new Date()}) {
  await ensureSnapshotSchema(pool);let busy=false,lastSeed=0;
  const tick=async()=>{if(busy)return;busy=true;try{
    if(now().valueOf()-lastSeed>120000){
      const day=chileDay(now()),horizon=process.env.MEDINET_DAILY_SEED_DAYS||5;
      for(const target of seedDays(day,horizon)) await requestSnapshot(pool,target);
      lastSeed=now().valueOf();
    }
    for(let i=0;i<2;i++){const result=await syncOneDay({pool,appointments});if(!result)break;console.info('[medinet-vps-daily]',JSON.stringify(result));}
  }catch(error){console.warn('[medinet-vps-daily]',JSON.stringify({code:'sync_unavailable',type:error.name}));}finally{busy=false;}};
  await tick();const timer=setInterval(tick,3000);return ()=>clearInterval(timer);
}
// PM2 imports ESM through ProcessContainerFork; argv[1] names that wrapper.
const entryPath=process.env.pm_exec_path||process.argv[1];
if(entryPath&&import.meta.url===pathToFileURL(entryPath).href){
  if(!process.env.DATABASE_URL||!process.env.MEDINET_USER||!process.env.MEDINET_USER_KEY)throw new Error('Daily worker requires database and Medinet configuration');
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true},max:2,connectionTimeoutMillis:10000});
  startDailySync({pool}).catch(error=>{console.error('[medinet-vps-daily] startup',error.name);process.exit(1);});
}
