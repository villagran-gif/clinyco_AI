// Public entrypoint for the Meta content module (organic publishing + insights).
//
// Uses the "chatwoot" Meta app (App ID 1697421917913182) in Standard Access:
// publishing to OUR OWN Instagram/Facebook accounts does not require App Review,
// only that the assets are owned by Business Manager 1969811199978170 and the
// system-user token carries the right scopes.
//
// Multi-page by design: /me/accounts auto-discovers every Page the system-user
// token has access to (Clínyco, Fonasapad, Rodrigo Villagran Cirugía, …) plus
// the Instagram Business account linked to each. No need to enumerate Page IDs
// in env vars — add a Page in Business Manager and it appears here on next call.
//
// Required env:
//   META_CONTENT_TOKEN  - long-lived system-user token with:
//                         instagram_business_basic, instagram_business_content_publish,
//                         instagram_business_manage_insights, pages_show_list,
//                         pages_read_engagement, pages_manage_posts
//
// Optional env:
//   META_PAGE_IDS       - comma-separated allowlist; when set, only these Page
//                         ids are exposed (useful to scope down a token that
//                         has access to more pages than we want to manage)
import { getEnv } from "../config/env.js";
import { graphGet } from "./client.js";
import * as instagram from "./instagram.js";
import * as facebook from "./facebook.js";

let cached = null;

// Discover every Page the token can manage, with each Page's linked IG account
// AND a page-scoped access token. The page-scoped token is what should be used
// for writes (posts, IG publishing) — Meta's auth model prefers the narrowest
// token, and a system-user token issued for a never-expires user yields
// never-expires page tokens, so caching is safe.
//
// Returns: Array<{ pageId, name, accessToken, igUserId, igUsername }>
export async function listPages({ refresh = false, token } = {}) {
  if (cached && !refresh) return cached;

  const json = await graphGet("/me/accounts", {
    params: {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: 100,
    },
    token,
  });

  const allowlist = parseAllowlist(getEnv("META_PAGE_IDS"));
  const pages = (json.data ?? [])
    .filter((p) => !allowlist || allowlist.has(p.id))
    .map((p) => ({
      pageId: p.id,
      name: p.name,
      accessToken: p.access_token,
      igUserId: p.instagram_business_account?.id ?? null,
      igUsername: p.instagram_business_account?.username ?? null,
    }));

  if (!pages.length) {
    throw new Error(
      "No Facebook Pages discovered. Either the token lacks pages_show_list / " +
        "pages_read_engagement, the system user isn't assigned to any Pages, " +
        "or META_PAGE_IDS filtered them all out.",
    );
  }

  cached = pages;
  return cached;
}

// Find a page by id, Instagram username (with or without @), exact name
// (accent-insensitive), or substring match against either name or username.
// Throws with the available options when no match is found.
export async function findPage(query, { token } = {}) {
  const pages = await listPages({ token });
  if (!query) {
    throw new Error("findPage requires a page id or name");
  }
  const raw = String(query);
  const q = normalize(query);
  const match =
    pages.find((p) => p.pageId === raw) ||
    pages.find((p) => normalize(p.name) === q) ||
    pages.find((p) => normalize(p.igUsername) === q) ||
    pages.find((p) => normalize(p.name).includes(q)) ||
    pages.find((p) => normalize(p.igUsername).includes(q));
  if (!match) {
    const available = pages
      .map((p) => `"${p.name}" / @${p.igUsername ?? "-"} (${p.pageId})`)
      .join(", ");
    throw new Error(`No page matched "${query}". Available: ${available}`);
  }
  return match;
}

// Lowercase, strip diacritics ("Clínyco" → "clinyco"), drop a leading "@",
// trim whitespace. Exported so scripts can do the same matching off-band.
export function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^@/, "")
    .trim();
}

function parseAllowlist(raw) {
  if (!raw) return null;
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

export { instagram, facebook };
