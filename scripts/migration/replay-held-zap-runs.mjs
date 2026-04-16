#!/usr/bin/env node
/**
 * Replay Zapier "held" (on-hold) runs against the new native webhooks.
 *
 * Context:
 *   After migrating the three Zaps to native Node handlers (see ZAPS/*),
 *   there is a Zapier task-history export containing every run from the
 *   legacy Zaps. We want to:
 *     1. Discard runs with status = "success"   (already executed by Zapier)
 *     2. Discard runs with status = "filtered"  (Zapier filter blocked them)
 *     3. Discard runs from Zaps that are NOT in our migration list
 *     4. Replay the remaining status = "held" runs against the native
 *        endpoints on Render, oldest-first (to avoid pisar newer data).
 *
 * Input:
 *   Default path  ~/Documents/codex/.tmp/zap-runs.json  (override with --file)
 *   Shape         { "<uuid>": <run>, "<uuid>": <run>, ... }
 *   Each run has: status, date, object_id (= Zap id), object_title, ...
 *
 * Zap mapping (object_id -> native endpoint path under /zaps/<path>):
 *   331401022  ->  update-comisiones
 *   350571847  ->  normaliza-rut-contacto
 *   351937456  ->  rut-normalizado-trato
 *
 * Modes:
 *   (default)            Print summary + first 20 preview lines.
 *   --inspect first      Dump the FULL JSON of the first held run, so we can
 *                        confirm trigger-payload shape before replaying.
 *   --inspect last       Same, for the most recent held run.
 *   --inspect <N>        0-based index into the sorted held-runs list.
 *   --dump-all <path>    Write the sorted held-runs array to <path> as JSON.
 *   --execute            Actually POST to the webhook endpoints.
 *
 * Common flags:
 *   --file <path>        Input JSON (default: ~/Documents/codex/.tmp/zap-runs.json)
 *   --host <url>         Webhook host (default: https://clinyco-ai.onrender.com)
 *   --secret <val>       Value for X-Zap-Secret header (optional; must match
 *                        ZAPS_WEBHOOK_SECRET on Render if that env var is set)
 *   --throttle <ms>      Delay between POSTs in execute mode (default: 250ms,
 *                        = 4 req/s, well under Zendesk Sell's 50 per 10s limit)
 *   --limit <n>          Only replay the first n held runs (useful for smoke test)
 *   --only <object_id>   Only process this single Zap id
 *   --log <path>         Append JSONL of each replay attempt to <path>
 *
 * Examples:
 *   # 1. See breakdown + preview
 *   node scripts/migration/replay-held-zap-runs.mjs
 *
 *   # 2. Inspect the first held run's full payload (so we can verify shape)
 *   node scripts/migration/replay-held-zap-runs.mjs --inspect first
 *
 *   # 3. Smoke test: replay just the 3 oldest, pointing at production
 *   node scripts/migration/replay-held-zap-runs.mjs --execute --limit 3 --secret "$ZAPS_WEBHOOK_SECRET"
 *
 *   # 4. Full replay with log
 *   node scripts/migration/replay-held-zap-runs.mjs --execute --secret "$ZAPS_WEBHOOK_SECRET" --log /tmp/replay.jsonl
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

// ---- Configuration -------------------------------------------------------

const ZAP_MAP = {
  "331401022": "update-comisiones",
  "350571847": "normaliza-rut-contacto",
  "351937456": "rut-normalizado-trato",
};

const DEFAULT_HOST = "https://clinyco-ai.onrender.com";
const DEFAULT_FILE = path.join(os.homedir(), "Documents", "codex", ".tmp", "zap-runs.json");
const DEFAULT_THROTTLE_MS = 250;

// ---- CLI parsing ---------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const has = (f) => args.includes(f);
  const take = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  return {
    file: take("--file") || DEFAULT_FILE,
    host: (take("--host") || DEFAULT_HOST).replace(/\/+$/, ""),
    secret: take("--secret") || process.env.ZAPS_WEBHOOK_SECRET || "",
    throttle: Number(take("--throttle") || DEFAULT_THROTTLE_MS),
    limit: take("--limit") ? Number(take("--limit")) : null,
    only: take("--only"),
    execute: has("--execute"),
    inspect: take("--inspect"),
    dumpAll: take("--dump-all"),
    log: take("--log"),
  };
}

// ---- Helpers -------------------------------------------------------------

/**
 * Un-flatten a `{ "a__b__c": v }` object into `{ a: { b: { c: v } } }`.
 * Handles the case where Zapier sometimes writes keys with trailing numeric
 * indices (e.g. `custom_fields__0__key`) — those are left as numeric child
 * keys since we don't know the array semantics for this export.
 */
function unflatten(flat, sep = "__") {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split(sep);
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}

/**
 * Try to reconstruct the trigger entity (the deal/contact) that Zendesk Sell
 * would have posted to the Zap trigger. Supports a handful of shapes that
 * Zapier has used in task-history exports over the years.
 */
function extractTriggerEntity(run) {
  // Shape A: explicit nested trigger payload.
  if (run?.trigger?.data?.current && typeof run.trigger.data.current === "object") {
    return { source: "trigger.data.current", body: { data: { current: run.trigger.data.current } } };
  }
  if (run?.trigger?.data && typeof run.trigger.data === "object") {
    return { source: "trigger.data", body: { data: run.trigger.data } };
  }

  // Shape B: steps array; first step is the trigger.
  if (Array.isArray(run?.steps) && run.steps.length) {
    const first = run.steps[0];
    const out = first?.output ?? first?.data ?? first?.output_data;
    if (out && typeof out === "object") {
      return { source: "steps[0].output", body: out };
    }
  }

  // Shape C: `input` object. Sometimes it's the raw entity, sometimes keyed
  //          by step id like { "12345": {...entity...} }.
  if (run?.input && typeof run.input === "object") {
    const numericKeys = Object.keys(run.input).filter((k) => /^\d+$/.test(k));
    if (numericKeys.length) {
      const triggerStepId = numericKeys.sort((a, b) => Number(a) - Number(b))[0];
      const payload = run.input[triggerStepId];
      if (payload && typeof payload === "object") {
        return { source: `input[${triggerStepId}]`, body: payload };
      }
    }
    return { source: "input", body: run.input };
  }

  // Shape D: flattened `input__<stepId>__*` / `output__<stepId>__*` keys at
  //          run top level. Pick the lowest step id present.
  const flatForStep = (prefix) => {
    const stepIds = new Set();
    for (const key of Object.keys(run)) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const stepId = rest.split("__")[0];
        if (/^\d+$/.test(stepId)) stepIds.add(stepId);
      }
    }
    if (!stepIds.size) return null;
    const triggerStepId = [...stepIds].sort((a, b) => Number(a) - Number(b))[0];
    const triggerPrefix = `${prefix}${triggerStepId}__`;
    const flat = {};
    for (const [key, value] of Object.entries(run)) {
      if (key.startsWith(triggerPrefix)) {
        flat[key.slice(triggerPrefix.length)] = value;
      }
    }
    return { stepId: triggerStepId, body: unflatten(flat) };
  };

  const outPick = flatForStep("output__");
  if (outPick) return { source: `output__${outPick.stepId}__*`, body: outPick.body };
  const inPick = flatForStep("input__");
  if (inPick) return { source: `input__${inPick.stepId}__*`, body: inPick.body };

  return null;
}

function summarize(runs, label) {
  const byStatus = {};
  const byZap = {};
  for (const r of runs) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byZap[r.object_id] = (byZap[r.object_id] || 0) + 1;
  }
  console.log(`\n${label}  (${runs.length} runs)`);
  console.log("  by status:", byStatus);
  const zapLines = Object.entries(byZap)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `    ${id} (${ZAP_MAP[id] || "other"}): ${n}`)
    .join("\n");
  console.log("  by zap:\n" + zapLines);
}

function appendLog(logPath, entry) {
  if (!logPath) return;
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
}

// ---- Main ----------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv);

  if (!fs.existsSync(opts.file)) {
    console.error(`[replay] input file not found: ${opts.file}`);
    console.error(`[replay] pass --file <path> to override`);
    process.exit(1);
  }

  console.log(`[replay] reading ${opts.file}`);
  const raw = fs.readFileSync(opts.file, "utf8");
  const data = JSON.parse(raw);
  const allRuns = Array.isArray(data) ? data : Object.values(data);
  console.log(`[replay] total runs: ${allRuns.length}`);

  summarize(allRuns, "ALL runs");

  // Filter: status=held AND object_id in our migration list.
  let held = allRuns.filter(
    (r) => r && r.status === "held" && ZAP_MAP[String(r.object_id)]
  );
  if (opts.only) {
    held = held.filter((r) => String(r.object_id) === String(opts.only));
  }

  // Sort oldest-first by `date`.
  held.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  summarize(held, "HELD & eligible for replay (oldest-first)");
  if (held.length) {
    console.log(`  date range: ${held[0].date}  ->  ${held[held.length - 1].date}`);
  }

  // ---- --dump-all ----
  if (opts.dumpAll) {
    fs.writeFileSync(opts.dumpAll, JSON.stringify(held, null, 2), "utf8");
    console.log(`[replay] wrote ${held.length} held runs to ${opts.dumpAll}`);
    return;
  }

  // ---- --inspect ----
  if (opts.inspect) {
    let idx = 0;
    if (opts.inspect === "first") idx = 0;
    else if (opts.inspect === "last") idx = held.length - 1;
    else if (/^\d+$/.test(opts.inspect)) idx = Number(opts.inspect);
    else {
      console.error(`[replay] --inspect must be "first", "last", or an index`);
      process.exit(1);
    }
    const run = held[idx];
    if (!run) {
      console.error(`[replay] no held run at index ${idx}`);
      process.exit(1);
    }
    console.log(`\n[replay] held[${idx}]  (zap=${run.object_id} ${ZAP_MAP[run.object_id]}, date=${run.date}):`);
    console.log(JSON.stringify(run, null, 2));
    const reco = extractTriggerEntity(run);
    console.log(`\n[replay] reconstructed trigger body (source=${reco?.source || "none"}):`);
    console.log(JSON.stringify(reco?.body ?? null, null, 2));
    return;
  }

  // ---- preview (default) ----
  const previewLimit = Math.min(opts.limit ?? 20, held.length);
  console.log(`\npreview (first ${previewLimit} held runs):`);
  for (let i = 0; i < previewLimit; i++) {
    const r = held[i];
    console.log(
      `  [${String(i).padStart(3)}] ${r.date}  zap=${r.object_id} ${ZAP_MAP[r.object_id].padEnd(28)}  title="${(r.object_title || "").slice(0, 40)}"`
    );
  }
  if (!opts.execute) {
    console.log(`\n[replay] dry-run. use --execute to POST to ${opts.host}/zaps/*`);
    if (!opts.secret) {
      console.log("[replay] no --secret set; if ZAPS_WEBHOOK_SECRET is configured on Render, you MUST pass one.");
    }
    return;
  }

  // ---- --execute ----
  if (!opts.secret) {
    console.log("\n[replay] WARNING: --execute with no --secret. If Render has ZAPS_WEBHOOK_SECRET set, every POST will 401.");
  }
  const batch = opts.limit != null ? held.slice(0, opts.limit) : held;
  console.log(`\n[replay] replaying ${batch.length} runs -> ${opts.host}/zaps/*  (throttle ${opts.throttle}ms)`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
    const endpoint = `${opts.host}/zaps/${ZAP_MAP[r.object_id]}`;
    const reco = extractTriggerEntity(r);
    if (!reco || !reco.body) {
      fail++;
      const line = `[${i + 1}/${batch.length}] SKIP ${endpoint}  (no trigger payload could be reconstructed for run ${r.id || "?"})`;
      console.error(line);
      appendLog(opts.log, { idx: i, run_id: r.id, date: r.date, object_id: r.object_id, endpoint, status: "no_payload" });
      continue;
    }
    const headers = { "Content-Type": "application/json" };
    if (opts.secret) headers["X-Zap-Secret"] = opts.secret;
    let status = 0;
    let bodyText = "";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(reco.body),
      });
      status = res.status;
      bodyText = await res.text();
      if (res.ok) ok++;
      else fail++;
    } catch (err) {
      fail++;
      bodyText = `fetch_error: ${err.message}`;
    }
    console.log(
      `[${i + 1}/${batch.length}] ${status || "ERR"} ${endpoint}  ${r.date}  src=${reco.source}  body=${bodyText.slice(0, 160).replace(/\s+/g, " ")}`
    );
    appendLog(opts.log, {
      idx: i,
      run_id: r.id,
      date: r.date,
      object_id: r.object_id,
      endpoint,
      source: reco.source,
      status,
      response: bodyText.slice(0, 2000),
    });
    if (i < batch.length - 1) await sleep(opts.throttle);
  }
  console.log(`\n[replay] done. ok=${ok}  fail=${fail}  total=${batch.length}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
