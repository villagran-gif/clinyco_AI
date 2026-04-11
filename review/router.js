/**
 * review/router.js — Express router for the Review Dashboard API.
 * Mount in server.js:  app.use("/api/review", reviewRouter);
 *
 * All endpoints are read-only. CORS enabled for Netlify frontend.
 */
import { Router } from "express";
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
  syncMetaBillingToMarketingCosts,
  getMetaBilling,
  metaBillingSummary,
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
 * Parse Meta Ads billing CSV.
 * Meta CSVs have informational header lines before the transaction table.
 * We detect the header row by looking for "Fecha" + ("Importe" or "Amount").
 */
function parseMetaCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 3) return { metadata: {}, transactions: [] };

  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const metadata = {};
  let headerIdx = -1;

  // Find the transaction header row and extract metadata from preceding lines
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const lower = lines[i].toLowerCase().replace(/"/g, '');
    if ((lower.includes('fecha') && (lower.includes('importe') || lower.includes('amount') || lower.includes('transacci')))
        || (lower.includes('date') && lower.includes('transaction'))) {
      headerIdx = i;
      break;
    }
    // Extract metadata from header lines
    const parts = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    if (parts.length >= 2) {
      const key = parts[0].toLowerCase();
      if (key.includes('periodo') || key.includes('billing')) metadata.billingPeriod = parts[1];
      if (key.includes('empresa') || key.includes('company') || key.includes('nombre')) metadata.company = parts[1];
      if (key.includes('cuenta') || key.includes('account')) metadata.account = parts[1];
      if (key.includes('moneda') || key.includes('currency')) metadata.currency = parts[1];
    }
  }

  if (headerIdx < 0) return { metadata, transactions: [] };

  const headers = lines[headerIdx].split(sep).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  // Find column indices by matching common Meta header patterns
  const colIdx = {
    fecha: headers.findIndex(h => h.includes('fecha') || h === 'date'),
    transactionId: headers.findIndex(h => h.includes('transacci') || h.includes('transaction id')),
    description: headers.findIndex(h => h.includes('descripci') || h.includes('description')),
    paymentMethod: headers.findIndex(h => h.includes('metodo') || h.includes('payment') || h.includes('m\u00e9todo')),
    amount: headers.findIndex(h => h.includes('importe') || h.includes('amount')),
    currency: headers.findIndex(h => h.includes('divisa') || h.includes('currency')),
  };

  const transactions = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 3 || !cols[colIdx.fecha >= 0 ? colIdx.fecha : 0]) continue;

    const rawDate = colIdx.fecha >= 0 ? cols[colIdx.fecha] : '';
    const fecha = parseMetaDate(rawDate);
    if (!fecha) continue;

    // Parse amount — handle unicode minus (−), commas as decimal sep, etc.
    let rawAmount = colIdx.amount >= 0 ? cols[colIdx.amount] : '0';
    rawAmount = rawAmount.replace(/\u2212/g, '-').replace(/[$ ]/g, '');
    // If uses comma as decimal separator (e.g. "1.234,56")
    if (rawAmount.includes(',') && rawAmount.indexOf(',') > rawAmount.lastIndexOf('.')) {
      rawAmount = rawAmount.replace(/\./g, '').replace(',', '.');
    }
    const amountUsd = parseFloat(rawAmount) || 0;

    const description = colIdx.description >= 0 ? cols[colIdx.description] : '';
    const descLower = description.toLowerCase();

    // Classify transaction tipo
    let tipo = 'charge';
    if (amountUsd < 0 || descLower.includes('cr\u00e9dito') || descLower.includes('credito') || descLower.includes('credit') || descLower.includes('reembolso') || descLower.includes('refund')) {
      tipo = 'credit';
    } else if (descLower.includes('iva') || descLower.includes('impuesto') || descLower.includes('tax') || descLower.includes('vat')) {
      tipo = 'tax';
    }

    transactions.push({
      fecha,
      transaction_id: colIdx.transactionId >= 0 ? cols[colIdx.transactionId] : '',
      description,
      payment_method: colIdx.paymentMethod >= 0 ? cols[colIdx.paymentMethod] : '',
      amount_usd: amountUsd,
      currency: colIdx.currency >= 0 ? cols[colIdx.currency] : metadata.currency || 'USD',
      tipo,
    });
  }

  return { metadata, transactions };
}

/** Parse date from Meta CSV: handles "DD/MM/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "ene 5, 2026", etc. */
function parseMetaDate(s) {
  if (!s) return null;
  const cleaned = String(s).trim();
  // ISO format
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // MM/DD/YYYY (US format — Meta sometimes uses this)
  const mdy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const m = parseInt(mdy[1]), d = parseInt(mdy[2]);
    // Heuristic: if first number > 12, it's DD/MM/YYYY (already handled above)
    if (m <= 12) return `${mdy[3]}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  // "mes DD, YYYY" or "DD mes YYYY" (Spanish month names)
  const MESES = {ene:'01',feb:'02',mar:'03',abr:'04',may:'05',jun:'06',jul:'07',ago:'08',sep:'09',oct:'10',nov:'11',dic:'12',
                  jan:'01',apr:'04',aug:'08',dec:'12'};
  const spMonth = cleaned.match(/(\w{3})\w*\s+(\d{1,2}),?\s+(\d{4})/i);
  if (spMonth) {
    const mm = MESES[spMonth[1].toLowerCase().substring(0,3)];
    if (mm) return `${spMonth[3]}-${mm}-${spMonth[2].padStart(2,'0')}`;
  }
  const spDay = cleaned.match(/(\d{1,2})\s+de?\s*(\w{3})\w*\s+(\d{4})/i);
  if (spDay) {
    const mm = MESES[spDay[2].toLowerCase().substring(0,3)];
    if (mm) return `${spDay[3]}-${mm}-${spDay[1].padStart(2,'0')}`;
  }
  return null;
}

function detectMetaCSV(text) {
  const lower = text.toLowerCase();
  return (lower.includes('importe') || lower.includes('amount'))
    && (lower.includes('transacci') || lower.includes('transaction') || lower.includes('m\u00e9todo de pago') || lower.includes('metodo de pago'));
}

router.post("/meta-ads/upload", wrap(async (req, res) => {
  const { csv, periodo: periodoOverride, manual_rate } = req.body;
  if (!csv) return res.status(400).json({ error: "csv text required" });

  if (!detectMetaCSV(csv)) {
    return res.status(400).json({ error: "No se reconoce como CSV de Meta Ads. Se esperan columnas: Fecha, ID de transaccion, Importe (USD)." });
  }

  const { metadata, transactions } = parseMetaCSV(csv);
  if (transactions.length === 0) {
    return res.status(400).json({ error: "CSV de Meta vacio o sin transacciones reconocidas", metadata });
  }

  // Derive periodo from first transaction date or use override
  const firstDate = transactions[0]?.fecha;
  const periodo = periodoOverride || (firstDate ? firstDate.substring(0, 7) : new Date().toISOString().substring(0, 7));

  // If manual_rate provided, override the exchange rate for all transactions
  if (manual_rate) {
    for (const tx of transactions) {
      tx._manualRate = parseFloat(manual_rate);
    }
  }

  const batchId = `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await insertMetaBilling(transactions, periodo, batchId, metadata.billingPeriod || '');

  // Auto-sync to marketing_costs
  await syncMetaBillingToMarketingCosts(periodo);

  // Compute summary for response
  const totalUsd = transactions.reduce((s, t) => s + t.amount_usd, 0);
  res.json({
    type: 'meta_ads_billing',
    label: 'Meta Ads Billing',
    ...result,
    batchId,
    periodo,
    totalUsd: Math.round(totalUsd * 100) / 100,
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

export default router;
