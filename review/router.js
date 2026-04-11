/**
 * review/router.js — Express router for the Review Dashboard API.
 * Mount in server.js:  app.use("/api/review", reviewRouter);
 *
 * All endpoints are read-only. CORS enabled for Netlify frontend.
 */
import { Router } from "express";
import { PDFParse } from "pdf-parse";
import {
  eugeniaAccuracy,
  eugeniaTrends,
  eugeniaGoldSamples,
  eugeniaDirectives,
  eugeniaFeedback,
  eugeniaActions,
  whatsappSentiment,
  whatsappSentimentDetail,
  whatsappSignals,
  whatsappAgents,
  whatsappMetrics,
  zendeskSentiment,
  zendeskSignals,
  zendeskSentimentDetail,
  zendeskAgentEffectiveness,
  registeredAgents,
  dealsPerMonthPerAgent,
  dealsPerYearPerAgent,
  agentPhaseParticipation,
  chainEffectiveness,
  dealsForAgentDetail,
  auditLogRecent,
  deletionLogRecent,
  lastSyncStatus,
  goldPatterns,
  goldSignals,
  goldAntoniaStats,
  goldEmotionalJourney,
  dealsSummary,
  dealsPerAgent,
  dealsRaw,
  commissionsPerAgent,
  dashboardSummary,
  velocityPerAgent,
  marketingCosts,
  marketingCostsByMonth,
  upsertMarketingCost,
  deleteMarketingCost,
  dealsMonthlyForMarketing,
  getBusinessParams,
  updateBusinessParam,
  marketingKPIs,
  insertCompras,
  insertVentas,
  getCompras,
  getVentas,
  comprasResumen,
  comprasResumenPorTipo,
  ventasResumen,
  ventasResumenPorTipo,
  getApiConnections,
  insertBoletas,
  getBoletas,
  insertResumenCompras,
  insertResumenVentas,
  getResumenCompras,
  getResumenVentas,
  ventasResumenUnificado,
  ventasResumenPorTipoUnificado,
  verificacionSII,
  getOrFetchRate,
  getExchangeRates,
  insertMetaBilling,
  insertMetaBillingCLP,
  syncMetaBillingToMarketingCosts,
  getMetaBilling,
  metaBillingSummary,
  getPool,
} from "./db.js";

const router = Router();

// ── CORS (allow Netlify origin + localhost dev) ──
const ALLOWED_ORIGINS = (process.env.REVIEW_CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGINS.includes("*") ||
    (origin && origin.endsWith(".netlify.app"))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Helper: wrap async handler ──
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`[review] ${req.path}:`, err.message);
    res.status(500).json({ error: err.message });
  });

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD (consolidated)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/dashboard",
  wrap(async (_req, res) => {
    res.json(await dashboardSummary());
  })
);

// ═══════════════════════════════════════════════════════════════════
//  EUGENIA
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/eugenia/accuracy",
  wrap(async (_req, res) => {
    res.json(await eugeniaAccuracy());
  })
);

router.get(
  "/eugenia/trends",
  wrap(async (req, res) => {
    const weeks = Math.min(parseInt(req.query.weeks) || 12, 52);
    res.json(await eugeniaTrends(weeks));
  })
);

router.get(
  "/eugenia/gold-samples",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(await eugeniaGoldSamples(limit));
  })
);

router.get(
  "/eugenia/directives",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(await eugeniaDirectives(limit));
  })
);

router.get(
  "/eugenia/feedback",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(await eugeniaFeedback(limit));
  })
);

router.get(
  "/eugenia/actions",
  wrap(async (_req, res) => {
    res.json(await eugeniaActions());
  })
);

// ═══════════════════════════════════════════════════════════════════
//  WHATSAPP
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/whatsapp/sentiment",
  wrap(async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json(await whatsappSentiment(days));
  })
);

router.get(
  "/whatsapp/sentiment/:conversationId",
  wrap(async (req, res) => {
    const id = parseInt(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "invalid conversationId" });
    res.json(await whatsappSentimentDetail(id));
  })
);

router.get(
  "/whatsapp/signals",
  wrap(async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json(await whatsappSignals(days));
  })
);

router.get(
  "/whatsapp/agents",
  wrap(async (_req, res) => {
    res.json(await whatsappAgents());
  })
);

router.get(
  "/whatsapp/metrics/:conversationId",
  wrap(async (req, res) => {
    const id = parseInt(req.params.conversationId);
    if (!id) return res.status(400).json({ error: "invalid conversationId" });
    res.json(await whatsappMetrics(id));
  })
);

// ═══════════════════════════════════════════════════════════════════
//  ZENDESK (WhatsApp via Zendesk — agents by usuario)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/zendesk/sentiment",
  wrap(async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json(await zendeskSentiment(days));
  })
);

router.get(
  "/zendesk/sentiment/:conversationId",
  wrap(async (req, res) => {
    const id = req.params.conversationId;
    if (!id || id.length > 100) return res.status(400).json({ error: "invalid conversationId" });
    res.json(await zendeskSentimentDetail(id));
  })
);

router.get(
  "/zendesk/signals",
  wrap(async (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    res.json(await zendeskSignals(days));
  })
);

router.get(
  "/zendesk/agent-effectiveness",
  wrap(async (_req, res) => {
    res.json(await zendeskAgentEffectiveness());
  })
);

// ═══════════════════════════════════════════════════════════════════
//  DEALS (Zendesk Sell)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/deals/summary",
  wrap(async (_req, res) => {
    res.json(await dealsSummary());
  })
);

router.get(
  "/deals/agents",
  wrap(async (_req, res) => {
    res.json(await dealsPerAgent());
  })
);

router.get(
  "/deals/agent-detail/:firstName",
  wrap(async (req, res) => {
    const name = req.params.firstName;
    const year = req.query.year || null;
    if (!name) return res.status(400).json({ error: "missing firstName" });
    res.json(await dealsForAgentDetail(name, year));
  })
);

router.get(
  "/audit/changes",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json(await auditLogRecent(limit));
  })
);

router.get(
  "/audit/deletions",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(await deletionLogRecent(limit));
  })
);

router.get(
  "/sync/status",
  wrap(async (_req, res) => {
    res.json(await lastSyncStatus());
  })
);

// ═══════════════════════════════════════════════════════════════════
//  GOLD STANDARD ANALYSIS
// ═══════════════════════════════════════════════════════════════════

router.get("/gold/patterns", wrap(async (_req, res) => res.json(await goldPatterns())));
router.get("/gold/signals", wrap(async (_req, res) => res.json(await goldSignals())));
router.get("/gold/antonia", wrap(async (_req, res) => res.json(await goldAntoniaStats())));
router.get("/gold/journey", wrap(async (_req, res) => res.json(await goldEmotionalJourney())));

router.get(
  "/deals/raw",
  wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    res.json(await dealsRaw(limit));
  })
);

router.get(
  "/deals/commissions",
  wrap(async (req, res) => {
    const year = req.query.year ? parseInt(req.query.year) : null;
    res.json(await commissionsPerAgent(year));
  })
);

// ═══════════════════════════════════════════════════════════════════
//  AGENTS (from agent_registry)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/agents",
  wrap(async (_req, res) => {
    res.json(await registeredAgents());
  })
);

router.get(
  "/agents/monthly",
  wrap(async (_req, res) => {
    res.json(await dealsPerMonthPerAgent());
  })
);

router.get(
  "/agents/yearly",
  wrap(async (_req, res) => {
    res.json(await dealsPerYearPerAgent());
  })
);

router.get(
  "/agents/phases",
  wrap(async (req, res) => {
    const year = req.query.year || null;
    res.json(await agentPhaseParticipation(year));
  })
);

router.get(
  "/agents/chains",
  wrap(async (req, res) => {
    const year = req.query.year || null;
    res.json(await chainEffectiveness(year));
  })
);

router.get(
  "/agents/velocity",
  wrap(async (_req, res) => {
    res.json(await velocityPerAgent());
  })
);

// ═══════════ MARKETING / COSTS / KPIs ═══════════

router.get("/marketing/costs", wrap(async (req, res) => {
  res.json(await marketingCosts(req.query.year || null));
}));

router.get("/marketing/costs-by-month", wrap(async (req, res) => {
  res.json(await marketingCostsByMonth(req.query.year || null));
}));

router.post("/marketing/costs", wrap(async (req, res) => {
  const { month, source, description, amount_clp } = req.body;
  if (!month || !source || amount_clp == null)
    return res.status(400).json({ error: "month, source, amount_clp required" });
  res.json(await upsertMarketingCost({ month, source, description, amount_clp }));
}));

router.delete("/marketing/costs/:id", wrap(async (req, res) => {
  await deleteMarketingCost(req.params.id);
  res.json({ ok: true });
}));

router.get("/marketing/deals-monthly", wrap(async (req, res) => {
  res.json(await dealsMonthlyForMarketing(req.query.year || null));
}));

router.get("/marketing/kpis", wrap(async (req, res) => {
  const [kpis, params] = await Promise.all([
    marketingKPIs(req.query.year || null),
    getBusinessParams(),
  ]);
  const p = {};
  params.forEach(r => { p[r.key] = r.value; });
  const arpu = p.avg_revenue_per_patient || 2500000;
  const margin = (p.gross_margin_pct || 40) / 100;
  const churn = (p.monthly_churn_pct || 5) / 100;
  const ltv = churn > 0 ? Math.round(arpu * margin / churn) : 0;
  const paybackMonths = (avgCac) => avgCac > 0 && arpu * margin > 0 ? Math.round(avgCac / (arpu * margin) * 10) / 10 : null;
  const revGrowth = p.revenue_growth_pct || 0;
  const profitMargin = p.profit_margin_pct || 0;
  const ruleOf40 = revGrowth + profitMargin;
  res.json({ kpis, params: p, ltv, ruleOf40, revGrowth, profitMargin });
}));

router.get("/marketing/params", wrap(async (_req, res) => {
  res.json(await getBusinessParams());
}));

router.put("/marketing/params/:key", wrap(async (req, res) => {
  const { value } = req.body;
  if (value == null) return res.status(400).json({ error: "value required" });
  const result = await updateBusinessParam(req.params.key, value);
  if (!result) return res.status(404).json({ error: "param not found" });
  res.json(result);
}));

// ═══════════ SII COMPRAS / VENTAS (CSV) ═══════════

function parseCSVRows(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
  return { headers, rows };
}

function detectCSVType(headers) {
  const h = headers.map(x => x.toLowerCase());
  const hasTotal = h.some(x => x.includes('total documentos'));
  // Resumen files have "Total Documentos" column
  if (hasTotal && h.some(x => x.includes('iva recuperable') || x.includes('iva uso comun'))) return 'resumen_compras';
  if (hasTotal) return 'resumen_ventas';
  // Boletas have "Fecha Venc" but NOT "Tipo Venta"
  if ((h.some(x => x.includes('fecha venc')) || h.some(x => x.includes('indicador servicio'))) && !h.some(x => x.includes('tipo venta'))) return 'boletas';
  // Compras vs Ventas
  if (h.some(x => x.includes('tipo compra') || x.includes('rut proveedor') || x.includes('iva recuperable'))) return 'compras';
  if (h.some(x => x.includes('tipo venta') || x.includes('rut cliente'))) return 'ventas';
  return null;
}

const CSV_TYPE_LABELS = {
  compras: 'RCV_COMPRAS', ventas: 'RCV_VENTAS', boletas: 'RCV_VENTA_BOLETAS',
  resumen_compras: 'RCV_RESUMEN_COMPRA', resumen_ventas: 'RCV_RESUMEN_VENTA'
};

router.post("/sii/upload", wrap(async (req, res) => {
  const { csv, periodo } = req.body;
  if (!csv) return res.status(400).json({ error: "csv text required" });
  const { headers, rows } = parseCSVRows(csv);
  if (rows.length === 0) return res.status(400).json({ error: "CSV vacio o sin filas de datos" });
  const type = detectCSVType(headers);
  if (!type) return res.status(400).json({
    error: "No se pudo detectar formato CSV. Tipos soportados: RCV_COMPRAS, RCV_VENTAS, RCV_VENTA_BOLETAS, RCV_RESUMEN_COMPRA, RCV_RESUMEN_VENTA",
    headers
  });
  const batchId = `upload-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const per = periodo || new Date().toISOString().substring(0,7);
  let result;
  switch (type) {
    case 'compras': result = await insertCompras(rows, per, batchId); break;
    case 'ventas': result = await insertVentas(rows, per, batchId); break;
    case 'boletas': result = await insertBoletas(rows, per, batchId); break;
    case 'resumen_compras': result = await insertResumenCompras(rows, per, batchId); break;
    case 'resumen_ventas': result = await insertResumenVentas(rows, per, batchId); break;
  }
  res.json({ type, label: CSV_TYPE_LABELS[type], ...result, batchId, periodo: per });
}));

router.get("/sii/compras", wrap(async (req, res) => {
  const periodo = req.query.periodo || null;
  const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
  res.json(await getCompras(periodo, limit));
}));

router.get("/sii/ventas", wrap(async (req, res) => {
  const periodo = req.query.periodo || null;
  const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
  res.json(await getVentas(periodo, limit));
}));

router.get("/sii/compras-resumen", wrap(async (req, res) => {
  res.json(await comprasResumen(req.query.year || null));
}));

router.get("/sii/compras-por-tipo", wrap(async (req, res) => {
  res.json(await comprasResumenPorTipo(req.query.periodo || null));
}));

router.get("/sii/ventas-resumen", wrap(async (req, res) => {
  res.json(await ventasResumenUnificado(req.query.year || null));
}));

router.get("/sii/ventas-por-tipo", wrap(async (req, res) => {
  res.json(await ventasResumenPorTipoUnificado(req.query.periodo || null));
}));

router.get("/sii/boletas", wrap(async (req, res) => {
  const periodo = req.query.periodo || null;
  const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
  res.json(await getBoletas(periodo, limit));
}));

router.get("/sii/resumen-oficial-compras", wrap(async (req, res) => {
  res.json(await getResumenCompras(req.query.periodo || null));
}));

router.get("/sii/resumen-oficial-ventas", wrap(async (req, res) => {
  res.json(await getResumenVentas(req.query.periodo || null));
}));

router.get("/sii/verificacion", wrap(async (req, res) => {
  res.json(await verificacionSII(req.query.periodo || null));
}));

router.get("/api-connections", wrap(async (_req, res) => {
  res.json(await getApiConnections());
}));

// ═══════════ META ADS BILLING ═══════════

/**
 * Parse Meta Ads billing CSV (real format from business.facebook.com/billing).
 *
 * Structure:
 *   - Info header lines (Meta address, advertiser info, billing period)
 *   - Main transactions table (6 cols: Fecha, ID, Descripción, Método pago, Importe, Divisa)
 *   - Summary row ("Importe total facturado")
 *   - Credits section header + credit rows (4 cols: Fecha, ID, Importe, Divisa)
 *   - VAT info at bottom
 *
 * Amounts use Chilean/European format: period=thousands, comma=decimal (e.g. "1.071,00")
 * Tab-separated.
 */
function parseMetaCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 5) return { metadata: {}, transactions: [], debug: { lineCount: lines.length, firstLine: lines[0]?.substring(0,80) } };

  // Auto-detect separator: tab, semicolon, or comma
  const sample = lines.slice(0, 15).join('\n');
  const sep = sample.includes('\t') ? '\t' : sample.includes(';') ? ';' : ',';
  const metadata = {};
  const transactions = [];

  // Extract metadata from header lines
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const lower = lines[i].toLowerCase();
    // Billing period: "Informe de facturación: 29/1/2012 - 12/4/2026"
    if (lower.includes('informe') && lower.includes('factura')) {
      const m = lines[i].match(/:\s*(.+)/);
      if (m) metadata.billingPeriod = m[1].trim();
    }
    // Account info: "Cuenta: 353051184724413"
    if (lower.includes('cuenta:') || lower.includes('account:')) {
      const parts = lines[i].split(sep).map(c => c.trim());
      metadata.account = parts[0].replace(/^cuenta:\s*/i, '').trim();
      // Business name is in next field
      if (parts[1]) metadata.company = parts[1].replace(/^negocio:\s*/i, '').trim();
    }
    // VAT / RUT
    const vatMatch = lines[i].match(/VAT:\s*(\d+)/);
    if (vatMatch) metadata.rut = vatMatch[1];
  }

  // Parse all sections — find each header row and parse its data rows
  let i = 0;
  while (i < lines.length) {
    const lower = lines[i].toLowerCase();
    const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));

    // Normalize accented chars for matching
    const norm = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Detect main transaction header: has "Fecha" + "Importe" + at least "Descripci" or "Metodo" or "Transacci"
    if (norm.includes('fecha') && norm.includes('importe') &&
        (norm.includes('transacci') || norm.includes('descripci') || norm.includes('metodo'))) {
      const headers = cols.map(h => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
      const cFecha = headers.findIndex(h => h.includes('fecha'));
      const cId = headers.findIndex(h => h.includes('identificador') || h.includes('transacci'));
      const cDesc = headers.findIndex(h => h.includes('descripci'));
      const cPago = headers.findIndex(h => h.includes('metodo'));
      const cImporte = headers.findIndex(h => h.includes('importe'));
      const cDivisa = headers.findIndex(h => h.includes('divisa'));
      i++;

      // Read data rows until summary row or section break
      while (i < lines.length) {
        const row = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
        const rowLower = lines[i].toLowerCase();

        // Stop at total/summary rows or empty lines or section headers
        if (rowLower.includes('importe total') || rowLower.includes('total de fondos')
            || row.filter(c => c).length === 0) {
          break;
        }

        const fecha = parseMetaDate(row[cFecha >= 0 ? cFecha : 0]);
        if (!fecha) { i++; continue; }

        const amountUsd = parseMetaAmount(row[cImporte >= 0 ? cImporte : 4]);
        const description = cDesc >= 0 ? row[cDesc] : '';
        const descLower = description.toLowerCase();

        let tipo = 'charge';
        if (amountUsd < 0 || descLower.includes('reembolso') || descLower.includes('refund')
            || descLower.includes('cr\u00e9dito') || descLower.includes('credito')) {
          tipo = 'credit';
        }

        transactions.push({
          fecha,
          transaction_id: cId >= 0 ? row[cId] : '',
          description,
          payment_method: cPago >= 0 ? row[cPago] : '',
          amount_usd: amountUsd,
          currency: cDivisa >= 0 ? (row[cDivisa] || 'USD') : 'USD',
          tipo,
        });
        i++;
      }
      continue;
    }

    // Detect credits section header: "Fecha  Identificador de la transacción  Importe  Divisa" (4 cols, no Descripción)
    if (norm.includes('fecha') && norm.includes('importe') && !norm.includes('descripci') && !norm.includes('metodo')) {
      const headers = cols.map(h => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
      const cFecha = headers.findIndex(h => h.includes('fecha'));
      const cId = headers.findIndex(h => h.includes('identificador') || h.includes('transacci'));
      const cImporte = headers.findIndex(h => h.includes('importe'));
      const cDivisa = headers.findIndex(h => h.includes('divisa'));
      i++;

      while (i < lines.length) {
        const row = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
        const rowLower = lines[i].toLowerCase();

        if (rowLower.includes('importe total') || (!row[0] && !row[1]) || row.filter(c => c).length === 0) {
          break;
        }

        const fecha = parseMetaDate(row[cFecha >= 0 ? cFecha : 0]);
        if (!fecha) { i++; continue; }

        const amountUsd = parseMetaAmount(row[cImporte >= 0 ? cImporte : 2]);

        transactions.push({
          fecha,
          transaction_id: cId >= 0 ? row[cId] : '',
          description: 'Cr\u00e9dito publicitario',
          payment_method: 'Cr\u00e9dito',
          amount_usd: amountUsd,
          currency: cDivisa >= 0 ? (row[cDivisa] || 'USD') : 'USD',
          tipo: 'credit',
        });
        i++;
      }
      continue;
    }

    // Extract VAT info: "VAT Rate: 19%" and "VAT Amount: 7.754,78"
    if (lower.includes('vat amount')) {
      const m = lines[i].match(/vat amount[:\s]*([\d.,]+)/i);
      if (m) metadata.vatAmount = parseMetaAmount(m[1]);
    }
    if (lower.includes('vat rate')) {
      const m = lines[i].match(/vat rate[:\s]*([\d.,]+)/i);
      if (m) metadata.vatRate = parseMetaAmount(m[1]);
    }

    i++;
  }

  return { metadata, transactions };
}

/** Parse amount in Chilean/European format: "1.071,00" → 1071.00, "-40,90" → -40.90 */
function parseMetaAmount(s) {
  if (!s) return 0;
  let raw = String(s).trim().replace(/\u2212/g, '-').replace(/[$ ]/g, '');
  // Chilean/European: period=thousands, comma=decimal
  if (raw.includes(',')) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  }
  return parseFloat(raw) || 0;
}

/** Parse date from Meta CSV: "D/M/YYYY" → "YYYY-MM-DD" */
function parseMetaDate(s) {
  if (!s) return null;
  const cleaned = String(s).trim();
  if (!cleaned || cleaned === '0') return null;
  // ISO format (YYYY-MM-DD)
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  // DD/MM/YYYY or D/M/YYYY (most common in Meta Chile)
  const dmy = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  return null;
}

function detectMetaCSV(text) {
  const lower = text.toLowerCase();
  return (lower.includes('importe') || lower.includes('amount'))
    && (lower.includes('transacci') || lower.includes('transaction') || lower.includes('m\u00e9todo de pago') || lower.includes('metodo de pago') || lower.includes('anuncios de meta'));
}

router.post("/meta-ads/upload", wrap(async (req, res) => {
  const { csv, periodo: periodoOverride, manual_rate } = req.body;
  if (!csv) return res.status(400).json({ error: "csv text required" });

  if (!detectMetaCSV(csv)) {
    return res.status(400).json({ error: "No se reconoce como CSV de Meta Ads. Se esperan columnas: Fecha, Identificador de la transaccion, Importe." });
  }

  const { metadata, transactions, debug } = parseMetaCSV(csv);
  if (transactions.length === 0) {
    // Return debug info to help diagnose parsing issues
    const csvLines = csv.split(/\r?\n/).filter(l => l.trim());
    const sample = csvLines.slice(0, 10).map((l, idx) => `[${idx}] ${l.substring(0, 120)}`);
    return res.status(400).json({
      error: "CSV de Meta vacio o sin transacciones reconocidas",
      metadata, debug,
      lineCount: csvLines.length,
      sample,
      hasTabs: csv.includes('\t'),
      hasSemicolons: csv.includes(';'),
    });
  }

  // If manual_rate provided, override the exchange rate for all transactions
  if (manual_rate) {
    for (const tx of transactions) {
      tx._manualRate = parseFloat(manual_rate);
    }
  }

  // Derive periodo per transaction from its date (YYYY-MM)
  // This CSV can span multiple years — each row gets its own periodo
  for (const tx of transactions) {
    tx.periodo = periodoOverride || (tx.fecha ? tx.fecha.substring(0, 7) : new Date().toISOString().substring(0, 7));
  }

  const batchId = `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await insertMetaBilling(transactions, batchId, metadata.billingPeriod || '');

  // Auto-sync to marketing_costs for each affected periodo
  const periodos = [...new Set(transactions.map(t => t.periodo))];
  for (const p of periodos) {
    await syncMetaBillingToMarketingCosts(p);
  }

  // Compute summary for response
  const totalUsd = transactions.reduce((s, t) => s + t.amount_usd, 0);
  res.json({
    type: 'meta_ads_billing',
    label: 'Meta Ads Billing',
    ...result,
    batchId,
    periodos,
    totalUsd: Math.round(totalUsd * 100) / 100,
    transactionCount: transactions.length,
    metadata,
  });
}));

// ── Meta Ads PDF Upload (CLP billing) ──

/**
 * Parse Meta Ads billing PDF.
 * PDF text structure (extracted by pdf-parse):
 *   Lines with: DD/MM/YYYY  <transaction_id>  <payment_method>  $NNN.NNN CLP  <status>
 *   Summary: "Importe total facturado  $9.032.482 CLP"
 *   VAT: "VAT Amount: $793.071"
 */
function parseMetaPDFText(text) {
  const lines = text.split(/\n/);
  const metadata = { accounts: [] };
  const transactions = [];

  // Extract all account IDs ("Cuenta: XXXX")
  const accountIds = [];
  for (const line of lines) {
    const accMatch = line.match(/Cuenta[:\s]+(\d{5,})/i);
    if (accMatch && !accountIds.includes(accMatch[1])) accountIds.push(accMatch[1]);
    const bpMatch = line.match(/Informe de facturaci[oó]n[:\s]*([\d/]+ *- *[\d/]+)/i);
    if (bpMatch) metadata.billingPeriod = bpMatch[1].trim();
    const vatAmtMatch = line.match(/VAT Amount[:\s]*\$?([\d.,]+)/i);
    if (vatAmtMatch) metadata.vatAmount = parseMetaAmount(vatAmtMatch[1]);
    const vatRateMatch = line.match(/VAT Rate[:\s]*([\d.,]+)/i);
    if (vatRateMatch) metadata.vatRate = parseMetaAmount(vatRateMatch[1]);
  }
  metadata.accounts = accountIds;

  // Split PDF text into per-account sections so we can tag each transaction
  // Split on "Cuenta:" lines to get sections
  const sections = [];
  let currentAccountId = accountIds[0] || 'unknown';
  let currentSection = '';
  for (const line of lines) {
    const accMatch = line.match(/Cuenta[:\s]+(\d{5,})/i);
    if (accMatch) {
      if (currentSection.trim()) {
        sections.push({ accountId: currentAccountId, text: currentSection });
      }
      currentAccountId = accMatch[1];
      currentSection = '';
    }
    currentSection += line + '\n';
  }
  if (currentSection.trim()) {
    sections.push({ accountId: currentAccountId, text: currentSection });
  }

  // If no sections found, treat entire text as one section
  if (sections.length === 0) {
    sections.push({ accountId: 'unknown', text: text });
  }

  // Parse each section independently
  for (const section of sections) {
    const sectionFull = section.text.replace(/\n/g, ' ');

    // Detect "Crédito publicitario" sections — these are credits, not charges
    const isCreditSection = /M[eé]todo de pago[:\s]*Cr[eé]dito publicitario/i.test(sectionFull);

    // Match pattern: date + transaction_id + payment_method + amount CLP + status
    const txRegex = /(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d\w-]+(?:\s+[\d\w-]+)?)\s+((?:Visa|Mastercard|No disponible|Cr[eé]dito)[^\$]*?)\s+\$([\d.,]+)\s*CLP\s*(Pagado|Fondos\s+agregados?)?/gi;
    let match;
    while ((match = txRegex.exec(sectionFull)) !== null) {
      const fecha = parseMetaDate(match[1]);
      if (!fecha) continue;

      const rawAmount = match[4];
      const amountClp = parseInt(rawAmount.replace(/\./g, '').replace(/,/g, ''), 10) || 0;
      const status = (match[5] || '').trim().toLowerCase();
      const paymentMethod = match[3].trim();

      // Classify tipo
      let tipo = 'charge';
      if (/fondos\s+agregados?/i.test(status)) tipo = 'fondos';
      else if (isCreditSection) tipo = 'credit';

      transactions.push({
        fecha,
        transaction_id: match[2].trim(),
        description: isCreditSection ? 'Crédito publicitario' : 'Pago de Anuncios de Meta',
        payment_method: paymentMethod,
        amount_usd: 0,
        amount_clp_direct: amountClp,
        currency: 'CLP',
        tipo,
        account_id: section.accountId,
      });
    }

    // Line-by-line fallback for this section (if regex found nothing for it)
    const sectionTxCount = transactions.filter(t => t.account_id === section.accountId).length;
    if (sectionTxCount === 0) {
      const sectionLines = section.text.split(/\n/);
      let currentDate = null;
      for (const line of sectionLines) {
        const trimmed = line.trim();
        const dateMatch = trimmed.match(/^(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) {
          currentDate = parseMetaDate(dateMatch[1]);
        }
        const amountMatch = trimmed.match(/\$([\d.,]+)\s*CLP/);
        if (amountMatch && currentDate) {
          const amountClp = parseInt(amountMatch[1].replace(/\./g, '').replace(/,/g, ''), 10) || 0;
          if (amountClp > 0) {
            const idMatch = trimmed.match(/(\d{5,}[\d-]+\d{3,})/);
            const isFondos = /fondos\s+agregados?/i.test(trimmed);
            transactions.push({
              fecha: currentDate,
              transaction_id: idMatch ? idMatch[1] : '',
              description: isCreditSection ? 'Crédito publicitario' : 'Pago de Anuncios de Meta',
              payment_method: '',
              amount_usd: 0,
              amount_clp_direct: amountClp,
              currency: 'CLP',
              tipo: isFondos ? 'fondos' : (isCreditSection ? 'credit' : 'charge'),
              account_id: section.accountId,
            });
            currentDate = null;
          }
        }
      }
    }
  }

  // Post-process: mark "Fondos agregados" by checking the full text context
  // Some PDF extractions may have "Fondos agregados" on the same line as the amount
  const fullText = text.replace(/\n/g, ' ');
  for (const tx of transactions) {
    if (tx.tipo !== 'fondos') {
      // Check if this transaction's amount appears near "Fondos agregados" in the raw text
      const escapedId = tx.transaction_id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').substring(0, 20);
      if (escapedId) {
        const nearbyRegex = new RegExp(escapedId + '[^]*?Fondos\\s+agregados?', 'i');
        const nearby = fullText.match(nearbyRegex);
        if (nearby && nearby[0].length < 200) {
          tx.tipo = 'fondos';
          tx.description = 'Fondos agregados';
        }
      }
    }
  }

  return { metadata, transactions };
}

router.post("/meta-ads/upload-pdf", wrap(async (req, res) => {
  const { pdf } = req.body; // base64-encoded PDF
  if (!pdf) return res.status(400).json({ error: "pdf (base64) required" });

  let buffer;
  try {
    buffer = Buffer.from(pdf, 'base64');
  } catch (e) {
    return res.status(400).json({ error: "Invalid base64 PDF data" });
  }

  let pdfText;
  let pageCount;
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    pdfText = result.text;
    pageCount = result.total;
    parser.destroy();
  } catch (e) {
    return res.status(400).json({ error: "No se pudo leer el PDF: " + e.message });
  }

  const { metadata, transactions } = parseMetaPDFText(pdfText);
  if (transactions.length === 0) {
    const sampleLines = pdfText.split('\n').slice(0, 20).map((l, i) => `[${i}] ${l.substring(0, 100)}`);
    return res.status(400).json({
      error: "PDF de Meta no contiene transacciones reconocidas",
      metadata,
      pageCount,
      sampleLines,
    });
  }

  // Set periodo per transaction
  for (const tx of transactions) {
    tx.periodo = tx.fecha ? tx.fecha.substring(0, 7) : new Date().toISOString().substring(0, 7);
  }

  // Group transactions by account_id for per-account upsert
  const accountIds = [...new Set(transactions.map(t => t.account_id || 'unknown'))];
  const batchId = `meta-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await insertMetaBillingCLP(transactions, batchId, metadata.billingPeriod || '', accountIds);

  // Auto-sync to marketing_costs for ALL affected periodos
  const periodos = [...new Set(transactions.map(t => t.periodo))];
  for (const p of periodos) {
    await syncMetaBillingToMarketingCosts(p);
  }

  const charges = transactions.filter(t => t.tipo === 'charge');
  const fondos = transactions.filter(t => t.tipo === 'fondos');
  const credits = transactions.filter(t => t.tipo === 'credit');
  const totalClp = charges.reduce((s, t) => s + (t.amount_clp_direct || 0), 0);
  const totalFondos = fondos.reduce((s, t) => s + (t.amount_clp_direct || 0), 0);
  const totalCredits = credits.reduce((s, t) => s + (t.amount_clp_direct || 0), 0);
  res.json({
    type: 'meta_ads_billing_pdf',
    label: 'Meta Ads Billing (PDF CLP)',
    ...result,
    batchId,
    periodos,
    accountIds,
    totalClp,
    totalFondos,
    totalCredits,
    chargeCount: charges.length,
    fondosCount: fondos.length,
    creditCount: credits.length,
    transactionCount: transactions.length,
    metadata,
  });
}));

router.get("/meta-ads/billing", wrap(async (req, res) => {
  const periodo = req.query.periodo || null;
  const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
  res.json(await getMetaBilling(periodo, limit));
}));

router.get("/meta-ads/summary", wrap(async (req, res) => {
  res.json(await metaBillingSummary(req.query.year || null));
}));

router.get("/exchange-rates", wrap(async (req, res) => {
  res.json(await getExchangeRates(req.query.month || null));
}));

// Re-sync all Meta billing periodos to marketing_costs
router.post("/meta-ads/resync", wrap(async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT periodo FROM meta_ads_billing WHERE periodo IS NOT NULL ORDER BY periodo`
  );
  const results = [];
  for (const r of rows) {
    try {
      await syncMetaBillingToMarketingCosts(r.periodo);
      results.push({ periodo: r.periodo, status: 'ok' });
    } catch (e) {
      results.push({ periodo: r.periodo, status: 'error', error: e.message });
    }
  }
  res.json({ synced: results.length, results });
}));

export default router;
