// Facebook Page posts + insights via the Graph API.
//
// Unlike Instagram, Facebook Pages DO support real drafts: pass published=false
// to /{page-id}/feed and the post is created unpublished, reviewable in Meta
// Business Suite before going live. We default to draft mode for safety.
import { graphGet, graphPost } from "./client.js";

// Create a text/link post on a Page. Defaults to DRAFT (published=false).
// Pass { publish: true } to go live immediately.
export async function createPost(pageId, {
  message,
  link,
  publish = false,
  token,
} = {}) {
  if (!message && !link) {
    throw new Error("createPost requires at least a message or a link");
  }
  return graphPost(`/${pageId}/feed`, {
    params: { message, link, published: publish ? "true" : "false" },
    token,
  });
}

// Create a photo post from a public image URL. Defaults to DRAFT.
export async function createPhotoPost(pageId, {
  imageUrl,
  caption,
  publish = false,
  token,
} = {}) {
  if (!imageUrl) throw new Error("createPhotoPost requires an imageUrl");
  return graphPost(`/${pageId}/photos`, {
    params: { url: imageUrl, caption, published: publish ? "true" : "false" },
    token,
  });
}

// List recent published posts (for the "analyze last year" use case).
export async function listPosts(pageId, {
  fields = "id,message,created_time,permalink_url,shares,reactions.summary(true),comments.summary(true)",
  limit = 50,
  after,
  token,
} = {}) {
  const params = { fields, limit, after };
  const json = await graphGet(`/${pageId}/posts`, { params, token });
  return { data: json.data ?? [], paging: json.paging ?? null };
}

// Page-level insights over a time window.
export async function getPageInsights(pageId, {
  metrics = "page_impressions,page_post_engagements,page_fans",
  period = "day",
  since,
  until,
  token,
} = {}) {
  const params = { metric: metrics, period, since, until };
  const json = await graphGet(`/${pageId}/insights`, { params, token });
  return json.data ?? [];
}

// Page-feed window normalized to the same post shape used by Instagram so
// the contact-sheet renderer can mix them seamlessly.
//
// FB feed doesn't return per-attachment URLs cheaply — `full_picture` is the
// canonical single-image preview Meta surfaces, which is what we want for a
// thumbnail grid. (For carousel posts on FB, full_picture is the cover.)
//
// Engagement adds shares to the IG model (likes + comments + shares) since
// shares are a first-class signal on Page feed.
export async function fetchWindowWithImages(pageId, {
  monthsBack = 2,
  token,
} = {}) {
  const dayMs = 86_400_000;
  const cutoff = Date.now() - monthsBack * 30 * dayMs;

  const raw = [];
  let after;
  for (let safety = 0; safety < 100; safety++) {
    const page = await listPosts(pageId, {
      limit: 100,
      after,
      token,
      fields:
        "id,message,created_time,permalink_url,full_picture,reactions.summary(true),comments.summary(true),shares",
    });
    if (!page.data.length) break;
    let crossed = false;
    for (const p of page.data) {
      const ts = p.created_time ? new Date(p.created_time).getTime() : 0;
      if (ts && ts < cutoff) {
        crossed = true;
        break;
      }
      raw.push(p);
    }
    if (crossed) break;
    after = page.paging?.cursors?.after;
    if (!after) break;
  }

  return raw.map((p) => {
    const likes = p.reactions?.summary?.total_count ?? 0;
    const comments = p.comments?.summary?.total_count ?? 0;
    const shares = p.shares?.count ?? 0;
    return {
      id: p.id,
      timestamp: p.created_time,
      date: p.created_time?.slice(0, 10) ?? null,
      mediaType: "FB_POST",
      caption: p.message ?? "",
      permalink: p.permalink_url,
      engagement: likes + comments + shares,
      likes,
      comments,
      shares,
      source: "facebook",
      images: p.full_picture ? [{ url: p.full_picture, kind: "fb-cover" }] : [],
    };
  });
}
