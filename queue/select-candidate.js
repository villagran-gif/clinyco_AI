// queue/select-candidate.js
//
// Worker: selecciona el MEJOR post histórico (últimos 6 meses) de
// @clinyco.cl + @doctorvillagran que no haya pasado todavía por la
// cola de @fonasapad, y lo encola.
//
// Política "mejores primero": ranking por engagement (likes + comments),
// luego por timestamp más reciente como desempate. Sin importar de cuál
// de las dos cuentas viene — Fonasapad se nutre de la suma.
//
// Salta posts cuya imagen no se puede traer (carruseles a veces tienen
// children sin media_url) y videos puros sin thumbnail.

import { findPage, instagram } from "../meta-content/index.js";
import { fetchWindowWithImages } from "../meta-content/instagram.js";
import { enqueueCandidate, listSeenSourceMediaIds } from "./queue-db.js";

const SOURCES = ["clinyco.cl", "doctorvillagran"];
const MONTHS_BACK = 6;

// Trae los posts elegibles de las 2 cuentas, descarta los ya vistos
// por la cola, ordena por engagement desc y devuelve la lista.
export async function listElegibles() {
  const seen = await listSeenSourceMediaIds();
  const pool = [];
  for (const accountKey of SOURCES) {
    const page = await findPage(accountKey);
    if (!page.igUserId) continue;
    const posts = await fetchWindowWithImages(page.igUserId, {
      monthsBack: MONTHS_BACK,
      token: page.accessToken,
    });
    for (const p of posts) {
      if (seen.has(p.id)) continue;
      const firstImage = p.images?.[0]?.url ?? null;
      if (!firstImage) continue; // sin imagen no podemos previsualizar
      pool.push({
        sourceAccount: accountKey,
        sourceMediaId: p.id,
        sourcePermalink: p.permalink,
        sourceCaption: p.caption,
        sourceMediaType: p.mediaType,
        sourceImageUrl: firstImage,
        sourceTimestamp: p.timestamp,
        sourceEngagement: p.engagement ?? 0,
        ig_user_id: page.igUserId,
        access_token: page.accessToken,
      });
    }
  }
  pool.sort((a, b) => {
    if (b.sourceEngagement !== a.sourceEngagement) {
      return b.sourceEngagement - a.sourceEngagement;
    }
    // Desempate por timestamp más reciente
    return (b.sourceTimestamp ?? "").localeCompare(a.sourceTimestamp ?? "");
  });
  return pool;
}

// Toma el mejor candidato no encolado todavía y lo inserta como pending.
// Devuelve la fila insertada, o null si no hay nada más que encolar.
export async function selectNextCandidate() {
  const elegibles = await listElegibles();
  for (const cand of elegibles) {
    const row = await enqueueCandidate({
      sourceAccount: cand.sourceAccount,
      sourceMediaId: cand.sourceMediaId,
      sourcePermalink: cand.sourcePermalink,
      sourceCaption: cand.sourceCaption,
      sourceMediaType: cand.sourceMediaType,
      sourceImageUrl: cand.sourceImageUrl,
      sourceTimestamp: cand.sourceTimestamp,
      sourceEngagement: cand.sourceEngagement,
    });
    if (row) return row;
  }
  return null;
}

// Cuántos posts elegibles quedan sin encolar — útil para el dashboard
// y para detectar cuando se agota el backfill histórico.
export async function countRemainingElegibles() {
  const elegibles = await listElegibles();
  return elegibles.length;
}
