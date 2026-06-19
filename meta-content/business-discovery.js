// meta-content/business-discovery.js
//
// Instagram Business Discovery API — datos reales en vivo de cualquier
// cuenta IG que esté en modo Business o Creator y sea pública. No funciona
// para cuentas Personal o privadas.
//
// Mecanismo: la query se hace DESDE una de nuestras propias cuentas IG
// Business (ej. @clinyco.cl) usando el campo `business_discovery` con
// `.username(target)`. Misma Graph API, mismo token, scope ya cubierto.
//
// Lo que devuelve Meta (todo público):
//   - followers_count        (← el dato que el cliente pidió, real, no estimado)
//   - follows_count
//   - media_count
//   - name, username, biography, profile_picture_url, website
//   - hasta 50 publicaciones recientes con like_count, comments_count,
//     media_type, timestamp, permalink, caption
//
// Lo que NO devuelve (no existe en la API pública):
//   - shares, saves, reach, impressions de otra cuenta
//   - Stories ajenas
//   - DMs

import { findPage } from "./index.js";
import { graphGet } from "./client.js";

const DEFAULT_QUERIER = "clinyco"; // resuelve a @clinyco.cl

function buildBusinessDiscoveryFields({ recentLimit }) {
  const base = [
    "id", "username", "name", "biography", "website",
    "profile_picture_url", "followers_count", "follows_count", "media_count",
  ];
  if (recentLimit > 0) {
    base.push(
      `media.limit(${recentLimit}){id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count}`,
    );
  }
  return base.join(",");
}

// Descubre datos reales de UNA cuenta target.
// `targetUsername` puede venir con o sin @, normalizamos.
export async function discoverAccount(targetUsername, {
  querierAccount = DEFAULT_QUERIER,
  recentLimit = 25,
} = {}) {
  if (!targetUsername) throw new Error("discoverAccount: targetUsername requerido");
  const handle = String(targetUsername).replace(/^@/, "").trim();
  const page = await findPage(querierAccount);
  if (!page.igUserId) {
    throw new Error(`Querier "${querierAccount}" no tiene IG Business vinculado`);
  }
  const fields = `business_discovery.username(${handle}){${buildBusinessDiscoveryFields({ recentLimit })}}`;
  // Meta retorna 400 con un mensaje útil cuando la target es Personal o
  // privada. Lo dejamos propagar para que el caller decida cómo presentarlo.
  const json = await graphGet(`/${page.igUserId}`, {
    params: { fields },
    token: page.accessToken,
  });
  const bd = json.business_discovery;
  if (!bd) {
    throw new Error(
      `Sin datos para @${handle}. Posibles causas: cuenta Personal (no Business/Creator), ` +
        `privada, o el handle no existe.`,
    );
  }
  // Normalizamos los timestamps de media para ser consistentes con el
  // resto del módulo (string ISO).
  const recent = (bd.media?.data ?? []).map((m) => ({
    ...m,
    engagement: (m.like_count ?? 0) + (m.comments_count ?? 0),
  }));
  return {
    queriedAt: new Date().toISOString(),
    querier: { account: querierAccount, igUsername: page.igUsername },
    target: {
      username: bd.username,
      name: bd.name ?? null,
      biography: bd.biography ?? null,
      website: bd.website ?? null,
      profilePictureUrl: bd.profile_picture_url ?? null,
      followersCount: bd.followers_count ?? null,
      followsCount: bd.follows_count ?? null,
      mediaCount: bd.media_count ?? null,
    },
    recent,
  };
}

// Descubre datos de varias cuentas en paralelo. Útil para refrescar el
// tablero de competidores. Errores por cuenta NO tiran el batch; cada
// fallido queda con `error` en su slot.
export async function discoverMany(targets, opts = {}) {
  const tasks = targets.map(async (u) => {
    try {
      return await discoverAccount(u, opts);
    } catch (err) {
      return { error: err.message, target: { username: String(u).replace(/^@/, "") } };
    }
  });
  return Promise.all(tasks);
}
