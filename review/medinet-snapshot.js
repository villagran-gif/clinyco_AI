export const SNAPSHOT_TTL_MS = 120000;
export const snapshotSchema = `CREATE TABLE IF NOT EXISTS medinet_daily_snapshots (
  day date PRIMARY KEY, appointments jsonb, synced_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(), attempt_at timestamptz,
  lease_until timestamptz, lease_id uuid, error_code text
)`;
const schemas = new WeakMap();
export async function ensureSnapshotSchema(pool) {
  if (!pool) throw new Error('daily_database_unavailable');
  if (!schemas.has(pool)) schemas.set(pool,pool.query(snapshotSchema).catch(e=>{schemas.delete(pool);throw e;}));
  await schemas.get(pool);
}
export class PendingSnapshotError extends Error {
  constructor(){super('La agenda se está actualizando desde el VPS.');this.code='snapshot_pending';}
}
export function snapshotDays(start,end) {
  const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  if(!valid(start)||!valid(end))throw new Error('invalid_snapshot_date');
  const days=[];
  for(let d=new Date(start+'T12:00:00Z');d<=new Date(end+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1)){
    days.push(d.toISOString().slice(0,10));if(days.length>2)throw new Error('snapshot_range_too_large');
  }
  if(!days.length)throw new Error('invalid_snapshot_range');return days;
}
export async function requestSnapshot(pool,day) {
  await pool.query(`INSERT INTO medinet_daily_snapshots(day) VALUES($1) ON CONFLICT(day) DO UPDATE SET requested_at=now()
    WHERE (medinet_daily_snapshots.lease_until IS NULL OR medinet_daily_snapshots.lease_until<now())
    AND (medinet_daily_snapshots.attempt_at IS NULL OR medinet_daily_snapshots.attempt_at<now()-interval '60 seconds')`,[day]);
}
export async function readDailySnapshot(start,end=start,{pool,now=new Date()}={}) {
  const days=snapshotDays(start,end);await ensureSnapshotSchema(pool);
  const result=await pool.query('SELECT day::text,appointments,synced_at,attempt_at,error_code FROM medinet_daily_snapshots WHERE day=ANY($1::date[])',[days]);
  const rows=new Map(result.rows.map(r=>[r.day,r]));let pending=false;const data=[];
  for(const day of days){
    const row=rows.get(day),age=row?.synced_at?now-new Date(row.synced_at):Infinity;
    if(age>=0&&age<SNAPSHOT_TTL_MS&&Array.isArray(row.appointments)){data.push(row);continue;}
    if(row?.error_code&&now-new Date(row.attempt_at)<60000){const error=new Error('Medinet no pudo actualizar la agenda desde el VPS.');error.code='snapshot_failed';throw error;}
    await requestSnapshot(pool,day);pending=true;
  }
  if(pending)throw new PendingSnapshotError();
  return {appointments:data.flatMap(r=>r.appointments),syncedAt:new Date(Math.min(...data.map(r=>new Date(r.synced_at).valueOf()))).toISOString()};
}
export async function readDailyAppointments(start,end,options){return (await readDailySnapshot(start,end,options)).appointments;}
