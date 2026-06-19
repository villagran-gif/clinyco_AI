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
import { graphPost } from "../meta-content/client.js";

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

export async function publishApproved(row) {
  const page = await findPage(FONASAPAD);
  if (!page) throw new Error("Página @fonasapad no descubierta vía /me/accounts");

  const caption = row.adapted_caption || row.source_caption || "";
  const urls = imageUrlsFrom(row);
  if (!urls.length) throw new Error("Sin imágenes para publicar");

  // ── Facebook ──
  let fbId = null;
  let fbError = null;
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

  // ── Instagram ──
  let igId = null;
  let igError = null;
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

  if (!fbId && !igId) {
    const combined = [fbError, igError].filter(Boolean).join(" | ");
    throw new Error(combined || "Ambas publicaciones fallaron");
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
