// queue/publish-to-fonasapad.js
//
// Publica un candidato aprobado a las cuentas IG + FB de @fonasapad
// usando los helpers existentes de meta-content/.
//
// IG: dos pasos (createMediaContainer → publishContainer) porque IG no
// tiene "drafts" reales; el container vive ~24h sin publicar y luego
// expira. Aquí publicamos al toque tras la aprobación.
//
// FB: createPost con publish=true (no draft) — la decisión humana ya
// se tomó en el panel.
//
// La imagen viene de source_image_url (cdn de IG/Meta, pública). Meta
// requiere que image_url sea accesible públicamente; las URLs del CDN
// de IG cumplen.

import { findPage, instagram, facebook } from "../meta-content/index.js";

const FONASAPAD = "fonasapad";

export async function publishApproved(row) {
  const page = await findPage(FONASAPAD);
  if (!page) throw new Error("Página @fonasapad no descubierta vía /me/accounts");

  const caption = row.adapted_caption || row.source_caption || "";
  const imageUrl = row.source_image_url;

  // 1) Facebook Page post — un solo paso, devuelve { id }
  let fbId = null;
  let fbError = null;
  try {
    if (page.pageId) {
      const fbResp = await facebook.createPhotoPost(page.pageId, {
        imageUrl,
        caption,
        publish: true,
        token: page.accessToken,
      });
      fbId = fbResp?.id ?? fbResp?.post_id ?? null;
    }
  } catch (err) {
    fbError = err.message;
  }

  // 2) Instagram — dos pasos
  let igId = null;
  let igError = null;
  try {
    if (page.igUserId) {
      const container = await instagram.createMediaContainer(page.igUserId, {
        imageUrl,
        caption,
        token: page.accessToken,
      });
      const containerId = container?.id;
      if (!containerId) throw new Error("createMediaContainer no devolvió id");
      const published = await instagram.publishContainer(page.igUserId, containerId, {
        token: page.accessToken,
      });
      igId = published?.id ?? containerId;
    }
  } catch (err) {
    igError = err.message;
  }

  // Si ambos fallaron, propagamos el error para que la cola lo registre
  if (!fbId && !igId) {
    const combined = [fbError, igError].filter(Boolean).join(" | ");
    throw new Error(combined || "Ambas publicaciones fallaron sin mensaje");
  }
  return { fbId, igId, fbError, igError };
}
