import {getPool} from '../review/db.js';
import {restoreSell2026} from '../review/sell-restore.js';

// Uses the application's authorized database connection. No public import endpoint.
const apply=process.argv.includes('--apply');
if (process.argv.slice(2).some(arg=>!['--apply','--dry-run'].includes(arg))) throw new Error('Use --dry-run or --apply');
const pool=getPool();
try { console.log(JSON.stringify(await restoreSell2026(pool,{apply}),null,2)); }
finally { await pool?.end(); }
