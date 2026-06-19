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
import { adaptCaptionForFonasapad } from "./caption-adapter.js";

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
      const images = (p.images ?? []).filter((i) => i?.url);
      if (!images.length) continue; // sin imágenes no podemos previsualizar ni publicar
      pool.push({
        sourceAccount: accountKey,
        sourceMediaId: p.id,
        sourcePermalink: p.permalink,
        sourceCaption: p.caption,
        sourceMediaType: p.mediaType,
        sourceImageUrl: images[0].url,        // backward compat (la primera)
        sourceImageUrls: images,              // todas, para carrusel completo
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
    // Antes de encolar, intentamos generar la versión @fonasapad del
    // caption. Si Anthropic falla o no está configurado, adaptedCaption
    // queda null y publishApproved cae al source_caption. No bloquea.
    const adaptedCaption = await adaptCaptionForFonasapad({
      sourceCaption: cand.sourceCaption,
      sourceAccount: cand.sourceAccount,
      sourceMediaType: cand.sourceMediaType,
    });
    const row = await enqueueCandidate({
      sourceAccount: cand.sourceAccount,
      sourceMediaId: cand.sourceMediaId,
      sourcePermalink: cand.sourcePermalink,
      sourceCaption: cand.sourceCaption,
      sourceMediaType: cand.sourceMediaType,
      sourceImageUrl: cand.sourceImageUrl,
      sourceImageUrls: cand.sourceImageUrls,
      sourceTimestamp: cand.sourceTimestamp,
      sourceEngagement: cand.sourceEngagement,
      adaptedCaption,
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
