#!/usr/bin/env node
/**
 * Zendesk Support — Full account backup
 * ---------------------------------------
 * Uso:
 *   node backup.js              # todo (tickets + users + config)
 *   node backup.js tickets      # solo tickets + comments + attachments
 *   node backup.js users        # solo users + organizations
 *   node backup.js config       # solo configuración (macros, triggers, etc.)
 *
 * Requiere Node 18+ (fetch nativo). Sin dependencias npm.
 * Lee credenciales desde scripts/zendesk-backup/.env
 */

import { readFile, writeFile, mkdir, appendFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- env loader (sin dependencias) ----------
async function loadDotEnv() {
  const envPath = join(__dirname, '.env');
  try {
    const raw = await readFile(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.warn('[warn] No se encontró .env en', envPath, '— usando solo variables de entorno del shell.');
  }
}

await loadDotEnv();

// ---------- config ----------
const SUBDOMAIN = required('ZENDESK_SUBDOMAIN');
const EMAIL = required('ZENDESK_EMAIL');
const TOKEN = required('ZENDESK_API_TOKEN');
const BACKUP_DIR = resolve(__dirname, process.env.ZENDESK_BACKUP_DIR || './backup-output');
const DOWNLOAD_ATTACHMENTS = (process.env.ZENDESK_DOWNLOAD_ATTACHMENTS || 'true').toLowerCase() !== 'false';
const START_TIME = parseInt(process.env.ZENDESK_INCREMENTAL_START_TIME || '0', 10);
const CONCURRENCY = parseInt(process.env.ZENDESK_CONCURRENCY || '5', 10);

const BASE = `https://${SUBDOMAIN}.zendesk.com/api/v2`;
const AUTH = 'Basic ' + Buffer.from(`${EMAIL}/token:${TOKEN}`).toString('base64');

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[fatal] Falta variable de entorno requerida: ${name}`);
    console.error('Copia scripts/zendesk-backup/.env.example a .env y completa los valores.');
    process.exit(1);
  }
  return v;
}

// ---------- HTTP con rate-limit + retry ----------
async function api(pathOrUrl, opts = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Authorization': AUTH,
        'Accept': 'application/json',
        ...(opts.headers || {}),
      },
    });

    if (res.status === 429) {
      const retry = parseInt(res.headers.get('retry-after') || '60', 10);
      console.warn(`[rate-limit] esperando ${retry}s…`);
      await sleep(retry * 1000);
      continue;
    }
    if (res.status === 503 || res.status === 502 || res.status === 504) {
      if (attempt > 5) throw new Error(`${res.status} ${url}`);
      const wait = Math.min(60_000, 2000 * 2 ** attempt);
      console.warn(`[${res.status}] retry en ${wait}ms…`);
      await sleep(wait);
      continue;
    }
    if (res.status === 403 || res.status === 404) {
      // permitir al caller decidir
      return { ok: false, status: res.status, json: null, res };
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${url}\n${txt.slice(0, 500)}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return { ok: true, status: res.status, json: await res.json(), res };
    }
    return { ok: true, status: res.status, json: null, res };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- estado / progreso ----------
const STATE_FILE = join(BACKUP_DIR, '_state.json');
async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
async function saveState(state) {
  await mkdir(BACKUP_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------- paginación ----------
async function* paginate(initialPath, key) {
  let next = initialPath;
  while (next) {
    const { json } = await api(next);
    const items = json?.[key] || [];
    for (const item of items) yield item;
    next = json?.next_page || null;
  }
}

async function* paginateCursor(initialPath, key) {
  // cursor pagination (CBP) - moderna
  let next = initialPath;
  while (next) {
    const { json } = await api(next);
    const items = json?.[key] || [];
    for (const item of items) yield item;
    next = json?.links?.next || null;
    if (next && json?.meta?.has_more === false) next = null;
  }
}

// ---------- escritura JSONL ----------
async function appendJsonl(file, obj) {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(obj) + '\n');
}

async function writeJson(file, obj) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(obj, null, 2));
}

// ---------- adjuntos ----------
async function downloadAttachment(att, ticketId) {
  if (!att?.content_url) return;
  const dir = join(BACKUP_DIR, 'tickets', 'attachments', `ticket-${ticketId}`);
  await mkdir(dir, { recursive: true });
  const safeName = (att.file_name || `att-${att.id}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
  const dest = join(dir, `${att.id}-${safeName}`);
  try {
    const s = await stat(dest);
    if (s.size > 0 && (!att.size || s.size === att.size)) return; // ya descargado
  } catch {}
  const res = await fetch(att.content_url, { headers: { 'Authorization': AUTH } });
  if (!res.ok || !res.body) {
    console.warn(`[adj] fallo ${att.id} ticket ${ticketId}: ${res.status}`);
    return;
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

// ---------- pool de concurrencia simple ----------
async function pool(items, worker, concurrency) {
  const queue = items.slice();
  let active = 0;
  let done = 0;
  return new Promise((resolveAll, rejectAll) => {
    const next = () => {
      while (active < concurrency && queue.length) {
        const item = queue.shift();
        active++;
        Promise.resolve(worker(item))
          .catch((e) => console.warn('[pool] error:', e.message))
          .finally(() => {
            active--;
            done++;
            next();
            if (active === 0 && queue.length === 0) resolveAll(done);
          });
      }
      if (active === 0 && queue.length === 0) resolveAll(done);
    };
    next();
  });
}

// ---------- backup: TICKETS ----------
async function backupTickets(state) {
  console.log('\n=== TICKETS ===');
  const ticketsFile = join(BACKUP_DIR, 'tickets', 'tickets.jsonl');
  await mkdir(dirname(ticketsFile), { recursive: true });

  let cursor = state.tickets?.cursor || null;
  let startTime = state.tickets?.start_time ?? START_TIME;
  let count = state.tickets?.count || 0;

  while (true) {
    const path = cursor
      ? `/incremental/tickets/cursor.json?cursor=${encodeURIComponent(cursor)}&include=metric_sets,users,organizations,groups`
      : `/incremental/tickets/cursor.json?start_time=${startTime}&include=metric_sets,users,organizations,groups`;

    const { json } = await api(path);
    const tickets = json?.tickets || [];
    if (tickets.length === 0 && json?.end_of_stream) break;

    // bucket de adjuntos a bajar después en paralelo
    const attachmentJobs = [];

    for (const t of tickets) {
      await appendJsonl(ticketsFile, t);
      count++;

      // comentarios completos del ticket
      const comments = [];
      for await (const c of paginate(`/tickets/${t.id}/comments.json?include_inline_images=true`, 'comments')) {
        comments.push(c);
        if (DOWNLOAD_ATTACHMENTS && Array.isArray(c.attachments)) {
          for (const a of c.attachments) attachmentJobs.push({ a, ticketId: t.id });
        }
      }
      await writeJson(join(BACKUP_DIR, 'tickets', 'comments', `ticket-${t.id}.json`), comments);
    }

    if (DOWNLOAD_ATTACHMENTS && attachmentJobs.length) {
      await pool(attachmentJobs, ({ a, ticketId }) => downloadAttachment(a, ticketId), CONCURRENCY);
    }

    cursor = json?.after_cursor || null;
    state.tickets = { cursor, start_time: startTime, count };
    await saveState(state);
    console.log(`[tickets] ${count} acumulados…`);

    if (json?.end_of_stream || !cursor) break;
  }

  console.log(`[tickets] DONE — ${count} tickets`);
  return count;
}

// ---------- backup: USERS + ORGS ----------
async function backupUsersAndOrgs(state) {
  console.log('\n=== USERS ===');
  const usersFile = join(BACKUP_DIR, 'users', 'users.jsonl');
  await mkdir(dirname(usersFile), { recursive: true });
  let userCount = state.users?.count || 0;

  let cursor = state.users?.cursor || null;
  while (true) {
    const path = cursor
      ? `/incremental/users/cursor.json?cursor=${encodeURIComponent(cursor)}`
      : `/incremental/users/cursor.json?start_time=${state.users?.start_time ?? START_TIME}`;
    const { json } = await api(path);
    const users = json?.users || [];
    if (users.length === 0 && json?.end_of_stream) break;

    const identityJobs = [];
    for (const u of users) {
      await appendJsonl(usersFile, u);
      userCount++;
      identityJobs.push(u);
    }

    // identidades (emails secundarios, teléfonos, etc.)
    await pool(identityJobs, async (u) => {
      const { json: idJson, ok } = await api(`/users/${u.id}/identities.json`);
      if (ok && idJson?.identities) {
        await writeJson(join(BACKUP_DIR, 'users', 'identities', `user-${u.id}.json`), idJson.identities);
      }
    }, CONCURRENCY);

    cursor = json?.after_cursor || null;
    state.users = { cursor, start_time: START_TIME, count: userCount };
    await saveState(state);
    console.log(`[users] ${userCount} acumulados…`);
    if (json?.end_of_stream || !cursor) break;
  }
  console.log(`[users] DONE — ${userCount} usuarios`);

  console.log('\n=== ORGANIZATIONS ===');
  const orgsFile = join(BACKUP_DIR, 'organizations', 'organizations.jsonl');
  await mkdir(dirname(orgsFile), { recursive: true });
  let orgCount = 0;
  for await (const o of paginateCursor('/organizations.json?page[size]=100', 'organizations')) {
    await appendJsonl(orgsFile, o);
    orgCount++;
    if (orgCount % 200 === 0) console.log(`[orgs] ${orgCount}…`);
  }
  console.log(`[orgs] DONE — ${orgCount} organizaciones`);

  return { userCount, orgCount };
}

// ---------- backup: CONFIG ----------
async function backupConfig() {
  console.log('\n=== CONFIG ===');
  const configDir = join(BACKUP_DIR, 'config');
  await mkdir(configDir, { recursive: true });

  const endpoints = [
    ['macros',                '/macros.json?page[size]=100',                'macros'],
    ['triggers',              '/triggers.json?page[size]=100',              'triggers'],
    ['automations',           '/automations.json?page[size]=100',           'automations'],
    ['views',                 '/views.json?page[size]=100',                 'views'],
    ['sla_policies',          '/slas/policies.json',                        'sla_policies'],
    ['groups',                '/groups.json?page[size]=100',                'groups'],
    ['custom_roles',          '/custom_roles.json',                         'custom_roles'],
    ['ticket_fields',         '/ticket_fields.json',                        'ticket_fields'],
    ['ticket_forms',          '/ticket_forms.json',                         'ticket_forms'],
    ['organization_fields',   '/organization_fields.json',                  'organization_fields'],
    ['user_fields',           '/user_fields.json',                          'user_fields'],
    ['brands',                '/brands.json',                               'brands'],
    ['schedules',             '/business_hours/schedules.json',             'schedules'],
    ['tags',                  '/tags.json?page[size]=100',                  'tags'],
    ['dynamic_content',       '/dynamic_content/items.json?page[size]=100', 'items'],
    ['targets',               '/targets.json',                              'targets'],
    ['webhooks',              '/webhooks',                                  'webhooks'],
    ['apps_installations',    '/apps/installations.json',                   'installations'],
    ['account_settings',      '/account/settings.json',                     'settings'],
    ['locales',               '/locales.json',                              'locales'],
    ['support_addresses',     '/recipient_addresses.json',                  'recipient_addresses'],
  ];

  for (const [name, path, key] of endpoints) {
    try {
      const items = [];
      const usesCursor = path.includes('page[size]') || path === '/webhooks';
      const iter = usesCursor ? paginateCursor(path, key) : (async function* () {
        const { json, ok, status } = await api(path);
        if (!ok) {
          console.warn(`[config] ${name}: HTTP ${status} (saltado)`);
          return;
        }
        const data = json?.[key];
        if (Array.isArray(data)) for (const it of data) yield it;
        else if (data) yield data;
      })();
      for await (const it of iter) items.push(it);
      await writeJson(join(configDir, `${name}.json`), items);
      console.log(`[config] ${name}: ${items.length}`);
    } catch (e) {
      console.warn(`[config] ${name}: error — ${e.message}`);
    }
  }
}

// ---------- main ----------
async function main() {
  const mode = process.argv[2] || 'all';
  console.log(`Zendesk backup → ${BASE}`);
  console.log(`Output dir   → ${BACKUP_DIR}`);
  console.log(`Mode         → ${mode}\n`);

  await mkdir(BACKUP_DIR, { recursive: true });
  const state = await loadState();
  const meta = {
    started_at: new Date().toISOString(),
    subdomain: SUBDOMAIN,
    mode,
    download_attachments: DOWNLOAD_ATTACHMENTS,
  };

  if (mode === 'all' || mode === 'tickets') meta.tickets_count = await backupTickets(state);
  if (mode === 'all' || mode === 'users') {
    const r = await backupUsersAndOrgs(state);
    meta.users_count = r.userCount;
    meta.orgs_count = r.orgCount;
  }
  if (mode === 'all' || mode === 'config') await backupConfig();

  meta.finished_at = new Date().toISOString();
  await writeJson(join(BACKUP_DIR, '_meta.json'), meta);
  console.log('\n✓ Backup terminado. Meta en _meta.json');
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
