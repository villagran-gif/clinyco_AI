import { pool } from "./db.js";

// ══════════════════════════════════════════════════════════════
// sync-sell-deals.js
// Baja todos los deals y contactos de Zendesk Sell, normaliza teléfonos,
// y los puntea en sell_deals_cache para correlacionar con el Observer.
// ══════════════════════════════════════════════════════════════

const SELL_TOKEN =
  process.env.ZENDESK_SELL_API_TOKEN ||
  process.env.ZENDESK_API_TOKEN_SELL ||
  process.env.ZENDESK_API_TOKEN;
const SELL_BASE = "https://api.getbase.com/v2";
const PER_PAGE = 100;
const RATE_DELAY_MS = 120; // ~8 req/s — Sell permite 10 req/s

if (!SELL_TOKEN) {
  console.error("[sync-sell] ZENDESK_SELL_API_TOKEN requerido");
  process.exit(1);
}

// ── Outcome scoring (copia del db.js principal) ──
const OUTCOME_SCORES = {
  bariatrica: {
    "CERRADO OPERADO": 100, "CERRADO EN RECUPERACION": 90,
    "CERRADO AGENDADO": 80, "CERRADO PRESUPUESTO APROBADO": 70,
    "CERRADO EVALUADO": 60, "CERRADO PRESUPUESTADO": 50,
    "EXAMENES ENVIADOS": 40, "EN EVALUACION": 30,
    "CONTACTADO": 20, "CANDIDATOS": 10,
    "SIN RESPUESTA": 0, "SUSPENDIDO": 0, "DESCALIFICADO": 0,
  },
  balon: {
    "CERRADO INSTALADO": 100, "CERRADO AGENDADO": 80,
    "CERRADO PRESUPUESTO APROBADO": 70, "CERRADO EVALUADO": 60,
    "CERRADO PRESUPUESTADO": 50, "EXAMENES ENVIADOS": 40,
    "EN EVALUACION": 30, "CONTACTADO": 20, "CANDIDATOS": 10,
    "SIN RESPUESTA": 0, "SUSPENDIDO": 0, "DESCALIFICADO": 0,
  },
  plastica: {
    "CERRADO OPERADO": 100, "CERRADO AGENDADO": 80,
    "CERRADO PRESUPUESTO APROBADO": 70, "CERRADO EVALUADO": 60,
    "CERRADO PRESUPUESTADO": 50, "EXAMENES ENVIADOS": 40,
    "EN EVALUACION": 30, "CONTACTADO": 20, "CANDIDATO": 10,
    "SIN RESPUESTA": 0, "SUSPENDIDO": 0, "DESCALIFICADO": 0,
  },
  general: {
    "CERRADO OPERADO": 100, "CERRADO AGENDADO": 80,
    "CERRADO PRESUPUESTO APROBADO": 70, "CERRADO EVALUADO": 60,
    "CERRADO PRESUPUESTADO": 50, "EXAMENES ENVIADOS": 40,
    "EN EVALUACION": 30, "CONTACTADO": 20, "CANDIDATOS": 10,
    "SIN RESPUESTA": 0, "SUSPENDIDO": 0, "DESCALIFICADO": 0,
  },
};

function inferPipelineKey(pipelineName) {
  const p = String(pipelineName || "").toLowerCase();
  if (p.includes("bari") || p.includes("⚖")) return "bariatrica";
  if (p.includes("bal") || p.includes("🎈")) return "balon";
  if (p.includes("plast") || p.includes("💎")) return "plastica";
  return "general";
}

function getOutcomeScore(pipelineKey, phase) {
  const map = OUTCOME_SCORES[pipelineKey] || OUTCOME_SCORES.general;
  return map[String(phase || "").toUpperCase()] ?? null;
}

function stageCategory(stageName, outcomeScore) {
  const up = String(stageName || "").toUpperCase();
  if (up.startsWith("CERRADO") && outcomeScore != null && outcomeScore >= 50) return "won";
  if (["SIN RESPUESTA", "SUSPENDIDO", "DESCALIFICADO"].includes(up)) return "lost";
  return "open";
}

// ── Teléfono normalizer: deja solo dígitos, asegura prefijo 56 para chilenos ──
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return null;
  // Remove leading zeros
  digits = digits.replace(/^0+/, "");
  // Chilean numbers: 9 digits starting with 9 → prepend 56
  if (digits.length === 9 && digits.startsWith("9")) digits = "56" + digits;
  // Some landline: 8 digits → prepend 562
  if (digits.length === 8) digits = "562" + digits;
  return digits;
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function sellGet(path) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${SELL_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${SELL_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    if (res.status === 429) {
      const wait = 2000 * attempt;
      console.warn(`[sync-sell] 429 rate-limit — esperando ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sell API ${res.status} ${path}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
  throw new Error(`Sell API: retries exhausted for ${path}`);
}

async function fetchAllPaginated(pathBase) {
  const items = [];
  let page = 1;
  while (true) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const data = await sellGet(`${pathBase}${sep}page=${page}&per_page=${PER_PAGE}`);
    const batch = (data.items || []).map((it) => it.data);
    items.push(...batch);
    console.log(`[sync-sell] ${pathBase} page=${page} +${batch.length} (total ${items.length})`);
    if (batch.length < PER_PAGE) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }
  return items;
}

async function fetchStageMap() {
  const stages = await fetchAllPaginated("/stages");
  const map = new Map();
  for (const s of stages) map.set(s.id, s);
  return map;
}

async function fetchPipelineMap() {
  const pipelines = await fetchAllPaginated("/pipelines");
  const map = new Map();
  for (const p of pipelines) map.set(p.id, p);
  return map;
}

async function fetchUsersMap() {
  try {
    const users = await fetchAllPaginated("/users");
    const map = new Map();
    for (const u of users) map.set(u.id, u);
    return map;
  } catch (err) {
    console.warn(`[sync-sell] no pude leer /users: ${err.message}`);
    return new Map();
  }
}

async function fetchContactsByIds(ids) {
  const map = new Map();
  // batch de 100
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const data = await sellGet(`/contacts?ids=${chunk.join(",")}&per_page=100`);
    for (const item of data.items || []) {
      if (item.data) map.set(item.data.id, item.data);
    }
    console.log(`[sync-sell] contactos ${Math.min(i + 100, ids.length)}/${ids.length}`);
    await sleep(RATE_DELAY_MS);
  }
  return map;
}

async function main() {
  console.log("[sync-sell] Iniciando sync de Zendesk Sell...");

  console.log("[sync-sell] 1/5 — pipelines, stages, users");
  const [pipelineMap, stageMap, userMap] = await Promise.all([
    fetchPipelineMap(),
    fetchStageMap(),
    fetchUsersMap(),
  ]);
  console.log(`[sync-sell]   pipelines=${pipelineMap.size} stages=${stageMap.size} users=${userMap.size}`);

  console.log("[sync-sell] 2/5 — fetching all deals");
  const deals = await fetchAllPaginated("/deals");
  console.log(`[sync-sell]   deals=${deals.length}`);

  console.log("[sync-sell] 3/5 — fetching contacts");
  const contactIds = [...new Set(deals.map((d) => d.contact_id).filter(Boolean))];
  const contactMap = await fetchContactsByIds(contactIds);
  console.log(`[sync-sell]   contactos únicos=${contactIds.length} resueltos=${contactMap.size}`);

  // Print one deal sample so we can see the custom_fields shape
  if (deals.length) {
    const sample = deals.find((d) => d.custom_fields && Object.keys(d.custom_fields).length) || deals[0];
    console.log("[sync-sell] === sample deal shape ===");
    console.log(JSON.stringify({
      id: sample.id,
      name: sample.name,
      stage_id: sample.stage_id,
      pipeline_id: sample.pipeline_id,
      owner_id: sample.owner_id,
      custom_fields: sample.custom_fields,
      // primeras 3 keys del resto para ver estructura
      _keys: Object.keys(sample),
    }, null, 2));
    console.log("[sync-sell] === end sample ===");
  }

  console.log("[sync-sell] 4/5 — upsert a sell_deals_cache");
  let upserted = 0;
  let won = 0;
  for (const deal of deals) {
    const stage = stageMap.get(deal.stage_id);
    // Pipeline_id comes from the stage (unique per pipeline), not from the deal payload
    const pipelineId = stage?.pipeline_id ?? deal.pipeline_id ?? null;
    const pipeline = pipelineId ? pipelineMap.get(pipelineId) : null;
    const contact = contactMap.get(deal.contact_id);
    const owner = userMap.get(deal.owner_id);

    const stageName = stage?.name || "";
    const pipelineName = pipeline?.name || "";
    const pipelineKey = inferPipelineKey(pipelineName);
    const outcomeScore = getOutcomeScore(pipelineKey, stageName);
    const category = stageCategory(stageName, outcomeScore);
    const isClosedWon = category === "won";
    if (isClosedWon) won++;

    // Teléfonos: contacts tienen `phone`, `mobile` — probamos ambos
    const phoneRaw = contact?.mobile || contact?.phone || null;
    const phone = normalizePhone(phoneRaw);

    await pool.query(
      `INSERT INTO sell_deals_cache (
         deal_id, contact_id, contact_name, contact_phone, contact_phone_raw, contact_email,
         deal_name, stage_id, stage_name, stage_category, is_closed_won, outcome_score,
         pipeline_id, pipeline_name, pipeline_key, value, currency,
         owner_id, owner_name, created_at_sell, updated_at_sell, last_synced_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now()
       )
       ON CONFLICT (deal_id) DO UPDATE SET
         contact_id=EXCLUDED.contact_id,
         contact_name=EXCLUDED.contact_name,
         contact_phone=EXCLUDED.contact_phone,
         contact_phone_raw=EXCLUDED.contact_phone_raw,
         contact_email=EXCLUDED.contact_email,
         deal_name=EXCLUDED.deal_name,
         stage_id=EXCLUDED.stage_id,
         stage_name=EXCLUDED.stage_name,
         stage_category=EXCLUDED.stage_category,
         is_closed_won=EXCLUDED.is_closed_won,
         outcome_score=EXCLUDED.outcome_score,
         pipeline_id=EXCLUDED.pipeline_id,
         pipeline_name=EXCLUDED.pipeline_name,
         pipeline_key=EXCLUDED.pipeline_key,
         value=EXCLUDED.value,
         currency=EXCLUDED.currency,
         owner_id=EXCLUDED.owner_id,
         owner_name=EXCLUDED.owner_name,
         created_at_sell=EXCLUDED.created_at_sell,
         updated_at_sell=EXCLUDED.updated_at_sell,
         last_synced_at=now()`,
      [
        deal.id,
        deal.contact_id || null,
        contact?.name || null,
        phone,
        phoneRaw,
        contact?.email || null,
        deal.name || null,
        deal.stage_id || null,
        stageName,
        category,
        isClosedWon,
        outcomeScore,
        pipelineId,
        pipelineName,
        pipelineKey,
        deal.value == null ? null : Number(deal.value),
        deal.currency || null,
        deal.owner_id || null,
        owner?.name || null,
        deal.created_at || null,
        deal.updated_at || null,
      ]
    );
    upserted++;
    if (upserted % 100 === 0) console.log(`[sync-sell]   upserted ${upserted}/${deals.length}`);
  }

  console.log("[sync-sell] 5/5 — stats");
  const { rows } = await pool.query(`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE is_closed_won) AS won,
      count(*) FILTER (WHERE stage_category = 'lost') AS lost,
      count(*) FILTER (WHERE stage_category = 'open') AS open,
      count(DISTINCT contact_phone) FILTER (WHERE contact_phone IS NOT NULL) AS unique_phones
    FROM sell_deals_cache
  `);
  const s = rows[0];
  console.log(`[sync-sell] Listo: ${upserted} deals synced, ${won} won, ${s.lost} lost, ${s.open} open, ${s.unique_phones} phones únicos`);
  await pool.end();
}

main().catch((err) => {
  console.error("[sync-sell] Fatal:", err);
  process.exit(1);
});
