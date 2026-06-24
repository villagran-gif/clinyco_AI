// queue/publish-to-fonasapad.js
//
// Publica un candidato aprobado a las cuentas IG + FB de @fonasapad.
// Soporta multi-imagen (carruseles completos del post original):
//
//   IG con 1 imagen   → createMediaContainer(image_url) + publishContainer
//   IG con ≥2 imágenes → carrusel real:
//      por cada imagen: createMediaContainer({image_url, is_carousel_item:true})
//      luego:           createMediaContainer({media_type:"CAROUSEL",
//                                              children:[id1,id2,...], caption})
//      luego:           publishContainer(parentId)
//
//   FB con 1 imagen   → createPhotoPost (instantáneo, published:true)
//   FB con ≥2 imágenes → multi-photo post:
//      por cada imagen: POST /{page}/photos {url, published:false} → photo_id
//      luego:           POST /{page}/feed {message, attached_media:[ids]}
//
// La imagen viene de source_image_urls (array JSONB). Si por alguna razón
// la columna llega vacía, hace fallback a source_image_url (texto).

import { findPage, instagram, facebook } from "../meta-content/index.js";
import { graphPost, graphGet } from "../meta-content/client.js";

const FONASAPAD = "fonasapad";

// Helper: lee las URLs del row de la cola, devuelve siempre un array.
function imageUrlsFrom(row) {
  if (Array.isArray(row.source_image_urls) && row.source_image_urls.length) {
    return row.source_image_urls
      .map((i) => i?.url)
      .filter(Boolean);
  }
  if (row.source_image_url) return [row.source_image_url];
  return [];
}

// Refresca las URLs del media original llamando a Meta justo antes de
// publicar. Las URLs del CDN de Meta (cdninstagram.com / scontent.*)
// llevan un parámetro `oe=<hex>` que es timestamp UNIX de expiración —
// suelen durar 1-2 días. Si un row se encola hoy y se aprueba mañana
// las URLs viejas devuelven 404 y Meta rechaza con error 324 / 9004.
//
// La consulta usa el token de la PAGE SOURCE (@clinyco.cl o
// @doctorvillagran), no el de @fonasapad — sin eso no podemos leer el
// media original. Si el refresh falla por cualquier razón, hacemos
// fallback a las URLs guardadas (que pueden estar expiradas).
async function refreshSourceUrls(row) {
  const mediaId = row.source_media_id;
  const sourceAccount = row.source_account;
  if (!mediaId || !sourceAccount) return null;
  let sourcePage;
  try {
    sourcePage = await findPage(sourceAccount);
  } catch (err) {
    console.warn(`[publish-to-fonasapad] refresh: no se encontró page source ${sourceAccount}: ${err.message}`);
    return null;
  }
  if (!sourcePage?.accessToken) return null;
  try {
    const json = await graphGet(`/${mediaId}`, {
      params: {
        fields: "id,media_type,media_url,thumbnail_url,children{id,media_type,media_url,thumbnail_url}",
      },
      token: sourcePage.accessToken,
    });
    const fresh = [];
    if (json.children?.data?.length) {
      for (const child of json.children.data) {
        const url = child.media_url || child.thumbnail_url;
        if (url) fresh.push(url);
      }
    } else if (json.media_type === "VIDEO" && json.thumbnail_url) {
      fresh.push(json.thumbnail_url);
    } else if (json.media_url) {
      fresh.push(json.media_url);
    }
    return fresh.length ? fresh : null;
  } catch (err) {
    console.warn(`[publish-to-fonasapad] refresh URLs falló: ${err.message}`);
    return null;
  }
}

// publishApproved publica en IG + FB (o solo lo que se pida vía opts).
// Devuelve SIEMPRE el detalle: { fbId, igId, fbError, igError }. NO lanza
// excepción cuando una sola plataforma falla — eso es decisión del caller
// (processDecision distingue "publicado completo" vs "solo FB" vs "solo IG"
// vs "ambas fallaron" y marca el row con el publish_error correcto).
//
// opts.skipFb=true  →  no intenta FB (útil para retry-IG cuando FB ya está)
// opts.skipIg=true  →  no intenta IG (útil para retry-FB cuando IG ya está)
export async function publishApproved(row, opts = {}) {
  const page = await findPage(FONASAPAD);
  if (!page) throw new Error("Página @fonasapad no descubierta vía /me/accounts");

  const caption = row.adapted_caption || row.source_caption || "";
  let urls = imageUrlsFrom(row);
  if (!urls.length) throw new Error("Sin imágenes para publicar");

  // Refrescamos las URLs del CDN justo antes de publicar. Si el row se
  // encoló días atrás, las URLs guardadas ya pueden estar expiradas
  // (Meta CDN expira en 1-2 días). El refresh va al media original con
  // el token de la cuenta source y obtiene URLs nuevas.
  try {
    const fresh = await refreshSourceUrls(row);
    if (fresh && fresh.length) {
      urls = fresh;
    }
  } catch (err) {
    // No bloqueamos por esto: si refresh falla, intentamos con URLs viejas.
    console.warn(`[publish-to-fonasapad] usando URLs guardadas tras fallo de refresh: ${err.message}`);
  }
  // Defensa: refresh raro pero posible — vuelve a chequear que tenemos algo.
  if (!urls.length) throw new Error("Sin imágenes válidas después del refresh");

  // ── Facebook ──
  let fbId = null;
  let fbError = null;
  if (!opts.skipFb) {
    try {
      if (page.pageId) {
        fbId = await publishFb({
          pageId: page.pageId,
          token: page.accessToken,
          caption,
          urls,
        });
      }
    } catch (err) { fbError = err.message; }
  }

  // ── Instagram ──
  let igId = null;
  let igError = null;
  if (!opts.skipIg) {
    try {
      if (page.igUserId) {
        igId = await publishIg({
          igUserId: page.igUserId,
          token: page.accessToken,
          caption,
          urls,
        });
      }
    } catch (err) { igError = err.message; }
  }

  return { fbId, igId, fbError, igError };
}

// ── IG: single o carrusel real ──
async function publishIg({ igUserId, token, caption, urls }) {
  if (urls.length === 1) {
    const container = await instagram.createMediaContainer(igUserId, {
      imageUrl: urls[0],
      caption,
      token,
    });
    if (!container?.id) throw new Error("IG createMediaContainer no devolvió id");
    const pub = await instagram.publishContainer(igUserId, container.id, { token });
    return pub?.id ?? container.id;
  }
  // Carrusel: 1 container por imagen + 1 container padre con children.
  const childIds = [];
  for (const url of urls) {
    const child = await instagram.createMediaContainer(igUserId, {
      imageUrl: url,
      isCarouselItem: true,
      token,
    });
    if (!child?.id) throw new Error("IG createMediaContainer (child) sin id");
    childIds.push(child.id);
  }
  const parent = await instagram.createMediaContainer(igUserId, {
    mediaType: "CAROUSEL",
    children: childIds,
    caption,
    token,
  });
  if (!parent?.id) throw new Error("IG createMediaContainer (carousel) sin id");
  // IG necesita unos segundos para procesar el container; reintentamos publish
  // con backoff si falla la primera vez con status "IN_PROGRESS".
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const pub = await instagram.publishContainer(igUserId, parent.id, { token });
      return pub?.id ?? parent.id;
    } catch (err) {
      lastError = err;
      const msg = String(err.message || "");
      if (!/IN_PROGRESS|not ready|processing/i.test(msg)) break;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastError;
}

// ── FB: single o multi-foto ──
async function publishFb({ pageId, token, caption, urls }) {
  if (urls.length === 1) {
    const r = await facebook.createPhotoPost(pageId, {
      imageUrl: urls[0],
      caption,
      publish: true,
      token,
    });
    return r?.id ?? r?.post_id ?? null;
  }
  // Multi-foto en Facebook: subimos cada foto como "unpublished" para
  // obtener su photo_id, después hacemos un post /feed con attached_media.
  const photoIds = [];
  for (const url of urls) {
    const r = await graphPost(`/${pageId}/photos`, {
      params: { url, published: "false" },
      token,
    });
    if (!r?.id) throw new Error("FB /photos no devolvió id de foto");
    photoIds.push(r.id);
  }
  const attached = photoIds.map((id) => ({ media_fbid: id }));
  const post = await graphPost(`/${pageId}/feed`, {
    params: {
      message: caption,
      attached_media: JSON.stringify(attached),
      published: "true",
    },
    token,
  });
  return post?.id ?? post?.post_id ?? null;
}
