# meta-content

Organic publishing + insights for Instagram and Facebook, via the Graph API,
using **our own** Meta app (`chatwoot`, App ID `1697421917913182`) in
**Standard Access**.

## Why Standard Access (no App Review)

Per Meta's docs, Standard Access "only works for users who have a role on your
Meta app" and **"if your app only serves your Instagram professional account or
an account you manage, Standard Access is all your app needs."** Since we only
publish to accounts owned by Business Manager `1969811199978170`, **no App
Review is required**. App Review (Advanced Access) is only needed to serve
third-party accounts ("reselling").

## Requirements

1. Instagram account in **Professional** (Business/Creator) mode
2. IG account **linked to a Facebook Page** in the same Business Manager
3. A system-user token with these scopes:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   - `instagram_business_manage_insights`
   - `pages_read_engagement`
   - `pages_manage_posts`

> Do **not** request `instagram_business_manage_messages` — that's the Messaging
> API, which has stricter eligibility and is unrelated to publishing.

## Env

```
META_CONTENT_TOKEN=   # long-lived system-user token (scopes above)
META_PAGE_ID=         # Facebook Page id
META_IG_USER_ID=      # optional; auto-discovered from the Page when empty
META_API_VERSION=v21.0
```

## Usage

```js
import { bootstrap, instagram, facebook } from "./meta-content/index.js";

const ctx = await bootstrap();              // resolves IG id from the Page

// --- Read (safe) ---
await facebook.listPosts(ctx.pageId, { limit: 25 });
await instagram.listMedia(ctx.igUserId, { limit: 25 });
await instagram.getMediaInsights(mediaId);

// --- Facebook write (defaults to DRAFT) ---
await facebook.createPost(ctx.pageId, { message: "…" });            // unpublished
await facebook.createPost(ctx.pageId, { message: "…", publish: true }); // live

// --- Instagram write (two explicit steps, never auto-publishes) ---
const { id } = await instagram.createMediaContainer(ctx.igUserId, {
  imageUrl: "https://…/creative.jpg",
  caption: "…",
});
// review id, then explicitly:
await instagram.publishContainer(ctx.igUserId, id);
```

## Gotchas

- **Instagram has no real draft.** An unpublished container is the closest thing
  and Meta expires it in ~24h. We keep create/publish as two explicit calls so
  nothing goes live by accident.
- **Stories cannot be scheduled** via API. `media_type: STORIES` publishes
  immediately or not at all.
- **Images must be public URLs.** Local files are rejected — host generated
  creatives first.
- **Rate limit:** 100 IG API-published posts / 24h (carousels count as 1).

## Smoke test

```
node scripts/test-meta-content.mjs
```

Read-only: resolves the IG link and lists recent posts. Publishes nothing.
