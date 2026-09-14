const base = () => String(process.env.MEDINET_WORKER_URL || '').replace(/\/+$/, '');
const token = () => String(process.env.MEDINET_WORKER_TOKEN || '');

async function post(path, body, timeoutMs = 20000) {
  const url = base();
  const bearer = token();
  if (!url || !bearer) throw new Error('medinet_vps_worker_not_configured');
  const r = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json', Authorization:`Bearer ${bearer}`},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`medinet_vps_invalid_json_${r.status}`); }
  if (!r.ok) throw new Error(`medinet_vps_http_${r.status}:${String(data?.error || '').slice(0,120)}`);
  return data;
}

export function searchSlotsOnChileVps({query, patientRut, branchId}) {
  return post('/medinet/api/search', {query, patientRut, branchId}, 30000);
}

export function bookSlotOnChileVps({slot, patientData, branchId}) {
  return post('/medinet/api/book', {slot, patientData, branchId}, 30000);
}
