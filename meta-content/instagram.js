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
