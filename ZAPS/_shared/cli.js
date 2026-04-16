/**
 * Shared CLI harness for Zap runners.
 *
 * Parses a common set of flags and dispatches to a provided handler function.
 * Keeps each Zap's run.js down to a few lines.
 *
 * Flags:
 *   --file <path>   Read trigger payload from a JSON file on disk.
 *   --id <number>   Fetch the entity from Zendesk Sell first, then pass it to the handler.
 *   --dry-run       Skip all network writes; handler logs planned actions.
 */

import fs from "node:fs";

// dotenv is optional — load .env if the package is installed, otherwise rely on
// env vars from the shell / process manager (pm2, Render, systemd, etc).
try {
  await import("dotenv/config");
} catch {
  /* no .env loader available; continue with process.env as-is */
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const has = (flag) => args.includes(flag);
  const take = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };
  return {
    file: take("--file"),
    id: take("--id"),
    dryRun: has("--dry-run")
  };
}

/**
 * @param {object} cfg
 * @param {string} cfg.name                        - Zap name for logging + errors.
 * @param {(id:string|number) => Promise<object>} cfg.fetchById
 *        Function that loads the trigger entity from Sell given an id.
 *        (Typically sell.getDeal / sell.getContact.)
 * @param {(payload:object, opts:object) => Promise<object>} cfg.handler
 *        The Zap's handler function.
 */
export async function runZapCli({ name, fetchById, handler }) {
  const { file, id, dryRun } = parseArgs(process.argv);

  let payload;
  if (file) {
    payload = JSON.parse(fs.readFileSync(file, "utf8"));
  } else if (id) {
    if (typeof fetchById !== "function") {
      throw new Error(`[${name}] --id requires a fetchById function to be wired up`);
    }
    payload = await fetchById(id);
  } else {
    console.error(
      `Usage: node <run.js> (--file <payload.json> | --id <entity_id>) [--dry-run]`
    );
    process.exit(1);
  }

  try {
    const result = await handler(payload, { dryRun });
    console.log(`[${name}] OK`, JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`[${name}] FAILED:`, err.stack || err.message);
    process.exit(1);
  }
}
