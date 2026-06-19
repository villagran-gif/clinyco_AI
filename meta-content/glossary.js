// Bilingual glossary for social-media metrics.
//
// Each entry carries:
//   name        — display name in the dashboard
//   basic       — plain-language explanation a non-technical reader can grasp
//   technical   — precise formula / API definition / measurement caveats
//   sources     — short list of where the benchmark numbers come from
//
// The contact-sheet renderer pulls from here when foregrounding the active
// sort metric so the explanation panel teaches the team as they use the tool.
//
// New metrics added later should keep the same shape so the UI stays uniform.

export const GLOSSARY = {
  engagement: {
    name: "Engagement (♥+💬+↗)",
    basic:
      "Total de interacciones públicas que generó el post: corazones, comentarios, y para Facebook también shares. Es la métrica más usada para ranking porque mezcla varios tipos de reacción en un solo número.",
    technical:
      "engagement = likes + comments [+ shares para FB]. NO incluye reach, impressions, saves ni video views — esas requieren el endpoint /insights de Meta (próxima fase). Esta métrica es absoluta, no normalizada por seguidores; para comparar entre cuentas usar Engagement Rate = engagement / followers.",
    sources: ["Meta Graph API basic fields", "Hootsuite Benchmarks 2025"],
  },
  likes: {
    name: "Likes (♥)",
    basic:
      "Cuántas personas le dieron corazón al post. Es el indicador más básico y el que MENOS peso tiene en el algoritmo de 2026 — Meta prioriza shares y saves por encima de likes.",
    technical:
      "En IG: like_count del media. En FB: reactions.summary.total_count (incluye like, love, wow, haha, sad, angry). Útil como termómetro de visibilidad, no como driver de alcance — el algoritmo de descubrimiento de 2026 da más peso a saves y shares.",
    sources: ["Meta Graph API", "Adam Mosseri 2025 algorithm post"],
  },
  comments: {
    name: "Comentarios (💬)",
    basic:
      "Cuántas personas escribieron una respuesta al post. Indica conversación real — alguien se tomó el tiempo de escribir. Es señal fuerte de interés (más que un like).",
    technical:
      "En IG: comments_count. En FB: comments.summary.total_count. El algoritmo cuenta MUCHO los comments en los primeros 30 minutos del post (golden hour) — por eso muchos creators preguntan algo al final del caption para empujar respuestas.",
    sources: ["Meta Graph API", "Sprout Social 2025"],
  },
  shares: {
    name: "Compartidos (↗)",
    basic:
      "Cuántas personas compartieron el post fuera de su feed (a un amigo en DM, en sus stories, en otra plataforma). En 2026 es la métrica #1 que el algoritmo usa para decidir si tu post merece llegar a más personas.",
    technical:
      "FB: shares.count del Page feed. IG: NO expuesto en la Graph API pública — solo aparece dentro de Creator Studio. Para ver shares en IG hay que ir manualmente al post. Es el ranking signal más fuerte del algoritmo 2026 según fuentes de Meta.",
    sources: ["Meta Graph API", "Mosseri 'algorithm' Reel 2025"],
  },
  saves: {
    name: "Guardados (🔖)",
    basic:
      "Cuántas personas guardaron el post para volver a verlo después. Indica utilidad real — alguien quiere consultarlo. El algoritmo lo trata casi igual de fuerte que los shares.",
    technical:
      "Disponible solo vía endpoint /insights (metric=saved) por post. Requiere instagram_business_manage_insights scope. NO se incluye en este contact sheet (todavía) porque cada post necesita una llamada extra a /insights — lo agregamos cuando ese costo sea aceptable.",
    sources: ["Meta /insights API", "Dash Social 2025"],
  },
  reach: {
    name: "Alcance único",
    basic:
      "Cuántas cuentas distintas vieron el post. NO es lo mismo que impresiones (una misma persona puede ver el post 3 veces; eso son 3 impresiones pero 1 alcance).",
    technical:
      "metric=reach via /{media_id}/insights. Reach Rate = reach / followers. Healthcare benchmark: <20% bajo, 20-40% medio, >50% alto (Hootsuite 2025). NO disponible en el contact sheet actual.",
    sources: ["Meta /insights", "Hootsuite 2025"],
  },
  recent: {
    name: "Más recientes primero",
    basic: "Ordenado por fecha de publicación, lo más nuevo arriba.",
    technical: "ORDER BY timestamp DESC.",
    sources: [],
  },
  oldest: {
    name: "Más antiguos primero",
    basic: "Ordenado por fecha de publicación, lo más viejo arriba.",
    technical: "ORDER BY timestamp ASC.",
    sources: [],
  },
  follower_count: {
    name: "Seguidores totales",
    basic:
      "Cuántas personas siguen la cuenta hoy. Un drop pequeño (<1% mensual) suele ser limpieza normal de Meta (cuentas borradas o inactivas). Drops mayores ameritan investigar.",
    technical:
      "metric=follower_count en /{ig-user-id}/insights con period=day. Devuelve daily snapshots hasta 90 días atrás. Tendencia es lo importante: un decline lineal suave suele ser hygiene; un drop escalonado suele coincidir con un cambio de contenido o un algoritmo update.",
    sources: ["Meta /insights API"],
  },
};

export function explain(metricKey) {
  return GLOSSARY[metricKey] ?? null;
}
