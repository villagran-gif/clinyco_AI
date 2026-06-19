// Instagram content publishing + insights via the Graph API.
//
// Publishing is a two-step flow (Meta's design):
//   1) createMediaContainer() -> returns a container id (acts as a transient
//      "draft"; Meta expires unpublished containers after ~24h)
//   2) publishContainer()     -> promotes the container to a live post
//
// IMPORTANT: Instagram has no real "draft" state in the API. The closest thing
// is leaving a container unpublished. To avoid accidental live posts we keep
// the two steps explicit and never auto-publish.
//
// Images/videos MUST be reachable at a public URL (image_url / video_url).
// Local files are not accepted — generated creatives have to be hosted first
// (S3, Cloudinary, or Clinyco's own static server).
import { graphGet, graphPost } from "./client.js";

// Build a media container. Does NOT publish. Returns { id }.
export async function createMediaContainer(igUserId, {
  imageUrl,
  videoUrl,
  caption,
  mediaType,
  isCarouselItem,
  children,
  token,
} = {}) {
  const params = { caption, is_carousel_item: isCarouselItem };
  if (imageUrl) params.image_url = imageUrl;
  if (videoUrl) params.video_url = videoUrl;
  if (mediaType) params.media_type = mediaType; // REELS, STORIES, CAROUSEL
  if (children) params.children = Array.isArray(children) ? children.join(",") : children;
  return graphPost(`/${igUserId}/media`, { params, token });
}

// Publish a previously created container. This goes LIVE immediately.
export async function publishContainer(igUserId, creationId, { token } = {}) {
  return graphPost(`/${igUserId}/media_publish`, {
    params: { creation_id: creationId },
    token,
  });
}

// Poll a container's status — useful for video/reel processing before publish.
export async function getContainerStatus(creationId, { token } = {}) {
  const json = await graphGet(`/${creationId}`, {
    params: { fields: "status_code,status" },
    token,
  });
  return json; // { status_code: 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED', ... }
}

// List recent media for an account (for the "analyze last year" use case).
export async function listMedia(igUserId, {
  fields = "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count",
  limit = 50,
  after,
  token,
} = {}) {
  const params = { fields, limit, after };
  const json = await graphGet(`/${igUserId}/media`, { params, token });
  return { data: json.data ?? [], paging: json.paging ?? null };
}

// Per-media insights (reach, impressions, engagement, saves, …).
export async function getMediaInsights(mediaId, {
  metrics = "reach,impressions,engagement,saved",
  token,
} = {}) {
  const json = await graphGet(`/${mediaId}/insights`, {
    params: { metric: metrics },
    token,
  });
  return json.data ?? [];
}

// Account-level insights over a time window.
export async function getAccountInsights(igUserId, {
  metrics = "reach,impressions,profile_views,follower_count",
  period = "day",
  since,
  until,
  token,
} = {}) {
  const params = { metric: metrics, period, since, until };
  const json = await graphGet(`/${igUserId}/insights`, { params, token });
  return json.data ?? [];
}

// Pull the currently-active Instagram Stories for an account (the live
// last-24h ring). Stories archive isn't queryable via the public Graph API
// once they expire, so the "is this account using Stories actively?"
// question can only be answered by sampling current Stories or by
// recording them daily into our own storage.
//
// Each story carries: id, media_type (IMAGE | VIDEO), media_url,
// thumbnail_url (videos only), timestamp, permalink, caption.
export async function listStories(igUserId, {
  fields = "id,caption,media_type,media_url,thumbnail_url,timestamp,permalink",
  token,
} = {}) {
  const json = await graphGet(`/${igUserId}/stories`, {
    params: { fields },
    token,
  });
  return json.data ?? [];
}

// Pull a month-bounded window of media with the fields needed to render
// thumbnails (image_url for IMAGE, thumbnail_url for VIDEO covers,
// children expanded for CAROUSEL_ALBUM). Returns a normalized post shape:
//
//   { id, timestamp, date, mediaType, caption, permalink,
//     engagement, likes, comments, images: [{ url, kind, childId? }] }
//
// Shared by scripts/extract-meta-image-urls.mjs and the contact-sheet
// route so they always agree on the data model.
export async function fetchWindowWithImages(igUserId, {
  monthsBack = 2,
  includeCarouselChildren = true,
  token,
} = {}) {
  const dayMs = 86_400_000;
  const cutoff = Date.now() - monthsBack * 30 * dayMs;

  const raw = [];
  let after;
  for (let safety = 0; safety < 100; safety++) {
    const page = await listMedia(igUserId, {
      limit: 100,
      after,
      token,
      fields:
        "id,caption,media_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count",
    });
    if (!page.data.length) break;
    let crossed = false;
    for (const m of page.data) {
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      if (ts && ts < cutoff) {
        crossed = true;
        break;
      }
      raw.push(m);
    }
    if (crossed) break;
    after = page.paging?.cursors?.after;
    if (!after) break;
  }

  const out = [];
  for (const m of raw) {
    const entry = {
      id: m.id,
      timestamp: m.timestamp,
      date: m.timestamp?.slice(0, 10) ?? null,
      mediaType: m.media_type,
      caption: m.caption ?? "",
      permalink: m.permalink,
      engagement: (m.like_count ?? 0) + (m.comments_count ?? 0),
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      shares: 0,
      source: "instagram",
      images: [],
    };
    if (m.media_type === "IMAGE" && m.media_url) {
      entry.images.push({ url: m.media_url, kind: "image" });
    } else if (m.media_type === "VIDEO" && m.thumbnail_url) {
      entry.images.push({ url: m.thumbnail_url, kind: "video-cover" });
    } else if (m.media_type === "CAROUSEL_ALBUM" && includeCarouselChildren) {
      try {
        const kids = await graphGet(`/${m.id}/children`, {
          params: { fields: "id,media_type,media_url,thumbnail_url" },
          token,
        });
        for (const child of kids.data ?? []) {
          const url = child.media_url || child.thumbnail_url;
          if (url) {
            entry.images.push({
              url,
              kind: child.media_type?.toLowerCase() ?? "child",
              childId: child.id,
            });
          }
        }
      } catch {
        // Skip an individual broken carousel rather than failing the window.
      }
    }
    out.push(entry);
  }
  return out;
}
