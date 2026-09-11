// Destination validation only; never fetch patient URLs or follow redirects during import.
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const medicalPath = new RegExp(`^/pacientes/ficha/(?:(${UUID})(/\\d+){0,4}|(\\d+)/(\\d+))/?$`, 'i');
const resourceId = /^[A-Za-z0-9_-]+$/;

export function normalizePhone(value) {
  const raw = String(value ?? '').trim().replace(/^'(?=[+\d])/, '');
  if (!raw || !/^[+\d\s().-]+$/.test(raw) || /\+(?![^+]*$)/.test(raw) || (raw.includes('+') && !raw.startsWith('+'))) return null;
  if (/^\+?\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  const international = raw.startsWith('+') || raw.startsWith('00');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (!international && /^[2-9]\d{8}$/.test(digits)) digits = `56${digits}`;
  else if (!international && !/^56\d{9}$/.test(digits)) return null;
  if (digits.startsWith('56') && !/^56[2-9]\d{8}$/.test(digits)) return null;
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

export function normalizeEmail(value) {
  const raw = String(value ?? '').trim().replace(/^mailto:/i, '');
  if (!/^[^\s@<>?&#]+@[^\s@<>?&#]+\.[^\s@<>?&#]+$/.test(raw)) return null;
  const at = raw.lastIndexOf('@');
  return `${raw.slice(0, at)}@${raw.slice(at + 1).toLowerCase()}`;
}

export function normalizeDealUrl(kind, value) {
  let raw = String(value ?? '').trim();
  if (!raw || /[\x00-\x20\x7f\\{}<>]/.test(raw)) return null;
  if (/^(clinyco\.medinetapp\.com|drive\.google\.com|app\.chatwoot\.com|wa\.me)\//i.test(raw)) raw = `https://${raw}`;
  let u; try { u = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || u.hash) return null;
  u.protocol = 'https:';
  if (kind === 'medinetUrl') {
    if (u.hostname !== 'clinyco.medinetapp.com' || u.search || !medicalPath.test(u.pathname)) return null;
    // Numeric suffixes beyond the section select tabs in old Medinet links.
    // Keep the same patient and first section, never derive identity from a name.
    const parts = u.pathname.split('/').filter(Boolean);
    return `${u.origin}/pacientes/ficha/${parts.slice(2, 4).join('/')}${u.pathname.endsWith('/') ? '/' : ''}`;
  }
  if (kind === 'examsUrl') {
    if (u.hostname !== 'drive.google.com') return null;
    const folder = u.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/);
    const file = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/(?:view|edit|preview))?\/?$/);
    const open = /^\/(?:open|uc)$/.test(u.pathname) && resourceId.test(u.searchParams.get('id') || '') ? u.searchParams.get('id') : null;
    if (!folder && !file && !open) return null;
    const path = folder ? `/drive/folders/${folder[1]}` : `/file/d/${file?.[1] || open}/view`;
    const key = u.searchParams.get('resourcekey');
    if (key && !resourceId.test(key)) return null;
    return `https://drive.google.com${path}${key ? `?resourcekey=${key}` : ''}`;
  }
  if (kind === 'chatwootUrl') return u.hostname === 'app.chatwoot.com' && !u.search && /^\/app\/accounts\/162472\/conversations\/\d+\/?$/.test(u.pathname) ? `${u.origin}${u.pathname.replace(/\/$/, '')}` : null;
  if (kind === 'whatsappUrl') {
    if (u.hostname !== 'wa.me' || u.search || !/^\/[1-9]\d{7,14}\/?$/.test(u.pathname)) return null;
    return `https://wa.me/${u.pathname.replace(/\//g, '')}`;
  }
  return null;
}
