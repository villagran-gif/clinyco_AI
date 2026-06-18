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
