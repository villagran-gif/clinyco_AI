/**
 * Clinyco VPS API Server — unified Medinet gateway.
 * Runs on VPS Chile (69.6.226.132).
 *
 * Responsibilities:
 *   1. Serve dashboard slot data (/api/slots, /api/sync-status)
 *   2. Medinet gateway for Render (/api/medinet/search, /api/medinet/book, /api/medinet/cache)
 *   3. CORS for Netlify frontend (clinyco-ai.netlify.app)
 *
 * Usage:
 *   node medinet-api-server.cjs
 *
 * Environment:
 *   API_PORT            — HTTP port (default: 3002)
 *   API_KEY             — shared secret for Medinet gateway (required)
 *   DASHBOARD_DATA_DIR  — data directory (default: ./data)
 *   MEDINET_RUT         — patient RUT for Medinet (default: 13580388k)
 *   CORS_ORIGINS        — comma-separated allowed origins (default: https://clinyco-ai.netlify.app)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.API_PORT) || 3002;
const API_KEY = process.env.API_KEY || '';
const DATA_DIR = process.env.DASHBOARD_DATA_DIR || path.join(__dirname, 'data');
const MEDINET_RUT = process.env.MEDINET_RUT || '13580388k';
const SLOTS_FILE = path.join(DATA_DIR, 'dashboard-slots.json');
const ANTONIA_SCRIPT = path.join(__dirname, '..', 'Antonia', 'medinet-antonia.cjs');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://clinyco-ai.netlify.app').split(',').map(s => s.trim());

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allowed = CORS_ORIGINS.includes(origin) || CORS_ORIGINS.includes('*');
  return {
    'Access-Control-Allow-Origin': allowed ? origin : CORS_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function checkApiKey(req) {
  if (!API_KEY) return true;
  return req.headers['x-api-key'] === API_KEY;
}

function readSlots() {
  try {
    return JSON.parse(fs.readFileSync(SLOTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(data));
}

function parseAntoniaResponse(stdout) {
  const match = String(stdout || '').match(/ANTONIA_RESPONSE\s+(\{[\s\S]*\})/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function handleMedinetSearch(body) {
  const query = String(body.query || '').trim();
  if (!query) return { error: 'Missing query' };

  const timeoutMs = Number(body.timeout || 45000);
  const { stdout } = await execFileAsync('node', [ANTONIA_SCRIPT], {
    env: {
      ...process.env,
      MEDINET_RUT,
      MEDINET_QUERY: query,
      MEDINET_PATIENT_PHONE: String(body.patientPhone || ''),
      MEDINET_PATIENT_MESSAGE: String(body.patientMessage || ''),
      MEDINET_HEADED: 'false',
    },
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseAntoniaResponse(stdout);
}

async function handleMedinetBook(body) {
  const { slot, patientData } = body;
  if (!slot || !slot.professionalId || !slot.dataDia || !slot.time) {
    return { error: 'Missing slot data (professionalId, dataDia, time)' };
  }

  const timeoutMs = Number(body.timeout || 60000);
  const { stdout } = await execFileAsync('node', [ANTONIA_SCRIPT], {
    env: {
      ...process.env,
      MEDINET_MODE: 'book',
      MEDINET_RUT,
      MEDINET_PROFESSIONAL_ID: String(slot.professionalId || ''),
      MEDINET_SLOT_DATE: String(slot.dataDia || ''),
      MEDINET_SLOT_TIME: String(slot.time || ''),
      MEDINET_PATIENT_NOMBRES: String((patientData || {}).nombres || ''),
      MEDINET_PATIENT_AP_PATERNO: String((patientData || {}).apPaterno || ''),
      MEDINET_PATIENT_AP_MATERNO: String((patientData || {}).apMaterno || ''),
      MEDINET_PATIENT_PREVISION: String((patientData || {}).prevision || ''),
      MEDINET_PATIENT_NACIMIENTO: String((patientData || {}).nacimiento || ''),
      MEDINET_PATIENT_EMAIL: String((patientData || {}).email || ''),
      MEDINET_PATIENT_FONO: String((patientData || {}).fono || ''),
      MEDINET_PATIENT_DIRECCION: String((patientData || {}).direccion || ''),
      MEDINET_HEADED: 'false',
    },
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseAntoniaResponse(stdout);
}

async function handleMedinetCache() {
  const timeoutMs = Number(process.env.MEDINET_ANTONIA_TIMEOUT_MS || 60000);
  const { stdout } = await execFileAsync('node', [ANTONIA_SCRIPT], {
    env: {
      ...process.env,
      MEDINET_MODE: 'cache',
      MEDINET_RUT,
      MEDINET_HEADED: 'false',
    },
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseAntoniaResponse(stdout);
}

function readProfessionalsCache() {
  try {
    const cachePath = path.join(__dirname, '..', 'data', 'medinet_professionals_cache.json');
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // --- Public dashboard endpoints (no API key needed) ---

  if (pathname === '/api/slots' && req.method === 'GET') {
    const data = readSlots();
    if (!data) return jsonResponse(res, 503, { error: 'No sync data yet. Run medinet-dashboard-sync.cjs first.' });
    return jsonResponse(res, 200, data, { 'Cache-Control': 'no-cache' });
  }

  if (pathname === '/api/sync-status' && req.method === 'GET') {
    try {
      const stat = fs.statSync(SLOTS_FILE);
      const data = readSlots();
      return jsonResponse(res, 200, {
        lastSync: data?.syncedAt || null,
        fileSize: stat.size,
        totalProfessionals: data?.totalProfessionals || 0,
        totalSlots: data?.totalSlots || 0,
      });
    } catch {
      return jsonResponse(res, 200, { lastSync: null, error: 'No sync data found' });
    }
  }

  // --- Medinet gateway endpoints (API key required) ---

  if (pathname.startsWith('/api/medinet/')) {
    if (!checkApiKey(req)) {
      return jsonResponse(res, 401, { error: 'Invalid or missing X-API-Key header' });
    }

    if (req.method !== 'POST') {
      return jsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return jsonResponse(res, 400, { error: e.message });
    }

    try {
      if (pathname === '/api/medinet/search') {
        const result = await handleMedinetSearch(body);
        return jsonResponse(res, result ? 200 : 502, result || { error: 'Antonia returned no response' });
      }

      if (pathname === '/api/medinet/book') {
        const result = await handleMedinetBook(body);
        return jsonResponse(res, result ? 200 : 502, result || { error: 'Antonia returned no response' });
      }

      if (pathname === '/api/medinet/cache') {
        const result = await handleMedinetCache();
        return jsonResponse(res, result ? 200 : 502, result || { error: 'Cache refresh returned no response' });
      }

      if (pathname === '/api/medinet/professionals') {
        const cache = readProfessionalsCache();
        if (!cache) return jsonResponse(res, 503, { error: 'No professionals cache available' });
        return jsonResponse(res, 200, cache);
      }

      return jsonResponse(res, 404, { error: 'Unknown medinet endpoint' });
    } catch (err) {
      console.error(`MEDINET_API_ERROR [${pathname}]:`, err.message);
      return jsonResponse(res, 500, {
        error: 'Medinet operation failed',
        message: err.message,
        killed: err.killed || false,
        signal: err.signal || null,
      });
    }
  }

  // --- Health check ---
  if (pathname === '/health') {
    return jsonResponse(res, 200, { status: 'ok', uptime: process.uptime() });
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Clinyco VPS API running on http://0.0.0.0:${PORT}`);
  console.log(`CORS origins: ${CORS_ORIGINS.join(', ')}`);
  console.log(`API key: ${API_KEY ? 'enabled' : 'DISABLED (set API_KEY to secure medinet endpoints)'}`);
  console.log(`Antonia script: ${ANTONIA_SCRIPT}`);
});
