// Structure only: no patient import, no connections to legacy CRM services.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getPool } from '../review/db.js';
export async function seedStructure(pool) {
  const catalog = JSON.parse(await readFile(new URL('../review/site/crm-structure.json', import.meta.url), 'utf8'));
  if (!pool) throw new Error('CRM database unavailable');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS crm_structure_versions (
      version integer PRIMARY KEY, catalog jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    // Immutable versions: reruns preserve any existing configuration.
    await client.query('INSERT INTO crm_structure_versions(version,catalog) VALUES ($1,$2::jsonb) ON CONFLICT(version) DO NOTHING',
      [catalog.version, JSON.stringify(catalog)]);
    await client.query('COMMIT');
    return catalog.version;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = getPool();
  try { console.log(`CRM structure version ${await seedStructure(pool)} ready`); }
  catch { console.error('Could not initialize CRM structure'); process.exitCode = 1; }
  finally { await pool?.end(); }
}
