// Public entrypoint for the Meta content module (organic publishing + insights).
//
// Uses the "chatwoot" Meta app (App ID 1697421917913182) in Standard Access:
// publishing to OUR OWN Instagram/Facebook accounts does not require App Review,
// only that the assets are owned by Business Manager 1969811199978170 and the
// system-user token carries the right scopes.
//
// Required env:
//   META_CONTENT_TOKEN  - long-lived system-user token with:
//                         instagram_business_basic, instagram_business_content_publish,
//                         instagram_business_manage_insights, pages_read_engagement,
//                         pages_manage_posts
//   META_PAGE_ID        - Facebook Page id (the IG account hangs off this)
//   META_IG_USER_ID     - optional; auto-discovered from the Page when absent
import { getEnv } from "../config/env.js";
import { graphGet } from "./client.js";
import * as instagram from "./instagram.js";
import * as facebook from "./facebook.js";

let cached = null;

// Resolve the Instagram Business account id from the linked Page, and confirm
// the token is healthy. Cached after first call.
export async function bootstrap({ refresh = false, token } = {}) {
  if (cached && !refresh) return cached;

  const pageId = getEnv("META_PAGE_ID");
  if (!pageId) throw new Error("META_PAGE_ID is not set");

  // One call gives us the Page name and its linked IG business account.
  const page = await graphGet(`/${pageId}`, {
    params: { fields: "id,name,instagram_business_account{id,username}" },
    token,
  });

  const igFromEnv = getEnv("META_IG_USER_ID");
  const igAccount = page.instagram_business_account ?? null;
  const igUserId = igFromEnv || igAccount?.id || null;

  if (!igUserId) {
    throw new Error(
      "No Instagram Business account linked to this Page. " +
        "Link the IG account to the Page in Meta Business Suite, or set META_IG_USER_ID.",
    );
  }

  cached = {
    pageId: page.id,
    pageName: page.name,
    igUserId,
    igUsername: igAccount?.username ?? null,
  };
  return cached;
}

export { instagram, facebook };
