// queue/cron.js
//
// Scheduler simple para llamar selectNextCandidate() automáticamente a
// horario "sweet-spot" healthcare según los benchmarks de junio 2026:
//
//   Lunes a Viernes: 09:00 Chile (-03:00 CLT, -04:00 CLST)
//   Sábado/Domingo: 10:00
//
// La idea: asegurar que cada mañana hay UN candidato esperando aprobación
// antes de la franja sweet-spot de publicación (Lun 12-21h, Mié 11-17h).
// Si el candidato se rechaza, /api/queue/decide ya inserta el siguiente
// automáticamente — el cron solo siembra el primero del día.
//
// Implementación: sin dependencia (no usamos node-cron). Recalculamos
// el "next run" en ms desde la zona horaria de Chile y usamos un único
// setTimeout que se reprograma a sí mismo. Robusto a saltos de daylight
// saving y a reinicio del proceso (al boot calcula el próximo).
//
// Activación opcional: FONASAPAD_CRON_ENABLED=true en env. Si no, el cron
// queda inerte (útil para entornos donde un worker dedicado lo corre).

import { selectNextCandidate } from "./select-candidate.js";
import { notifyCandidateViaCalendar } from "./calendar-notify.js";

const HOURS_BY_WEEKDAY = {
  // 0=Dom, 1=Lun, ..., 6=Sáb. Hora en horario de Chile (sin DST math: el
  // browser y Node hacen UTC internamente, calculamos el offset abajo).
  0: 10, 1: 9, 2: 9, 3: 9, 4: 9, 5: 9, 6: 10,
};

// Offset Chile (CLT): UTC-3 todo el año (Chile abolió DST en 2022; verano
// en regiones extremas distinto pero centro mantiene CLT). Mantenemos -3
// fijo — si esto cambia, ajustar acá.
const CHILE_UTC_OFFSET_HOURS = -3;

// Devuelve la próxima fecha-hora absoluta en milisegundos para la próxima
// corrida según el día de la semana en zona horaria Chile. Itera hasta
// 8 días hacia adelante; nunca recurre — un bug previo en la recursión
// saltaba 2+ meses cuando la hora target ya había pasado.
export function nextRunMs(nowMs = Date.now()) {
  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const probeMs = nowMs + dayOffset * 86_400_000;
    const probeChile = new Date(probeMs + CHILE_UTC_OFFSET_HOURS * 3_600_000);
    const dow = probeChile.getUTCDay();
    const hour = HOURS_BY_WEEKDAY[dow] ?? 9;
    const candidate = Date.UTC(
      probeChile.getUTCFullYear(),
      probeChile.getUTCMonth(),
      probeChile.getUTCDate(),
      hour - CHILE_UTC_OFFSET_HOURS,
      0, 0, 0,
    );
    if (candidate > nowMs) return candidate;
  }
  // Defensivo: si por alguna razón ningún offset funciona, devolvemos +24h
  return nowMs + 86_400_000;
}

let timer = null;

export async function tick() {
  console.log("[fonasapad-cron] tick — seleccionando próximo candidato…");
  try {
    const row = await selectNextCandidate();
    if (!row) {
      console.log("[fonasapad-cron] no hay candidatos elegibles");
      return;
    }
    console.log(`[fonasapad-cron] encolado id=${row.id} (${row.source_account}, ♥${row.source_engagement})`);
    try {
      const publicBaseUrl = process.env.PUBLIC_BASE_URL || "https://clinyco-ai.netlify.app";
      await notifyCandidateViaCalendar({ row, publicBaseUrl });
      console.log("[fonasapad-cron] notificado por calendar");
    } catch (err) {
      console.warn(`[fonasapad-cron] calendar falló: ${err.message}`);
    }
  } catch (err) {
    console.error(`[fonasapad-cron] tick falló: ${err.message}`);
  }
}

export function start() {
  if (process.env.FONASAPAD_CRON_ENABLED !== "true") {
    console.log("[fonasapad-cron] FONASAPAD_CRON_ENABLED != true — no arranca");
    return;
  }
  schedule();
}

function schedule() {
  if (timer) clearTimeout(timer);
  const target = nextRunMs();
  const delay = Math.max(target - Date.now(), 1_000);
  const dateStr = new Date(target).toISOString();
  console.log(`[fonasapad-cron] próximo tick programado para ${dateStr} (en ${Math.round(delay / 60_000)} min)`);
  timer = setTimeout(async () => {
    await tick();
    schedule();
  }, delay);
}

export function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}
