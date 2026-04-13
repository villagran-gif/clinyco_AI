// Escanea la API de Sell y lista TODAS las keys únicas de custom_fields
// que aparecen en cualquier deal, con frecuencia de ocurrencia y un valor ejemplo.
// El objetivo: encontrar dónde viven los COLABORADOR 1/2/3 (o como se llamen realmente).

const SELL_TOKEN =
  process.env.ZENDESK_SELL_API_TOKEN ||
  process.env.ZENDESK_API_TOKEN_SELL ||
  process.env.ZENDESK_API_TOKEN;
const SELL_BASE = "https://api.getbase.com/v2";
const PER_PAGE = 100;
const RATE_DELAY_MS = 120;

if (!SELL_TOKEN) {
  console.error("ZENDESK_SELL_API_TOKEN requerido");
  process.exit(1);
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function sellGet(path) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${SELL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${SELL_TOKEN}`, "Content-Type": "application/json" },
    });
    if (res.status === 429) { await sleep(2000 * attempt); continue; }
    if (!res.ok) throw new Error(`Sell API ${res.status} ${path}`);
    return res.json();
  }
  throw new Error(`retries exhausted ${path}`);
}

async function main() {
  const keyStats = new Map(); // key → { count, nonNullCount, sampleValue, sampleDealId }

  let page = 1;
  let total = 0;
  while (true) {
    const data = await sellGet(`/deals?page=${page}&per_page=${PER_PAGE}`);
    const batch = (data.items || []).map((it) => it.data);
    if (!batch.length) break;
    for (const deal of batch) {
      const cf = deal.custom_fields || {};
      for (const [k, v] of Object.entries(cf)) {
        if (!keyStats.has(k)) keyStats.set(k, { count: 0, nonNullCount: 0, sampleValue: null, sampleDealId: null });
        const s = keyStats.get(k);
        s.count++;
        if (v !== null && v !== undefined && v !== "") {
          s.nonNullCount++;
          if (s.sampleValue == null) {
            s.sampleValue = v;
            s.sampleDealId = deal.id;
          }
        }
      }
    }
    total += batch.length;
    console.log(`page=${page} deals=${total} uniqueKeys=${keyStats.size}`);
    if (batch.length < PER_PAGE) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }

  console.log(`\n═══ ${keyStats.size} custom_field keys únicos en ${total} deals ═══\n`);
  const rows = [...keyStats.entries()].sort((a, b) => b[1].nonNullCount - a[1].nonNullCount);
  for (const [key, s] of rows) {
    const pct = ((s.nonNullCount / total) * 100).toFixed(1);
    const sample = s.sampleValue != null ? String(s.sampleValue).slice(0, 60) : "—";
    console.log(`  ${String(s.nonNullCount).padStart(5)}/${total} (${pct.padStart(5)}%)  "${key}"  → ejemplo: ${sample}  (deal ${s.sampleDealId ?? "—"})`);
  }

  // Resalta candidatos a colaborador
  console.log("\n═══ Candidatos a colaborador (fuzzy match) ═══");
  const candidates = rows.filter(([k]) => /colab|captad|cierre|seguim|ejecut|agent|comercial|vendedor/i.test(k));
  for (const [k, s] of candidates) {
    console.log(`  → "${k}"  nonNull=${s.nonNullCount}  ej: ${String(s.sampleValue).slice(0, 80)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
