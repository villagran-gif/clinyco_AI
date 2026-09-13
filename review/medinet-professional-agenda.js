import { fetchAllAppointments } from '../Antonia/medinet-api.js';
import { chileDate, normalizeAppointment, normalizedName } from './medinet-daily.js';

export function agendaDates(now=new Date()) {
  const today=chileDate(now), next=new Date(today+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
  return [today,next.toISOString().slice(0,10)];
}
export function composeProfessionalAgenda(raw, professional, now=new Date()) {
  if (!Array.isArray(raw)) throw new Error('incomplete_agenda');
  const key=normalizedName(professional), dates=agendaDates(now);
  const items=[...new Map(raw.map(a=>[String(a.id),normalizeAppointment(a)])).values()].filter(a=>a.professionalKey===key&&!a.cancelled);
  return {dates,professional,message:[`Antonia · Agenda de ${professional}`,...dates.map((day,i)=>{
    const appointments=items.filter(a=>a.date===day).sort((a,b)=>a.time.localeCompare(b.time));
    return `${i?'Mañana':'Hoy'} ${day}: ${appointments.length} citas\n`+(appointments.length?appointments.map(a=>`${a.time} · ${a.patient} · ${a.type} · ${a.branch} · ${a.status}`).join('\n'):'Sin citas registradas.');
  }),'Consulta cambios y confirmaciones en https://clinyco-ai.netlify.app/'].join('\n\n')};
}
export const AGENDA_TEMPLATE_BODY = 'Hola {{1}}, soy Antonia de Clínyco. Tu agenda de hoy: {{2}}. Tu agenda de mañana: {{3}}. Revisa el detalle actualizado: {{4}}';
export const deliveryConfig = (env=process.env) => ({
  enabled:env.MEDINET_AGENDA_SEND_ENABLED==='true', professional:env.MEDINET_AGENDA_PROFESSIONAL || '',
  phone:env.MEDINET_AGENDA_PHONE || '', conversationId:env.MEDINET_AGENDA_CONVERSATION_ID || '',
  inboxId:env.MEDINET_AGENDA_INBOX_ID || '', template:env.MEDINET_AGENDA_TEMPLATE || '',
  language:env.MEDINET_AGENDA_LANGUAGE || 'es_CL', hour:Number(env.MEDINET_AGENDA_HOUR || 8),
});
export async function previewProfessionalAgenda({professional, now=new Date(),appointments=fetchAllAppointments}) {
  const dates=agendaDates(now);return composeProfessionalAgenda(await appointments(...dates),professional,now);
}

// A durable reservation is made before sending. An uncertain HTTP outcome is
// never retried automatically: operators reconcile it against Chatwoot first.
export async function sendDailyProfessionalAgenda({pool, now=new Date(), env=process.env, appointments=fetchAllAppointments, http=fetch}) {
  const c=deliveryConfig(env);
  if(!c.enabled)return {status:'disabled'};
  if(!c.professional||!/^\+\d{10,15}$/.test(c.phone)||!/^\d+$/.test(c.conversationId)||!/^\d+$/.test(c.inboxId)||!c.template||!env.CHATWOOT_API_TOKEN||!Number.isInteger(c.hour)||c.hour<0||c.hour>23)return {status:'configuration_required'};
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Santiago',hour:'2-digit',hourCycle:'h23'}).format(now));
  if(hour!==c.hour)return {status:'outside_delivery_hour'};
  const base=(env.CHATWOOT_API_URL||'https://app.chatwoot.com').replace(/\/$/,''), account=env.CHATWOOT_ACCOUNT_ID||'162472';
  const headers={api_access_token:env.CHATWOOT_API_TOKEN,'Content-Type':'application/json'};
  const path=`${base}/api/v1/accounts/${account}`;
  // Verify recipient, inbox and approved template each day before any message.
  const conversationResponse=await http(`${path}/conversations/${c.conversationId}`,{headers,signal:AbortSignal.timeout(15000)});
  if(!conversationResponse.ok)return {status:'recipient_unverified'};
  const conversation=await conversationResponse.json();
  if(String(conversation.inbox_id)!==c.inboxId||String(conversation.meta?.sender?.phone_number||'').replace(/[^+\d]/g,'')!==c.phone)return {status:'recipient_mismatch'};
  const inboxResponse=await http(`${path}/inboxes/${c.inboxId}`,{headers,signal:AbortSignal.timeout(15000)});
  if(!inboxResponse.ok)return {status:'template_unverified'};
  const inbox=await inboxResponse.json();
  const template=(inbox.message_templates||[]).find(t=>t.name===c.template&&t.language===c.language&&t.status==='APPROVED');
  const body=template?.components?.find(c=>c.type==='BODY')?.text || '';
  if(!template||template.category!=='UTILITY'||body!==AGENDA_TEMPLATE_BODY)return {status:'template_unverified'};
  const preview=await previewProfessionalAgenda({professional:c.professional,now,appointments});
  // Keep each summary within the approved template size; the complete agenda is authenticated.
  const sections=preview.message.split('\n\n');
  const compact=text=>text.length<=330?text.replaceAll('\n','; '):text.split('\n')[0]+' · Detalle completo en SELL';
  const params={'1':c.professional,'2':compact(sections[1]),'3':compact(sections[2]),'4':'https://clinyco-ai.netlify.app/'};
  const content=body.replace(/\{\{(\d+)\}\}/g,(_,key)=>params[key]);
  await pool.query(`CREATE TABLE IF NOT EXISTS medinet_agenda_deliveries (day date NOT NULL,recipient text NOT NULL,status text NOT NULL DEFAULT 'reserved',message_id text,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(day,recipient))`);
  const reservation=await pool.query(`INSERT INTO medinet_agenda_deliveries(day,recipient) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING day`,[preview.dates[0],c.phone]);
  if(!reservation.rowCount)return {status:'already_attempted'};
  try {
    const response=await http(`${path}/conversations/${c.conversationId}/messages`,{method:'POST',headers,signal:AbortSignal.timeout(20000),body:JSON.stringify({content,message_type:'outgoing',private:false,template_params:{name:c.template,category:'UTILITY',language:c.language,processed_params:{body:params}}})});
    if(!response.ok){await pool.query("UPDATE medinet_agenda_deliveries SET status='rejected' WHERE day=$1 AND recipient=$2",[preview.dates[0],c.phone]);return {status:'rejected'};}
    const result=await response.json();
    await pool.query("UPDATE medinet_agenda_deliveries SET status='accepted',message_id=$3 WHERE day=$1 AND recipient=$2",[preview.dates[0],c.phone,String(result.id||'')]);return {status:'accepted'};
  }catch{await pool.query("UPDATE medinet_agenda_deliveries SET status='uncertain' WHERE day=$1 AND recipient=$2",[preview.dates[0],c.phone]);return {status:'uncertain'};}
}
export function startDailyProfessionalAgenda({pool}) {
  if(!pool)return;
  let busy=false;
  const tick=async()=>{if(busy)return;busy=true;try{const r=await sendDailyProfessionalAgenda({pool});if(!['disabled','outside_delivery_hour','already_attempted'].includes(r.status))console.log('[medinet-agenda]',r.status);}catch{console.warn('[medinet-agenda] unavailable');}finally{busy=false;}};
  void tick();const timer=setInterval(tick,60000);timer.unref?.();return ()=>clearInterval(timer);
}
