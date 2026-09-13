import { Router, json } from 'express';
import { fetchAllAppointments } from '../Antonia/medinet-api.js';

export const chileDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const normalizedName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const fullName = p => [p?.nombres, p?.paterno, p?.materno].filter(Boolean).join(' ').trim();
export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function unwrap(body) {
  const list = Array.isArray(body) ? body : (body?.results || body?.appointments || body?.data || body?.citas);
  if (!Array.isArray(list) || body?.next) throw new Error('medinet_response_incomplete');
  return list;
}
export function normalizeAppointment(raw) {
  const status = raw.estado?.nombre || 'Sin estado';
  const state = normalizedName(status);
  return {
    id: String(raw.id), date: String(raw.fecha || '').slice(0,10).replaceAll('/', '-'), time: String(raw.hora || '').slice(0,5),
    professional: fullName(raw.profesional), professionalKey: normalizedName(fullName(raw.profesional)),
    branchId: String(raw.sucursal?.id || ''), branch: raw.sucursal?.nombre || 'Sin sede',
    typeId: String(raw.tipo_id || ''), type: raw.tipo || raw.especialidad_nombre || 'Consulta', duration: raw.duracion || null,
    patient: fullName(raw.paciente), phone: String(raw.paciente?.telefono || raw.paciente?.telefono_2 || '').replace(/[^+\d]/g, ''),
    email: raw.paciente?.email || '', status, confirmation: state === 'confirmado' ? 'Confirmada en Medinet' : 'Sin confirmación registrada',
    attended: state === 'atendido', cancelled: ['cancelada', 'cancelado', 're-agendado', 'reagendado'].includes(state),
    absent: ['no asiste', 'no asistio', 'ausente', 'inasistente'].includes(state),
    expectedAmount: null, paidAmount: null, conversationUrl: null,
  };
}

export function buildDailyReport({ date, appointments, slots, confirmations = [], tariffs = [], now = new Date() }) {
  const items = [...new Map(appointments.map(a => [String(a.id), normalizeAppointment(a)])).values()].filter(a => a.date === date);
  const people = new Map();
  const ensure = (key, name, branchId, branch) => {
    const id = `${key}|${branchId}`;
    if (!people.has(id)) people.set(id, { key, name, branchId, branch, free: null, blocked: null, occupied: 0, attended: 0, absent: 0, cancelled: 0, confirmed: 0, expectedAmount: 0, expectedKnown: 0, missingTariffs: 0, attendedExpectedAmount: 0, attendedExpectedKnown: 0, attendedMissingTariffs: 0, paidAmount: null, difference: null });
    return people.get(id);
  };
  const slotsFresh = !!slots?.syncedAt && now - new Date(slots.syncedAt) < 30*60*1000 && now >= new Date(slots.syncedAt);
  for (const [branchId, branch] of Object.entries(slots?.sucursales || {})) for (const prof of branch.profesionales || []) {
    const p = ensure(normalizedName(prof.nombre), prof.nombre, branchId, branch.nombre);
    const day = (prof.slots || []).find(s => s.fecha === date);
    // Only published web slots are known. Missing days and stale snapshots aren't zero availability.
    if (slotsFresh && day && Array.isArray(day.horas)) p.free = day.horas.length;
  }
  for (const item of items) {
    const p = ensure(item.professionalKey, item.professional, item.branchId, item.branch);
    const c = confirmations.find(c => String(c.external_id) === item.id && chileDate(new Date(c.appointment_at)) === date);
    if (c?.state === 'confirmed') item.confirmation = 'Confirmada por WhatsApp';
    else if (c?.state === 'reschedule_requested') item.confirmation = 'Solicita reagendar';
    else if (c?.state === 'cancelled') item.confirmation = 'Solicita cancelar';
    else if (c?.first_msg_sent_at && !item.confirmation.startsWith('Confirmada')) item.confirmation = 'Enviada · esperando respuesta';
    if (c?.chatwoot_conversation_id && /^\d+$/.test(String(c.chatwoot_conversation_id))) item.conversationUrl = `https://app.chatwoot.com/app/accounts/162472/conversations/${c.chatwoot_conversation_id}`;
    const tariff = tariffs.find(t => t.professional_key === item.professionalKey && String(t.type_id) === item.typeId);
    if (tariff) item.expectedAmount = Number(tariff.amount_clp);
    if (item.cancelled) { item.confirmation = 'Cita cancelada o reagendada'; p.cancelled++; continue; }
    p.occupied++; if (item.attended) p.attended++; if (item.absent) p.absent++;
    if (item.confirmation.startsWith('Confirmada')) p.confirmed++;
    if (item.expectedAmount === null) p.missingTariffs++;
    else { p.expectedAmount += item.expectedAmount; p.expectedKnown++; }
    if (item.attended) { if (item.expectedAmount === null) p.attendedMissingTariffs++; else {p.attendedExpectedAmount += item.expectedAmount; p.attendedExpectedKnown++;} }
  }
  return { date, syncedAt: now.toISOString(), slotsSyncedAt: slots?.syncedAt || null, slotsFresh, items: items.sort((a,b)=>a.time.localeCompare(b.time)),
    professionals: [...people.values()].sort((a,b)=>a.name.localeCompare(b.name,'es')),
    limitations: ['Libres: cupos publicados en agenda web; no representa toda la capacidad interna.', 'Bloqueos y pagos efectivos: pendientes de conectar a una fuente verificable.', 'Esperado: arancel configurado por tipo de cita; no equivale a dinero recibido.'],
  };
}

const schema = `CREATE TABLE IF NOT EXISTS medinet_daily_tariffs (professional_key text NOT NULL, type_id text NOT NULL, amount_clp numeric(12,0) NOT NULL CHECK(amount_clp>=0), updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(professional_key,type_id));`;
const initialized = new WeakMap();
async function ensureSchema(pool) {
  if (!initialized.has(pool)) initialized.set(pool,pool.query(schema).catch(e=>{ initialized.delete(pool); throw e; }));
  await initialized.get(pool);
}

export function dailyMedinetRouter({ getPool, appointments = fetchAllAppointments, fetchSlots = async () => {
  const base = (process.env.MEDINET_VPS_URL || 'http://69.6.226.132:3001').replace(/\/+$/, '');
  const r = await fetch(`${base}/api/slots`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('slots_unavailable'); return r.json();
} }) {
  const router = Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.get('/daily', async(req,res)=>{
    const date = req.query.date || chileDate();
    if (!validDay(date)) return res.status(400).json({error:'Fecha inválida.'});
    try {
      const pool=getPool(); await ensureSchema(pool);
      const [raw, slotResult, confirmations, tariffs] = await Promise.all([
        appointments(date,date), fetchSlots().catch(()=>null),
        pool.query("SELECT external_id,appointment_at,state,first_msg_sent_at,chatwoot_conversation_id FROM confirmations.appointments WHERE appointment_at >= ($1::date::timestamp AT TIME ZONE 'America/Santiago') AND appointment_at < (($1::date+1)::timestamp AT TIME ZONE 'America/Santiago')",[date]),
        pool.query('SELECT professional_key,type_id,amount_clp FROM medinet_daily_tariffs'),
      ]);
      res.json(buildDailyReport({date,appointments:unwrap(raw),slots:slotResult,confirmations:confirmations.rows,tariffs:tariffs.rows}));
    } catch(e) { console.warn('[medinet-daily] query failed', e.name || 'Error'); res.status(503).json({error:'No se pudo consultar la agenda de Medinet. Reintenta; no se ha asumido que esté vacía.'}); }
  });
  router.put('/daily/tariff',json({limit:'4kb'}),async(req,res)=>{
    if (req.get('origin') !== 'https://clinyco-ai.netlify.app') return res.status(403).json({error:'origin_not_allowed'});
    const {professionalKey,typeId,amount}=req.body || {};
    if (typeof professionalKey!=='string'||!professionalKey.trim()||professionalKey.length>200||!/^\d+$/.test(String(typeId))||!Number.isSafeInteger(amount)||amount<0||amount>100000000) return res.status(400).json({error:'Arancel inválido.'});
    try { const pool=getPool(); await ensureSchema(pool); await pool.query('INSERT INTO medinet_daily_tariffs(professional_key,type_id,amount_clp,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(professional_key,type_id) DO UPDATE SET amount_clp=excluded.amount_clp,updated_by=excluded.updated_by,updated_at=now()',[professionalKey,typeId,amount,req.reviewUser.email]); res.json({saved:true}); }
    catch {res.status(503).json({error:'No se pudo guardar el arancel.'});}
  });
  return router;
}
