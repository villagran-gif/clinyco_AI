import { getPool, dbEnabled } from '../db.js';
import { formatRutWithDots } from '../Antonia/medinet-api.js';
import { searchSlotsOnChileVps, bookSlotOnChileVps, appointmentDetailOnChileVps, updateAppointmentOnChileVps } from './medinet-worker-client.js';

const norm = v => String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const digits = v => String(v||'').replace(/\D/g,'');
const fullName = p => [p?.nombres,p?.paterno,p?.materno].filter(Boolean).join(' ').trim();
const dayOf = a => String(a?.fecha||'').slice(0,10).replaceAll('/','-');
const timeOf = a => String(a?.hora||'').slice(0,5);
const statusOf = a => norm(a?.estado?.nombre||a?.status||'');
const cancelled = a => ['cancelada','cancelado','re-agendado','reagendado','anulada','anulado'].includes(statusOf(a));
let ensured=false;

async function ensure(){
 if(ensured||!dbEnabled())return;
 await getPool().query(`CREATE TABLE IF NOT EXISTS melania_reschedule_sessions(
  external_id bigint PRIMARY KEY, phone text NOT NULL, professional_id bigint NOT NULL, professional text NOT NULL,
  branch_id bigint NOT NULL, patient jsonb NOT NULL, slots jsonb NOT NULL DEFAULT '[]', state text NOT NULL DEFAULT 'choosing',
  chosen jsonb, error text, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now())`);
 await getPool().query(`ALTER TABLE melania_reschedule_sessions ADD COLUMN IF NOT EXISTS original_appointment_id bigint;
 ALTER TABLE melania_reschedule_sessions ADD COLUMN IF NOT EXISTS new_appointment_id bigint;`);
 ensured=true;
}
function choice(text,max){const m=String(text||'').trim().match(/^(?:opci[oó]n\s*)?(\d{1,2})$/i);if(!m)return null;const n=Number(m[1]);return n>=1&&n<=max?n-1:null;}
function exact(a,b){
 const stable=['professionalId','specialtyId','tipoCitaId','dataDia','time'];
 return stable.every(k=>String(a?.[k])===String(b?.[k]))
  && (a?.branchId==null||b?.branchId==null||String(a.branchId)===String(b.branchId));
}
export function pickDiverseSlots(input,max=6){
 const slots=Array.isArray(input)?input:[];const groups=[];const byDate=new Map();
 for(const s of slots){const key=String(s.dataDia||s.date||'');if(!byDate.has(key)){const g=[];byDate.set(key,g);groups.push(g);}byDate.get(key).push(s);}
 const out=[];let round=0;while(out.length<max){let added=false;for(const g of groups){if(g[round]&&out.length<max){out.push(g[round]);added=true;}}if(!added)break;round++;}
 return out;
}
function options(result,branchName){
 const slots=pickDiverseSlots(result.available_slots||[],6),branch=String(branchName||'').trim();
 if(!slots.length)return {slots,reply:`No encontré horas próximas con ${result.professional||'el mismo profesional'}${branch?` en ${branch}`:''}. Si quieres, el equipo puede ayudarte.`};
 return {slots,reply:`Encontré estas horas con ${result.professional}${branch?` en ${branch}`:''}:\n\n${slots.map((s,i)=>`${i+1}. ${s.date||s.dataDia} a las ${s.time}${branch?` — Sucursal: ${branch}`:''}`).join('\n')}\n\nResponde con el número de la opción que prefieres.`};
}
async function search(payload){
 const r=await searchSlotsOnChileVps({query:payload.professional.name,patientRut:payload.patient?.run||payload.patient?.rut||'',branchId:payload.branch_id});
 const same=(r.available_slots||[]).filter(s=>String(s.professionalId)===String(payload.professional.id)).map(s=>({...s,branchId:Number(payload.branch_id)}));
 return options({...r,professional:payload.professional.name,available_slots:same},payload.branch?.name||payload.branch_name||'');
}
function appointmentMatches(raw,payload,{date,time}={}){
 const expectedDate=date||String(payload.appointment_at||'').slice(0,10),expectedTime=time||String(payload.appointment_at||'').slice(11,16);
 if(dayOf(raw)!==expectedDate||timeOf(raw)!==expectedTime)return false;
 if(String(raw?.sucursal?.id||'')!==String(payload.branch_id))return false;
 const rawProfId=raw?.profesional?.id;
 if(rawProfId!=null&&String(rawProfId)!==String(payload.professional?.id))return false;
 if(rawProfId==null&&norm(fullName(raw?.profesional))!==norm(payload.professional?.name))return false;
 const rawPhone=digits(raw?.paciente?.telefono||raw?.paciente?.telefono_2||raw?.paciente?.fono||'');
 if(rawPhone)return rawPhone===digits(payload.patient?.phone);
 return norm(fullName(raw?.paciente))===norm(payload.patient?.name);
}
async function resolveOriginal(payload){
 const day=String(payload.appointment_at||'').slice(0,10);
 const result=await getPool().query('SELECT appointments FROM medinet_daily_snapshots WHERE day=$1::date',[day]);
 const rows=Array.isArray(result.rows[0]?.appointments)?result.rows[0].appointments:[];
 const matches=rows.filter(a=>appointmentMatches(a,payload)&&!cancelled(a));
 if(matches.length!==1)throw Error(matches.length?'original_appointment_ambiguous':'original_appointment_not_found');
 const raw=matches[0],id=Number(raw.id);
 if(!Number.isSafeInteger(id)||id<1)throw Error('original_appointment_id_invalid');
 return {id,raw};
}
function patientRun(raw){return raw?.paciente?.rut||raw?.paciente?.run||raw?.paciente?.identificador||raw?.paciente?.identifier||'';}
function professionalMatches(raw,id,name){
 const rawId=raw?.profesional?.id;
 if(rawId!=null&&String(rawId)!=='')return String(rawId)===String(id);
 return norm(fullName(raw?.profesional))===norm(name);
}
function patientMatches(raw,phone,name){
 const rawPhone=digits(raw?.paciente?.telefono||raw?.paciente?.telefono_2||raw?.paciente?.fono||'');
 if(rawPhone)return rawPhone===digits(phone);
 return norm(fullName(raw?.paciente))===norm(name);
}
function slotMatchesAppointment(raw,slot,professionalName,phone,patientName){
 if(dayOf(raw)!==String(slot.dataDia)||timeOf(raw)!==String(slot.time))return false;
 if(String(raw?.sucursal?.id||'')!==String(slot.branchId))return false;
 if(!professionalMatches(raw,slot.professionalId,professionalName))return false;
 if(phone&&!patientMatches(raw,phone,patientName))return false;
 if(raw?.tipo_id!=null&&slot?.tipoCitaId!=null&&String(raw.tipo_id)!==String(slot.tipoCitaId))return false;
 return !cancelled(raw);
}
function assertControlledWrite(payload,phone){
 const exactTrial = payload.trial===true
  && phone==='56987297033'
  && Number(payload.external_id)===990000001
  && Number(payload.professional?.id)===13
  && Number(payload.branch_id)===39
  && norm(payload.patient?.name)==='paciente prueba melania'
  && String(payload.appointment_at||'').startsWith('2026-09-14T16:00');
 if(exactTrial)return true;
 if(process.env.MELANIA_DIRECT_RESCHEDULE_WRITE_ENABLED!=='true')return false;
 if(process.env.MELANIA_DIRECT_RESCHEDULE_WRITE_SCOPE!=='trial')throw Error('reschedule_write_scope_not_allowed');
 const allowed=digits(process.env.MELANIA_DIRECT_RESCHEDULE_TEST_PHONE||'56987297033');
 if(payload.trial!==true||phone!==allowed)throw Error('reschedule_trial_identity_mismatch');
 return true;
}
async function needsReview(externalId,chosen,error,newId=null,originalId=null){
 await getPool().query("UPDATE melania_reschedule_sessions SET state='needs_review',chosen=$2,error=$3,new_appointment_id=COALESCE($4,new_appointment_id),original_appointment_id=COALESCE($5,original_appointment_id),updated_at=now() WHERE external_id=$1",[externalId,JSON.stringify(chosen||{}),String(error||'needs_review').slice(0,250),newId,originalId]);
 return {status:'needs_review',reply:'El cambio requiere revisión del equipo antes de confirmarlo. No consideraré la cita reagendada hasta verificar ambos registros en Medinet.'};
}
export async function handleDirectReschedule(payload){
 if(!dbEnabled())throw Error('db_required'); await ensure();
 const externalId=Number(payload.external_id),phone=digits(payload.patient?.phone),professionalId=Number(payload.professional?.id),branchId=Number(payload.branch_id);
 if(!Number.isSafeInteger(externalId)||!/^569\d{8}$/.test(phone)||!Number.isSafeInteger(professionalId)||!Number.isSafeInteger(branchId))throw Error('invalid_reschedule_identity');
 const current=(await getPool().query('SELECT * FROM melania_reschedule_sessions WHERE external_id=$1',[externalId])).rows[0];
 const text=String(payload.inbound_message||'').trim();
 if(current&&['booking','cancelling','needs_review'].includes(current.state))return {status:'needs_review',reply:'Este cambio está en revisión. No enviaré una segunda reserva mientras no se verifique la operación anterior.'};
 if(current?.state==='completed')return {status:'completed',reply:'Esta solicitud ya quedó reagendada y verificada en Medinet.'};
 if(!current||/reagend|reprogram|cambiar|otra hora|otra fecha/i.test(norm(text))){
   const found=await search(payload);await getPool().query(`INSERT INTO melania_reschedule_sessions(external_id,phone,professional_id,professional,branch_id,patient,slots,state,updated_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,'choosing',now()) ON CONFLICT(external_id) DO UPDATE SET phone=$2,professional_id=$3,professional=$4,branch_id=$5,patient=$6,slots=$7,state='choosing',error=NULL,chosen=NULL,original_appointment_id=NULL,new_appointment_id=NULL,updated_at=now()`,[externalId,phone,professionalId,payload.professional.name,branchId,JSON.stringify(payload.patient||{}),JSON.stringify(found.slots)]);
   return {status:'choosing',reply:found.reply,slots:found.slots.map(s=>({date:s.date||s.dataDia,time:s.time}))};
 }
 const slots=Array.isArray(current.slots)?current.slots:[],idx=choice(text,slots.length);
 if(idx===null)return {status:'choosing',reply:'Responde con el número de una de las horas ofrecidas. Si ninguna te sirve, escribe REAGENDAR y buscaré nuevamente.'};
 const selected=slots[idx],refreshed=await search(payload),fresh=refreshed.slots.find(s=>exact(s,selected));
 if(!fresh)return {status:'choosing',reply:'Esa hora ya no está disponible. Escribe REAGENDAR y buscaré alternativas actuales.'};
 if(!assertControlledWrite(payload,phone))return {status:'choosing',reply:'La hora fue seleccionada, pero el cambio automático aún está en modo de prueba. El equipo debe confirmar la modificación.'};
 let original;
 try{original=await resolveOriginal(payload);}catch(e){return needsReview(externalId,fresh,e.message);}
 let originalDetail;
 try{originalDetail=(await appointmentDetailOnChileVps(original.id)).appointment;if(!appointmentMatches(originalDetail,payload)||cancelled(originalDetail))throw Error('original_appointment_verification_failed');}
 catch(e){return needsReview(externalId,fresh,e.message,null,original.id);}
 const run=formatRutWithDots(payload.patient?.run||payload.patient?.rut||patientRun(originalDetail)||patientRun(original.raw));
 if(!run)return needsReview(externalId,fresh,'patient_run_required',null,original.id);
 await getPool().query("UPDATE melania_reschedule_sessions SET state='booking',chosen=$2,original_appointment_id=$3,error=NULL,updated_at=now() WHERE external_id=$1",[externalId,JSON.stringify(fresh),original.id]);
 let booked;
 try{booked=await bookSlotOnChileVps({branchId:fresh.branchId,slot:fresh,patientData:{run,email:payload.patient?.email||originalDetail?.paciente?.email||'',fono:phone}});}
 catch(e){return needsReview(externalId,fresh,'booking_uncertain',null,original.id);}
 const newId=Number(booked?.appointmentId||booked?.medinet?.id||booked?.medinet?.appointment_id);
 if(booked?.success!==true||!Number.isSafeInteger(newId)||newId<1)return needsReview(externalId,fresh,'booking_unverified',null,original.id);
 await getPool().query("UPDATE melania_reschedule_sessions SET state='cancelling',new_appointment_id=$2,updated_at=now() WHERE external_id=$1",[externalId,newId]);
 try{const created=(await appointmentDetailOnChileVps(newId)).appointment;if(!slotMatchesAppointment(created,fresh,payload.professional.name,phone,payload.patient?.name))throw Error('new_appointment_verification_failed');}
 catch(e){return needsReview(externalId,fresh,e.message,newId,original.id);}
 try{const cancelledResult=await updateAppointmentOnChileVps({appointmentId:original.id,action:'Cancel',observation:'Reagendada automáticamente por MelanIA tras elección verificada del paciente.'});if(!cancelled(cancelledResult.appointment))throw Error('old_not_cancelled');}
 catch(e){return needsReview(externalId,fresh,e.message,newId,original.id);}
 await getPool().query("UPDATE melania_reschedule_sessions SET state='completed',chosen=$2,error=NULL,updated_at=now() WHERE external_id=$1",[externalId,JSON.stringify(fresh)]);
 const branch=payload.branch?.name||payload.branch_name||'';
 return {status:'completed',reply:`Listo. Tu cita quedó reagendada con ${payload.professional.name} para el ${fresh.date||fresh.dataDia} a las ${fresh.time}${branch?` en ${branch}`:''}.`,slot:{date:fresh.date||fresh.dataDia,time:fresh.time,branch}};
}

export async function notifyReconciledCompletion(externalId,{env=process.env,fetchImpl=fetch}={}){
 const id=Number(externalId);
 if(!Number.isSafeInteger(id)||id<1)throw Error('external_id_required');
 const token=String(env.CONFIRMATIONS_INTAKE_TOKEN||'');
 const base=String(env.SELL_MEDINET_BACKEND_URL||'https://sell-medinet-backend.onrender.com').replace(/\/+$/,'');
 if(!token)throw Error('confirmations_intake_token_missing');
 const response=await fetchImpl(`${base}/attendance-direct/completion`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({externalId:id}),signal:AbortSignal.timeout(20000)});
 let data={};try{data=await response.json();}catch{}
 if(!response.ok)throw Error(`completion_notify_${response.status}:${String(data?.error||'').slice(0,120)}`);
 return data;
}

export async function notifyExactSyntheticCompletion(options){
 return notifyReconciledCompletion(990000001,options);
}

export async function reconcileExactSyntheticSession(){
 if(!dbEnabled())return {status:'skipped',reason:'db_disabled'};
 await ensure();
 const {rows:[s]}=await getPool().query('SELECT * FROM melania_reschedule_sessions WHERE external_id=990000001');
 if(!s||s.phone!=='56987297033'||s.state!=='needs_review'||!s.original_appointment_id||!s.new_appointment_id||!s.chosen)
   return {status:'skipped',reason:'session_not_reconcilable',state:s?.state||null};
 if(Number(s.professional_id)!==13||Number(s.branch_id)!==39)
   return {status:'skipped',reason:'session_identity_mismatch'};
 const chosen=s.chosen,patient=s.patient||{};
 let created;
 try{created=(await appointmentDetailOnChileVps(Number(s.new_appointment_id))).appointment;}
 catch{return {status:'needs_review',reason:'new_appointment_read_failed',newId:Number(s.new_appointment_id)};}
 if(!slotMatchesAppointment(created,chosen,s.professional,s.phone,patient.name))
   return {status:'needs_review',reason:'new_appointment_verification_failed',newId:Number(s.new_appointment_id)};
 let old;
 try{old=(await appointmentDetailOnChileVps(Number(s.original_appointment_id))).appointment;}
 catch{return {status:'needs_review',reason:'old_appointment_read_failed',oldId:Number(s.original_appointment_id),newId:Number(s.new_appointment_id)};}
 const oldIdentity=String(old?.sucursal?.id||'')===String(s.branch_id)
   && professionalMatches(old,s.professional_id,s.professional)
   && patientMatches(old,s.phone,patient.name);
 if(!oldIdentity)return {status:'needs_review',reason:'old_appointment_identity_mismatch',oldId:Number(s.original_appointment_id),newId:Number(s.new_appointment_id)};
 if(!cancelled(old)){
   try{
     const result=await updateAppointmentOnChileVps({appointmentId:Number(s.original_appointment_id),action:'Cancel',observation:'Reagendada automáticamente por MelanIA tras verificación de nueva reserva.'});
     if(!cancelled(result.appointment))
       return {status:'needs_review',reason:'old_not_cancelled',oldId:Number(s.original_appointment_id),newId:Number(s.new_appointment_id)};
   }catch{
     return {status:'needs_review',reason:'old_cancel_failed',oldId:Number(s.original_appointment_id),newId:Number(s.new_appointment_id)};
   }
 }
 await getPool().query("UPDATE melania_reschedule_sessions SET state='completed',error=NULL,updated_at=now() WHERE external_id=$1",[s.external_id]);
 await getPool().query("UPDATE attendance_direct.requests SET state='rescheduled',medinet_status='completed',error=NULL,verified_at=now() WHERE id=2 AND trial=true AND phone='56987297033'");
 await getPool().query("UPDATE attendance_direct.control SET paused=false,reason='exact_trial_completed',updated_at=now() WHERE phone='56987297033'");
 let notification;
 try{notification=await notifyReconciledCompletion(Number(s.external_id));}
 catch(error){notification={sent:false,error:String(error.message||error)};}
 return {status:'completed',oldId:Number(s.original_appointment_id),newId:Number(s.new_appointment_id),date:chosen.dataDia,time:chosen.time,notification};
}
