const norm = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g,' ').trim();

const months = Object.freeze({enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12});
const pad = n => String(n).padStart(2,'0');
const validIso = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
export const rutKey = value => String(value || '').toUpperCase().replace(/[^0-9K]/g,'');

export function appointmentStatusIntent(text,{pending=false}={}) {
  if(pending) return true;
  const n=norm(text);
  const existing=/tengo\s+(?:una\s+)?(?:hora|cita)|tenia\s+(?:una\s+)?(?:hora|cita)|hora\s+agendada|cita\s+agendada|confirmar\s+(?:una\s+)?(?:hora|cita)|sigue\s+(?:vigente|agendada)|vigente|anulad|cancelad|me\s+llego\s+.*correo/.test(n);
  if(!existing) return false;
  const newBooking=/\b(?:necesito|quiero|busco)\s+(?:una\s+)?hora\b|\b(?:agendar|reservar)\b/.test(n);
  return !newBooking || /tengo|tenia|confirmar|anulad|cancelad|vigente/.test(n);
}

function chileYear(now=new Date()) {
  return Number(new Intl.DateTimeFormat('en',{timeZone:'America/Santiago',year:'numeric'}).format(now));
}
function makeDate(day,month,year) {
  const iso=`${year}-${pad(month)}-${pad(day)}`;
  return validIso(iso)?iso:null;
}

export function extractAppointmentDate(text,now=new Date()) {
  const raw=String(text||'');
  let m=raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if(m)return makeDate(Number(m[3]),Number(m[2]),Number(m[1]));
  m=raw.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if(m)return makeDate(Number(m[1]),Number(m[2]),Number(m[3]||chileYear(now)));
  const n=norm(raw);
  m=n.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(20\d{2}))?\b/);
  return m?makeDate(Number(m[1]),months[m[2]],Number(m[3]||chileYear(now))):null;
}

export function extractAppointmentTime(text) {
  const raw=String(text||'');
  const m=raw.match(/(?:\ba\s+las\s+)?\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/i);
  return m?`${pad(Number(m[1]))}:${m[2]}`:null;
}

export function recoverAppointmentCriteria({texts=[],rut='',professional='',date='',time='',now=new Date()}={}) {
  const list=[...texts].filter(Boolean).map(String);
  const reverse=[...list].reverse();
  return {
    rut: rutKey(rut), professional: String(professional||'').trim(),
    date: date || reverse.map(t=>extractAppointmentDate(t,now)).find(Boolean) || null,
    time: time || reverse.map(extractAppointmentTime).find(Boolean) || null,
  };
}

const fullName = value => [value?.nombres,value?.paterno,value?.materno].filter(Boolean).join(' ').trim();
const isoDate = value => String(value||'').slice(0,10).replaceAll('/','-');
const hhmm = value => String(value||'').slice(0,5);
const professionalMatch = (actual,wanted) => {
  const a=norm(actual),w=norm(wanted);if(!w)return true;
  const tokens=w.replace(/\b(dr|dra|doctor|doctora)\b/g,'').split(' ').filter(x=>x.length>2);
  return tokens.length?tokens.every(t=>a.includes(t)):a.includes(w);
};

export function matchExistingAppointments(rawAppointments=[],criteria={}) {
  const rows=(Array.isArray(rawAppointments)?rawAppointments:[]).map(raw=>({raw,id:Number(raw?.id),date:isoDate(raw?.fecha),time:hhmm(raw?.hora),
    patientRut:rutKey(raw?.paciente?.run||raw?.paciente?.rut),professional:fullName(raw?.profesional),
    branch:String(raw?.sucursal?.nombre||''),type:String(raw?.tipo||raw?.especialidad_nombre||'Consulta'),status:String(raw?.estado?.nombre||'Sin estado')}));
  const byPatient=rows.filter(a=>criteria.rut&&a.patientRut===rutKey(criteria.rut));
  const byDate=byPatient.filter(a=>!criteria.date||a.date===criteria.date);
  const byProfessional=byDate.filter(a=>professionalMatch(a.professional,criteria.professional));
  const exact=byProfessional.filter(a=>!criteria.time||a.time===criteria.time);
  return {exact,professionalDay:byProfessional,patientDay:byDate};
}

export function appointmentStatusReply(match,criteria={}) {
  const list=match?.exact||[];
  if(list.length===1){
    const a=list[0];
    const status=norm(a.status);
    if(['cancelada','cancelado','anulada','anulado','re-agendado','reagendado'].includes(status))
      return `Revisé Medinet. La cita del ${a.date.split('-').reverse().join('/')} a las ${a.time} con ${a.professional} figura ${a.status}.`;
    return `Sí. Revisé Medinet y tu cita del ${a.date.split('-').reverse().join('/')} a las ${a.time} con ${a.professional} está registrada. Estado: ${a.status}.`;
  }
  if(list.length>1)return `Encontré ${list.length} citas que coinciden con esos datos. Para no confundirme, dime cuál horario quieres revisar.`;
  if(criteria.time&&match?.professionalDay?.length===1){
    const a=match.professionalDay[0];
    return `Revisé Medinet. Encontré una cita con ${a.professional} ese día, pero figura a las ${a.time}, no a las ${criteria.time}. Estado: ${a.status}.`;
  }
  if(match?.professionalDay?.length>1){
    const times=match.professionalDay.map(a=>a.time).join(', ');
    return `Revisé Medinet y encontré citas con ese profesional ese día a las ${times}. Dime cuál quieres confirmar.`;
  }
  return `Revisé Medinet y no encontré una cita que coincida con ese RUT, profesional y fecha${criteria.time?` a las ${criteria.time}`:''}.`;
}
