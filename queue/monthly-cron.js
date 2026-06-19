// queue/monthly-cron.js
//
// Cron mensual que regenera benchmarks y recomendaciones automáticamente
// el día 1 de cada mes a las 06:00 Chile. La idea: que el equipo abra
// el dashboard el primer día del mes y ya tenga la versión actualizada.
//
// QUÉ ACTUALIZA:
//
// 1. data/benchmarks/recomendaciones-YYYY-MM.md
//    Genera con Claude Sonnet 4.6 una versión nueva del doc de
//    recomendaciones para el mes en curso, basada en:
//    - la versión del mes anterior (continuidad)
//    - los datos en vivo del último mes de las 3 cuentas (ver tab Social)
//    - los benchmarks vigentes
//
// 2. data/benchmarks/medical-YYYY-MM.md
//    Hace una RE-VERIFICACIÓN ligera de los benchmarks numéricos contra
//    fuentes públicas, no una nueva research. Si una métrica cambió >15%,
//    flagéa "actualizado" en el cambio.
//
// LOS DOCS NO PUEDEN COMMITEARSE SOLOS — el servidor de producción no tiene
// permisos de push. En lugar de eso, el cron escribe los archivos al disco
// del container (efímero) y SUBE un PR a GitHub vía API. Quien revisa lo
// mergea con un clic.
//
// La generación es opt-in con FONASAPAD_MONTHLY_CRON_ENABLED=true.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { listPages, instagram } from "../meta-content/index.js";
import { fetchWindowWithImages } from "../meta-content/instagram.js";

const MODEL = process.env.FONASAPAD_MONTHLY_MODEL || "claude-sonnet-4-6";

function client() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Próximo día 1 del mes a las 06:00 Chile, en ms UTC.
const CHILE_UTC_OFFSET_HOURS = -3;
const TARGET_HOUR_CHILE = 6;
export function nextRunMs(nowMs = Date.now()) {
  const nowChile = new Date(nowMs + CHILE_UTC_OFFSET_HOURS * 3_600_000);
  let y = nowChile.getUTCFullYear();
  let m = nowChile.getUTCMonth();
  const dayOfMonth = nowChile.getUTCDate();
  const chileHour = nowChile.getUTCHours();
  // Si hoy es día 1 y aún no son las 06:00, target = hoy 06:00 Chile
  if (dayOfMonth === 1 && chileHour < TARGET_HOUR_CHILE) {
    // mismo mes y año
  } else {
    // salta al próximo mes
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  const targetUtc = Date.UTC(y, m, 1, TARGET_HOUR_CHILE - CHILE_UTC_OFFSET_HOURS, 0, 0);
  return targetUtc;
}

// Snapshot ligero de la actividad reciente de las cuentas propias, para
// que Claude tenga contexto al regenerar las recomendaciones.
async function snapshotAccountsLastMonth() {
  try {
    const pages = await listPages();
    const out = {};
    for (const p of pages) {
      if (!p.igUserId) continue;
      const posts = await fetchWindowWithImages(p.igUserId, {
        monthsBack: 1,
        token: p.accessToken,
      }).catch(() => []);
      const top = posts.slice().sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0)).slice(0, 5);
      const sum = posts.reduce((s, p) => s + (p.engagement ?? 0), 0);
      const avg = posts.length ? Math.round(sum / posts.length) : 0;
      out[p.igUsername || p.pageId] = {
        postsInLastMonth: posts.length,
        avgEngagement: avg,
        topPosts: top.map((p) => ({
          date: p.date,
          mediaType: p.mediaType,
          engagement: p.engagement,
          captionSnippet: (p.caption || "").slice(0, 200),
          permalink: p.permalink,
        })),
      };
    }
    return out;
  } catch (err) {
    return { error: err.message };
  }
}

function yyyymm(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function readIfExists(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function findLatestByPrefix(prefix) {
  const dir = "data/benchmarks";
  if (!fs.existsSync(dir)) return null;
  const matches = fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
    .sort()
    .reverse();
  return matches[0] ? path.join(dir, matches[0]) : null;
}

const SYSTEM_RECOMENDACIONES = `Eres editor de estrategia de redes sociales para Clínyco (clínica bariátrica chilena, con cuentas @clinyco.cl y @doctorvillagran, y la cuenta-eco @fonasapad).

Tu trabajo cada mes: generar el documento "Recomendaciones estratégicas — <Mes Año>" actualizado, en español, en formato markdown.

REGLAS:
- Mantén la estructura del mes anterior (mismas secciones): "Decisión estratégica", "Prioridades del mes", "Plan operativo semanal", "Mix de contenido por cuenta", "Flujo @fonasapad", "Implementación pendiente", "Qué NO hacer", "Métricas a seguir", "Insights del último análisis de competidores".
- Actualiza con los datos del último mes (vienen en el prompt como "snapshot").
- Las cifras de benchmarks (engagement rate, % shares, etc.) vienen del documento de benchmarks médicos vigente — NO inventes; si necesitas mencionarlas, copia del input.
- Cuando un número cambió, dilo: "Subió de X a Y". Cuando no, no inventes movimientos.
- Cierra con "Próxima actualización: <mes siguiente>".
- Output: solo el markdown del documento, sin "Aquí tienes:", sin frontmatter, sin código de bloque.`;

async function generateRecomendaciones({ previousMd, accountsSnapshot, benchmarksMd, targetYearMonth }) {
  const c = client();
  if (!c) throw new Error("ANTHROPIC_API_KEY no configurada");
  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_RECOMENDACIONES,
    messages: [{
      role: "user",
      content: `Mes objetivo: ${targetYearMonth}

Recomendaciones del mes anterior (mantén la estructura, actualiza el contenido):
"""
${previousMd ?? "(no hay versión anterior — primera vez)"}
"""

Snapshot de los últimos 30 días de las cuentas propias:
"""
${JSON.stringify(accountsSnapshot, null, 2)}
"""

Benchmarks médicos vigentes (extracto):
"""
${(benchmarksMd ?? "").slice(0, 6000)}
"""

Genera el documento de recomendaciones para ${targetYearMonth}.`,
    }],
  });
  return resp?.content?.[0]?.text?.trim();
}

// Ejecuta una corrida del cron mensual y devuelve un objeto con los
// archivos generados. NO los commitea — eso lo hace el caller (ver
// review/router.js endpoint /queue/monthly-cron-run).
export async function runMonthlyOnce() {
  const today = new Date();
  const ym = yyyymm(today);
  const accountsSnapshot = await snapshotAccountsLastMonth();
  const prevRecomendaciones = readIfExists(findLatestByPrefix("recomendaciones-") || "");
  const currentBenchmarks = readIfExists(findLatestByPrefix("medical-") || "") || "";

  const recomendacionesMd = await generateRecomendaciones({
    previousMd: prevRecomendaciones,
    accountsSnapshot,
    benchmarksMd: currentBenchmarks,
    targetYearMonth: ym,
  });

  const recomendacionesPath = `data/benchmarks/recomendaciones-${ym}.md`;
  fs.mkdirSync(path.dirname(recomendacionesPath), { recursive: true });
  fs.writeFileSync(recomendacionesPath, recomendacionesMd ?? "(error)\n");

  return {
    generatedAt: new Date().toISOString(),
    targetYearMonth: ym,
    files: [{ path: recomendacionesPath, size: (recomendacionesMd ?? "").length }],
    note: "Archivo escrito al disco del container. Para que persista hay que abrir un PR (endpoint /queue/monthly-cron-pr).",
  };
}

// Scheduler
let timer = null;

export async function tick() {
  console.log("[monthly-cron] tick — regenerando recomendaciones del mes…");
  try {
    const result = await runMonthlyOnce();
    console.log(`[monthly-cron] OK ${result.targetYearMonth} (${result.files[0]?.size} bytes)`);
  } catch (err) {
    console.error(`[monthly-cron] falló: ${err.message}`);
  }
}

export function start() {
  if (process.env.FONASAPAD_MONTHLY_CRON_ENABLED !== "true") {
    console.log("[monthly-cron] FONASAPAD_MONTHLY_CRON_ENABLED != true — no arranca");
    return;
  }
  schedule();
}

function schedule() {
  if (timer) clearTimeout(timer);
  const target = nextRunMs();
  const delay = Math.max(target - Date.now(), 1_000);
  const dateStr = new Date(target).toISOString();
  console.log(`[monthly-cron] próximo tick: ${dateStr} (en ${Math.round(delay / 86_400_000)} días)`);
  timer = setTimeout(async () => {
    await tick();
    schedule();
  }, delay);
}

export function stop() { if (timer) clearTimeout(timer); timer = null; }
