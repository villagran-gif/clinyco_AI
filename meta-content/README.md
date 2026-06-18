# meta-content

Organic publishing + insights for Instagram and Facebook, via the Graph API,
using **our own** Meta app (`chatwoot`, App ID `1697421917913182`) in
**Standard Access**.

**Multi-page by design.** Auto-discovers every Facebook Page the system-user
token has access to (Clínyco, Fonasapad, Rodrigo Villagrán Cirugía, …) plus the
Instagram Business account linked to each. Add a Page in Business Manager and
it shows up automatically on the next call — no env-var changes needed.

## Why Standard Access (no App Review)

Per Meta's docs, Standard Access "only works for users who have a role on your
Meta app" and **"if your app only serves your Instagram professional account or
an account you manage, Standard Access is all your app needs."** Since we only
publish to accounts owned by Business Manager `1969811199978170`, **no App
Review is required**. App Review (Advanced Access) is only needed to serve
third-party accounts ("reselling").

## Requirements

1. Instagram accounts in **Professional** (Business/Creator) mode
2. Each IG account **linked to its Facebook Page** in the same Business Manager
3. A system-user token with these scopes:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   - `instagram_business_manage_insights`
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`

> Do **not** request `instagram_business_manage_messages` — that's the Messaging
> API, which has stricter eligibility and is unrelated to publishing.

## Env

```
META_CONTENT_TOKEN=   # long-lived system-user token (scopes above)
META_API_VERSION=v21.0
# Optional: comma-separated allowlist if the token has access to more
# pages than we want to manage. Empty = expose all.
META_PAGE_IDS=
```

## Usage

```js
import { listPages, findPage, instagram, facebook } from "./meta-content/index.js";

// --- Discover all manageable Pages (cached after first call) ---
const pages = await listPages();
// [{ pageId, name, accessToken, igUserId, igUsername }, ...]

// --- Pick one by name (case-insensitive, substring match) ---
const clinyco = await findPage("Clínyco");
// { pageId: "364477330337013", name: "Clínyco", accessToken: "...", igUserId: "...", igUsername: "clinyco" }

// --- Read (safe) ---
await facebook.listPosts(clinyco.pageId, { token: clinyco.accessToken, limit: 25 });
await instagram.listMedia(clinyco.igUserId, { token: clinyco.accessToken, limit: 25 });
await instagram.getMediaInsights(mediaId, { token: clinyco.accessToken });

// --- Facebook write (defaults to DRAFT) ---
await facebook.createPost(clinyco.pageId, {
  message: "…",
  token: clinyco.accessToken,
}); // unpublished
await facebook.createPost(clinyco.pageId, {
  message: "…",
  publish: true,
  token: clinyco.accessToken,
}); // live

// --- Instagram write (two explicit steps, never auto-publishes) ---
const { id } = await instagram.createMediaContainer(clinyco.igUserId, {
  imageUrl: "https://…/creative.jpg",
  caption: "…",
  token: clinyco.accessToken,
});
// review id, then explicitly:
await instagram.publishContainer(clinyco.igUserId, id, {
  token: clinyco.accessToken,
});
```

Always pass the per-page `accessToken` for writes — Meta's auth model prefers
the narrowest token, and using the page-scoped one means revoking access to
one page doesn't affect the others.

## Gotchas

- **Instagram has no real draft.** An unpublished container is the closest thing
  and Meta expires it in ~24h. We keep create/publish as two explicit calls so
  nothing goes live by accident.
- **Stories cannot be scheduled** via API. `media_type: STORIES` publishes
  immediately or not at all.
- **Images must be public URLs.** Local files are rejected — host generated
  creatives first.
- **Rate limit:** 100 IG API-published posts / 24h **per IG account** (carousels
  count as 1).
- **Page tokens are per-page.** A token for the Clínyco Page can't post to
  Fonasapad — always use the matching `accessToken` from `findPage()`.

## Smoke test

```
node scripts/test-meta-content.mjs
```

Read-only: discovers every Page, lists recent FB posts + IG media for each.
Publishes nothing. Exits non-zero if any Page fails.
