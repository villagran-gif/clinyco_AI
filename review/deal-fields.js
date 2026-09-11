import {readFile} from 'node:fs/promises';
import {normalizeRut} from '../extraction/identity-normalizers.js';
export const dealFields = JSON.parse(await readFile(new URL('./site/deal-fields.json',import.meta.url),'utf8'));
export class DealFieldError extends Error {}
const fail = field => { throw new DealFieldError(`Revisa el campo «${field}».`); };
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function validateDealDetails(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Ficha del DEAL');
  if (Object.keys(input).some(k=>!dealFields.some(f=>f.key===k))) fail('Campo no permitido');
  const result={};
  for (const f of dealFields) {
    if (!Object.hasOwn(input,f.key)) continue;
    const value=input[f.key];
    if (value === '' || value === null) {result[f.key]=null;continue;}
    if (f.type==='number') {
      if (typeof value!=='number' || !Number.isFinite(value) || value<f.min || value>f.max || (f.key==='value' && !Number.isInteger(value))) fail(f.label);
      result[f.key]=value;continue;
    }
    if (typeof value!=='string' || value.length>f.maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(f.label);
    const v=value.trim();
    if (!v) {result[f.key]=null;continue;}
    if (f.type==='date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10)!==v)) fail(f.label);
    if (f.key==='birthDate' && (v>today() || v<'1900-01-01')) fail(f.label);
    if (f.type==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(f.label);
    if (f.type==='select' && !f.options.includes(v)) fail(f.label);
    if (f.type==='tel' && !/^\+?[\d ()-]{8,25}$/.test(v)) fail(f.label);
    if (f.key==='idDocument' && /^[\d.kK-]+$/.test(v) && /[.-]/.test(v) && !normalizeRut(v)) fail('RUT (dígito verificador) o documento extranjero');
    if (f.type==='url') {
      let u; try {u=new URL(v);} catch {fail(f.label);}
      if (u.protocol!=='https:' || u.username || u.password || u.port) fail(f.label);
      if (f.key==='medinetUrl' && (u.hostname!=='clinyco.medinetapp.com' || !/^\/pacientes\/ficha\/(?:\d+\/\d+|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}(?:\/\d+)?)\/?$/i.test(u.pathname) || u.search || u.hash)) fail(f.label);
      if (f.key==='examsUrl' && u.hostname!=='drive.google.com') fail(f.label);
    }
    result[f.key]=v;
  }
  return result;
}
export function computedDealDetails(details={}, date=today()) {
  let age=null;
  if (details.birthDate) {
    const [y,m,d]=details.birthDate.split('-').map(Number), [ty,tm,td]=date.split('-').map(Number);
    age=ty-y-(tm<m || (tm===m && td<d) ? 1 : 0);
  }
  let phone=String(details.phone || '').replace(/\D/g,'');
  if (/^9\d{8}$/.test(phone)) phone=`56${phone}`;
  return { age, bmi:details.weight && details.height ? Math.round(details.weight / ((details.height/100)**2)*10)/10 : null,
    normalizedRut:/^[\d.kK-]+$/.test(details.idDocument || '') ? normalizeRut(details.idDocument)?.replace('-','') || null : null,
    whatsappUrl:/^[1-9]\d{7,14}$/.test(phone) ? `https://wa.me/${phone}` : null };
}
