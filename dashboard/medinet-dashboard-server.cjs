/**
 * Medinet Dashboard Server — serves the availability dashboard.
 * Runs on VPS Chile alongside the sync script.
 *
 * Usage:
 *   node medinet-dashboard-server.cjs
 *
 * Environment:
 *   DASHBOARD_PORT      — HTTP port (default: 3001)
 *   DASHBOARD_DATA_DIR  — data directory (default: ./data)
 *   DASHBOARD_USER      — basic auth username (default: clinyco)
 *   DASHBOARD_PASS      — basic auth password (required for auth)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.DASHBOARD_PORT) || 3001;
const DATA_DIR = process.env.DASHBOARD_DATA_DIR || path.join(__dirname, 'data');
const AUTH_USER = process.env.DASHBOARD_USER || 'clinyco';
const AUTH_PASS = process.env.DASHBOARD_PASS || '';
const SLOTS_FILE = path.join(DATA_DIR, 'dashboard-slots.json');

function checkAuth(req) {
  if (!AUTH_PASS) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  return user === AUTH_USER && pass === AUTH_PASS;
}

function readSlots() {
  try {
    const raw = fs.readFileSync(SLOTS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function serveFile(filePath, contentType, res) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (origin.endsWith('.netlify.app') || origin.includes('localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

const server = http.createServer((req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!checkAuth(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Clinyco Dashboard"' });
    res.end('Unauthorized');
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname === '/api/slots') {
    const data = readSlots();
    if (!data) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No data yet. Run sync first.' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify(data));
    return;
  }

  if (pathname === '/api/sync-status') {
    try {
      const stat = fs.statSync(SLOTS_FILE);
      const data = readSlots();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        lastSync: data?.syncedAt || null,
        fileSize: stat.size,
        totalProfessionals: data?.totalProfessionals || 0,
        totalSlots: data?.totalSlots || 0,
      }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lastSync: null, error: 'No sync data found' }));
    }
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    serveFile(path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8', res);
    return;
  }

  if (pathname === '/app.js') {
    serveFile(path.join(__dirname, 'public', 'app.js'), 'application/javascript; charset=utf-8', res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard server running on http://0.0.0.0:${PORT}`);
  console.log(`Auth: ${AUTH_PASS ? 'enabled' : 'disabled (set DASHBOARD_PASS to enable)'}`);
});
