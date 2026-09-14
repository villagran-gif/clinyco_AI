import { getPool, dbEnabled } from '../db.js';
import { updateAppointmentState, fetchAppointmentDetail, formatRutWithDots } from '../Antonia/medinet-api.js';
import { searchSlotsOnChileVps, bookSlotOnChileVps } from './medinet-worker-client.js';

const norm = v => String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const digits = v => String(v||'').replace(/\D/g,'');
let ensured=false;
async function ensure(){if(ensured||!dbEnabled())return;await getPool().query(`CREATE TABLE IF NOT EXISTS melania_reschedule_sessions(
 external_id bigint PRIMARY KEY, phone text NOT NULL, professional_id bigint NOT NULL, professional text NOT NULL,
 branch_id bigint NOT NULL, patient jsonb NOT NULL, slots jsonb NOT NULL DEFAULT '[]', state text NOT NULL DEFAULT 'choosing',
 chosen jsonb, error text, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now())`);ensured=true;}
function choice(text,max){const m=String(text||'').trim().match(/^(?:opci[oó]n\s*)?(\d{1,2})$/i);if(!m)return null;const n=Number(m[1]);return n>=1&&n<=max?n-1:null;}
function exact(a,b){return ['professionalId','branchId','specialtyId','tipoCitaId','dataDia','time'].every(k=>String(a?.[k])===String(b?.[k]));}
function options(result){const slots=(result.available_slots||[]).slice(0,6);if(!slots.length)return {slots,reply:`No encontré horas próximas con ${result.professional||'el mismo profesional'}. Si quieres, el equipo puede ayudarte.`};return {slots,reply:`Encontré estas horas con ${result.professional}:\n\n${slots.map((s,i)=>`${i+1}. ${s.date||s.dataDia} a las ${s.time}`).join('\n')}\n\nResponde con el número de la opción que prefieres.`};}
async function search(payload){
 const r=await searchSlotsOnChileVps({query:payload.professional.name,patientRut:payload.patient?.run||payload.patient?.rut||'',branchId:payload.branch_id});
 const same=(r.available_slots||[]).filter(s=>String(s.professionalId)===String(payload.professional.id));
 return options({...r,professional:payload.professional.name,available_slots:same});
}
export async function handleDirectReschedule(payload){
 if(!dbEnabled())throw Error('db_required'); await ensure();
 const externalId=Number(payload.external_id), phone=digits(payload.patient?.phone), professionalId=Number(payload.professional?.id), branchId=Number(payload.branch_id);
 if(!Number.isSafeInteger(externalId)||!/^569\d{8}$/.test(phone)||!Number.isSafeInteger(professionalId)||!Number.isSafeInteger(branchId))throw Error('invalid_reschedule_identity');
 const current=(await getPool().query('SELECT * FROM melania_reschedule_sessions WHERE external_id=$1',[externalId])).rows[0];
 const text=String(payload.inbound_message||'').trim();
 if(!current || current.state!=='choosing' || /reagend|reprogram|cambiar|otra hora|otra fecha/i.test(norm(text))){
   const found=await search(payload);await getPool().query(`INSERT INTO melania_reschedule_sessions(external_id,phone,professional_id,professional,branch_id,patient,slots,state,updated_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,'choosing',now()) ON CONFLICT(external_id) DO UPDATE SET phone=$2,professional_id=$3,professional=$4,branch_id=$5,patient=$6,slots=$7,state='choosing',error=NULL,updated_at=now()`,[externalId,phone,professionalId,payload.professional.name,branchId,JSON.stringify(payload.patient||{}),JSON.stringify(found.slots)]);
   return {status:'choosing',reply:found.reply,slots:found.slots.map(s=>({date:s.date||s.dataDia,time:s.time}))};
 }
 const slots=Array.isArray(current.slots)?current.slots:[];const idx=choice(text,slots.length);
 if(idx===null){return {status:'choosing',reply:'Responde con el número de una de las horas ofrecidas. Si ninguna te sirve, escribe REAGENDAR y buscaré nuevamente.'};}
 const selected=slots[idx];const refreshed=await search(payload);const fresh=refreshed.slots.find(s=>exact(s,selected));
 if(!fresh)return {status:'choosing',reply:'Esa hora ya no está disponible. Buscaré nuevamente.',refresh:true,...await search(payload)};
 if(process.env.MELANIA_DIRECT_RESCHEDULE_WRITE_ENABLED!=='true') return {status:'choosing',reply:'La hora fue seleccionada, pero el cambio automático aún está en modo de prueba. El equipo debe confirmar la modificación.'};
 const run=formatRutWithDots(payload.patient?.run||payload.patient?.rut||'');if(!run)throw Error('patient_run_required');
 const booked=await bookSlotOnChileVps({branchId:fresh.branchId,slot:fresh,patientData:{run,email:payload.patient?.email||'',fono:phone}});
 if(booked?.success!==true && booked?.status!=='agendado_correctamente' && booked?.medinet?.status!=='agendado_correctamente')return {status:'choosing',reply:'Esa hora no pudo reservarse. Escribe REAGENDAR para buscar otras alternativas.'};
 try{await updateAppointmentState(externalId,'Cancel','Reagendada automáticamente por MelanIA tras elección verificada del paciente.');const old=await fetchAppointmentDetail(externalId);if(!/cancel|anulad/.test(norm(old?.estado?.nombre||old?.data?.estado?.nombre)))throw Error('old_not_cancelled');}
 catch(e){await getPool().query("UPDATE melania_reschedule_sessions SET state='needs_review',chosen=$2,error=$3,updated_at=now() WHERE external_id=$1",[externalId,JSON.stringify(fresh),String(e.message||e)]);return {status:'needs_review',reply:'Reservé la nueva hora, pero necesito que el equipo verifique la cita anterior antes de confirmarte el cambio definitivo.'};}
 await getPool().query("UPDATE melania_reschedule_sessions SET state='completed',chosen=$2,updated_at=now() WHERE external_id=$1",[externalId,JSON.stringify(fresh)]);
 return {status:'completed',reply:`Listo. Tu cita quedó reagendada con ${payload.professional.name} para el ${fresh.date||fresh.dataDia} a las ${fresh.time}.`,slot:{date:fresh.date||fresh.dataDia,time:fresh.time}};
}
