/**
 * Medinet Dashboard Sync — fetches all professional slots for 14 days.
 * Runs on VPS Chile (69.6.226.132) via cron every 15 minutes.
 *
 * Usage:
 *   node medinet-dashboard-sync.cjs
 *
 * Environment:
 *   MEDINET_SUCURSALES  — comma-separated sucursal IDs (default: "39")
 *   DASHBOARD_DATA_DIR  — output directory (default: ./data)
 *   MEDINET_DAYS        — days ahead to fetch (default: 14)
 *   MEDINET_CONCURRENCY — max parallel professional fetches (default: 3)
 *   MEDINET_JWT_USERNAME — JWT username for all-appointments endpoint (optional)
 *   MEDINET_JWT_PASSWORD — JWT password for all-appointments endpoint (optional)
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://clinyco.medinetapp.com';
const HEADERS = {
  'Referer': `${BASE_URL}/agendaweb/planned/`,
  'X-Requested-With': 'XMLHttpRequest',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const SUCURSAL_NAMES = {
  '39': 'Antofagasta Mall Arauco Express',
  '38': 'Endoscopia',
  '41': 'Santiago',
  '4': 'Calama - DiagnoSalud',
  '2': 'Telemedicina Médica',
  '3': 'Telemedicina Nutrición/Psicología',
};

const SUCURSALES = (process.env.MEDINET_SUCURSALES || '39').split(',').map(s => s.trim()).filter(Boolean);
const DATA_DIR = process.env.DASHBOARD_DATA_DIR || path.join(__dirname, 'data');
const DAYS_AHEAD = Number(process.env.MEDINET_DAYS) || 14;
const CONCURRENCY = Number(process.env.MEDINET_CONCURRENCY) || 3;

let _jwtToken = null;

async function loginJwt() {
  // Try credentials in priority order. MEDINET_USER/MEDINET_USER_KEY is the active
  // service account; MEDINET_JWT_USERNAME/PASSWORD may be a legacy/inactive account.
  const candidates = [
    [process.env.MEDINET_USER, process.env.MEDINET_USER_KEY],
    [process.env.MEDINET_JWT_USERNAME, process.env.MEDINET_JWT_PASSWORD],
    [process.env.MEDINET_EMAIL, process.env.MEDINET_EMAIL_KEY],
  ];
  for (const [username, password] of candidates) {
    if (!username || !password) continue;
    try {
      const res = await fetch(`${BASE_URL}/token-login/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          console.log(`  JWT login OK (user=${username})`);
          return data.token;
        }
      } else {
        console.log(`  JWT login failed for ${username}: ${res.status}`);
      }
    } catch (err) {
      console.log(`  JWT login error for ${username}: ${err.message}`);
    }
  }
  return null;
}

let _jwtAttempted = false;

async function getJwtToken() {
  if (_jwtToken) return _jwtToken;
  if (_jwtAttempted) return null;
  _jwtAttempted = true;
  _jwtToken = await loginJwt();
  return _jwtToken;
}

async function fetchAllAppointments(branchId, startDate, endDate) {
  const jwt = await getJwtToken();
  if (!jwt) {
    console.log('  JWT unavailable — occupied data will be empty');
    return null;
  }
  try {
    const url = `${BASE_URL}/api-public/schedule/appointment/all-appointments/${startDate}/${endDate}/?branch_id=${branchId}`;
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `MEDINET_JWT ${jwt}`,
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.log(`  all-appointments HTTP ${res.status} for branch ${branchId}`);
      return null;
    }
    const body = await res.json();
    // Endpoint may return a bare array or a wrapped object (DRF pagination, etc.)
    const list = Array.isArray(body)
      ? body
      : (body.results || body.appointments || body.data || body.citas || []);
    if (!Array.isArray(body)) {
      console.log(`  all-appointments wrapped response keys: [${Object.keys(body).join(', ')}] → extracted ${list.length} items`);
    }
    return list;
  } catch (err) {
    console.log(`  all-appointments error: ${err.message}`);
    return null;
  }
}

// Appointments and proximos-cupos-all share no professional id or RUN —
// the only common fields are nombres + paterno, so occupancy is keyed by name.
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function profNameKey(nombres, paterno) {
  return `${normName(nombres)}|${normName(paterno)}`;
}

// Appointment dates come as "2026/05/14"; slot dates as "2026-05-14".
function normFecha(fecha) {
  return String(fecha || '').slice(0, 10).replace(/\//g, '-');
}

function buildOccupiedMap(appointments) {
  const map = {};
  if (!Array.isArray(appointments)) return map;
  let skipped = 0;
  for (const apt of appointments) {
    const prof = apt.profesional || apt.professional || {};
    const nameKey = profNameKey(prof.nombres, prof.paterno);
    const fecha = normFecha(apt.fecha || apt.date);
    if (nameKey === '|' || !fecha) { skipped++; continue; }
    const key = `${nameKey}_${fecha}`;
    map[key] = (map[key] || 0) + 1;
  }
  if (appointments.length > 0) {
    console.log(`  Occupied map: ${Object.keys(map).length} name-date keys from ${appointments.length} appointments (${skipped} skipped)`);
  }
  return map;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { ...options, headers: HEADERS, signal: AbortSignal.timeout(15000) });
      if (!response.ok && response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

async function fetchProximosCuposAll(sucursalId) {
  const url = `${BASE_URL}/api/agenda/citas/proximos-cupos-all/${sucursalId}/`;
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    console.error(`proximos-cupos-all/${sucursalId} returned ${response.status}`);
    return [];
  }
  const data = await response.json();
  return Array.isArray(data) ? data : (data.profesionales || []);
}

function parsePickerFechaHtml(html) {
  const result = { dates: [], slots: {} };

  // Extract notable dates from BeatPicker config (dates that have slots)
  // Pattern: notable dates are in a JS array like notableDates: ["2026-05-11", ...]
  // or as data attributes on calendar cells
  const notableMatch = html.match(/notableDates\s*:\s*\[([^\]]*)\]/i);
  if (notableMatch) {
    const dateStrings = notableMatch[1].match(/["'](\d{4}-\d{2}-\d{2})["']/g) || [];
    result.dates = dateStrings.map(d => d.replace(/["']/g, ''));
  }

  // Also try to extract from: notable: [{date: "YYYY-MM-DD"}, ...]
  const notableObjMatch = html.match(/notable\s*:\s*\[([^\]]*)\]/i);
  if (notableObjMatch && !result.dates.length) {
    const dateStrings = notableObjMatch[1].match(/["'](\d{4}-\d{2}-\d{2})["']/g) || [];
    result.dates = dateStrings.map(d => d.replace(/["']/g, ''));
  }

  // Extract dates from cell markup: data-date="YYYY-MM-DD" class="...notable..."
  const cellDates = html.match(/data-date=["'](\d{4}-\d{2}-\d{2})["'][^>]*class=["'][^"']*notable/gi) || [];
  for (const match of cellDates) {
    const dateMatch = match.match(/data-date=["'](\d{4}-\d{2}-\d{2})["']/);
    if (dateMatch && !result.dates.includes(dateMatch[1])) {
      result.dates.push(dateMatch[1]);
    }
  }

  // Extract time slots from table-horarios: <button class="btn-reservar" data-hora="09:00" ...>
  // and data-dia on the table: <div class="table-horarios" data-dia="2026-05-11">
  const tableRegex = /class=["'][^"']*table-horarios[^"']*["'][^>]*data-dia=["'](\d{4}-\d{2}-\d{2})["']/gi;
  const horaRegex = /data-hora=["'](\d{2}:\d{2})["']/gi;

  const tables = html.split(/class=["'][^"']*table-horarios/i);
  for (let i = 1; i < tables.length; i++) {
    const chunk = tables[i];
    const diaMatch = chunk.match(/data-dia=["'](\d{4}-\d{2}-\d{2})["']/);
    if (!diaMatch) continue;
    const fecha = diaMatch[1];
    const horas = [];
    let horaMatch;
    const horaRe = /data-hora=["'](\d{2}:\d{2})["']/g;
    while ((horaMatch = horaRe.exec(chunk)) !== null) {
      if (!horas.includes(horaMatch[1])) horas.push(horaMatch[1]);
    }
    if (horas.length) {
      result.slots[fecha] = horas.sort();
      if (!result.dates.includes(fecha)) result.dates.push(fecha);
    }
  }

  result.dates.sort();
  return result;
}

async function fetchPickerFecha(sucursalId, especialidadId, profesionalId) {
  const url = `${BASE_URL}/agendaweb/planned/picker-fecha/${sucursalId}/${especialidadId}/${profesionalId}/0/?is_resource=0`;
  try {
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      console.error(`picker-fecha ${profesionalId} returned ${response.status}`);
      return { dates: [], slots: {} };
    }
    const html = await response.text();
    return parsePickerFechaHtml(html);
  } catch (err) {
    console.error(`picker-fecha ${profesionalId} error: ${err.message}`);
    return { dates: [], slots: {} };
  }
}

async function fetchHorasForDate(sucursalId, especialidadId, profesionalId, fecha) {
  // Try the endpoint that returns time slots for a specific date
  const url = `${BASE_URL}/agendaweb/planned/picker-hora/${sucursalId}/${especialidadId}/${profesionalId}/0/${fecha}/?is_resource=0`;
  try {
    const response = await fetchWithRetry(url);
    if (!response.ok) return [];
    const html = await response.text();
    const horas = [];
    const horaRe = /data-hora=["'](\d{2}:\d{2})["']/g;
    let match;
    while ((match = horaRe.exec(html)) !== null) {
      if (!horas.includes(match[1])) horas.push(match[1]);
    }
    return horas.sort();
  } catch {
    return [];
  }
}

function filterDatesInRange(dates) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + DAYS_AHEAD);

  return dates.filter(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    return d >= today && d < end;
  });
}

async function processBatch(items, concurrency, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length) await sleep(500);
  }
  return results;
}

async function fetchProfessionalSlots(sucursalId, prof, occupiedMap) {
  const especialidadId = prof.especialidad_id || prof.specialtyId || '1';
  const profesionalId = prof.id;

  // Build full name: "nombres paterno" (API uses these fields)
  const fullName = [prof.nombres || prof.nombre || prof.name, prof.paterno || prof.materno || ''].filter(Boolean).join(' ').trim();

  // Occupancy is keyed by name (appointments carry no professional id)
  const nameKey = profNameKey(prof.nombres || prof.nombre || prof.name, prof.paterno);

  // Use cupos from the initial API response (already filtered by sucursal)
  let cupos = Array.isArray(prof.cupos) ? prof.cupos : [];

  // Build slots, only keeping dates within range
  const slotsByDate = {};
  for (const cupo of cupos) {
    const fecha = cupo.fecha;
    if (!fecha) continue;
    const horas = Array.isArray(cupo.horas) ? cupo.horas : [];
    if (!horas.length) continue;
    slotsByDate[fecha] = slotsByDate[fecha] || [];
    for (const h of horas) {
      if (!slotsByDate[fecha].includes(h)) slotsByDate[fecha].push(h);
    }
  }

  // If proximos-cupos-all only returned the next 1 cupo per prof, fetch full range via picker-fecha
  const cuposDates = Object.keys(slotsByDate);
  const datesInRange = filterDatesInRange(cuposDates);

  // Try to enrich with picker-fecha to get ALL slots in the next 14 days (not just next one)
  try {
    const pickerResult = await fetchPickerFecha(sucursalId, especialidadId, profesionalId);
    const pickerDatesInRange = filterDatesInRange(pickerResult.dates);
    for (const fecha of pickerDatesInRange) {
      const horas = pickerResult.slots[fecha] || [];
      if (!horas.length) continue;
      slotsByDate[fecha] = slotsByDate[fecha] || [];
      for (const h of horas) {
        if (!slotsByDate[fecha].includes(h)) slotsByDate[fecha].push(h);
      }
    }
  } catch (err) {
    // Non-fatal: we still have the initial cupos from proximos-cupos-all
  }

  // Include dates that have appointments but no free slots (fully booked),
  // so a 0-availability day still renders as "0/N" instead of disappearing.
  const allDates = new Set(Object.keys(slotsByDate));
  const occPrefix = `${nameKey}_`;
  for (const occKey of Object.keys(occupiedMap || {})) {
    if (occKey.startsWith(occPrefix)) allDates.add(occKey.slice(occPrefix.length));
  }

  const slots = [...allDates]
    .filter(fecha => {
      const d = new Date(fecha + 'T00:00:00');
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const end = new Date(today); end.setDate(end.getDate() + DAYS_AHEAD);
      return d >= today && d < end;
    })
    .sort()
    .map(fecha => {
      const horas = (slotsByDate[fecha] || []).sort();
      const ocupados = (occupiedMap || {})[`${nameKey}_${fecha}`] || 0;
      return { fecha, horas, disponibles: horas.length, ocupados, total: horas.length + ocupados };
    });

  return {
    id: profesionalId,
    nombre: fullName || prof.nombre || '',
    especialidad: prof.especialidad || prof.specialty || '',
    especialidad_id: especialidadId,
    duracion_cita: Number(prof.duracion_cita || prof.duracion || 0),
    avatar_url: prof.avatar_url || prof.avatarUrl || '',
    alert: prof.agendaweb_alert || prof.alert_text || prof.alert || '',
    slots,
    total_horas: slots.reduce((sum, s) => sum + s.horas.length, 0),
    total_ocupados: slots.reduce((sum, s) => sum + s.ocupados, 0),
  };
}

async function syncSucursal(sucursalId) {
  console.log(`\nSyncing sucursal ${sucursalId} (${SUCURSAL_NAMES[sucursalId] || 'Unknown'})...`);

  const profesionales = await fetchProximosCuposAll(sucursalId);
  if (!profesionales.length) {
    console.log(`  No professionals found for sucursal ${sucursalId}`);
    return { nombre: SUCURSAL_NAMES[sucursalId] || sucursalId, profesionales: [] };
  }

  console.log(`  Found ${profesionales.length} professionals`);

  // Fetch occupied appointments via JWT (if credentials available)
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + DAYS_AHEAD);
  const startIso = today.toISOString().slice(0, 10);
  const endIso = endDate.toISOString().slice(0, 10);
  const appointments = await fetchAllAppointments(sucursalId, startIso, endIso);
  const occupiedMap = buildOccupiedMap(appointments);
  if (appointments) {
    console.log(`  Appointments loaded: ${Array.isArray(appointments) ? appointments.length : 0} (occupied data available)`);
  }

  const enriched = await processBatch(profesionales, CONCURRENCY, async (prof) => {
    return fetchProfessionalSlots(sucursalId, prof, occupiedMap);
  });

  // Sort: professionals with more slots first
  enriched.sort((a, b) => b.total_horas - a.total_horas);

  return {
    nombre: SUCURSAL_NAMES[sucursalId] || sucursalId,
    profesionales: enriched,
  };
}

async function main() {
  console.log(`Medinet Dashboard Sync started at ${new Date().toISOString()}`);
  console.log(`Sucursales: ${SUCURSALES.join(', ')} | Days: ${DAYS_AHEAD} | Concurrency: ${CONCURRENCY}`);

  const sucursales = {};
  let totalSlots = 0;
  let totalProfessionals = 0;

  for (const sucursalId of SUCURSALES) {
    try {
      const result = await syncSucursal(sucursalId);
      sucursales[sucursalId] = result;
      totalProfessionals += result.profesionales.length;
      totalSlots += result.profesionales.reduce((sum, p) => sum + p.total_horas, 0);
    } catch (err) {
      console.error(`Error syncing sucursal ${sucursalId}: ${err.message}`);
      sucursales[sucursalId] = {
        nombre: SUCURSAL_NAMES[sucursalId] || sucursalId,
        profesionales: [],
        error: err.message,
      };
    }
  }

  const output = {
    syncedAt: new Date().toISOString(),
    daysAhead: DAYS_AHEAD,
    totalProfessionals,
    totalSlots,
    sucursales,
  };

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const outputPath = path.join(DATA_DIR, 'dashboard-slots.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`\nSync complete: ${totalProfessionals} professionals, ${totalSlots} total time slots`);
  console.log(`Data saved to ${outputPath}`);
}

main().catch(err => {
  console.error('SYNC_ERROR', err.stack || err.message);
  process.exitCode = 1;
});
