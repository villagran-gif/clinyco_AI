#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS = JSON.parse(fs.readFileSync(path.join(__dirname, "runs-april17.json"), "utf8"));
const SECRET = process.env.ZAPS_WEBHOOK_SECRET || "";
const HOST = `http://localhost:${process.env.PORT || 10000}`;

async function go() {
  let ok = 0, fail = 0;
  for (let i = 0; i < RUNS.length; i++) {
    const [ep, id] = RUNS[i];
    try {
      const r = await fetch(`${HOST}/zaps/${ep}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Zap-Secret": SECRET },
        body: JSON.stringify({ id: Number(id), entity_original_id: Number(id) }),
      });
      const t = await r.text();
      if (r.ok) ok++; else fail++;
      console.log(`${i + 1}/${RUNS.length} ${r.status} ${ep} id=${id} ${t.slice(0, 120)}`);
    } catch (e) {
      fail++;
      console.log(`${i + 1}/${RUNS.length} ERR ${ep} id=${id} ${e.message}`);
    }
    if (i < RUNS.length - 1) await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`\nDONE ok=${ok} fail=${fail} total=${RUNS.length}`);
}

go();
