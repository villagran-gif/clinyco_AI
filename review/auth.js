// Netlify Identity is the token authority. Never authorize from decoded JWTs,
// client-supplied profiles, user_metadata, Origin alone, or a public API key.
export const REVIEW_SITE_ORIGIN = 'https://clinyco-ai.netlify.app';
const IDENTITY_USER_URL = `${REVIEW_SITE_ORIGIN}/.netlify/identity/user`;

function accessToken(req) {
  const authorization = req.get('authorization');
  if (authorization) return /^Bearer ([A-Za-z0-9_.-]{1,8192})$/i.exec(authorization)?.[1] || null;
  const matches = (req.get('cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith('nf_jwt='));
  if (matches.length !== 1) return null;
  try {
    const token = decodeURIComponent(matches[0].slice(7));
    return /^[A-Za-z0-9_.-]{1,8192}$/.test(token) ? token : null;
  } catch { return null; }
}

export function reviewAuth({ fetchImpl = globalThis.fetch, allowedEmails = () => process.env.REVIEW_ALLOWED_EMAILS || '' } = {}) {
  return async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Vary', 'Cookie, Authorization');
    const fail = (status, error) => res.status(status).json({ error });
    // No cross-origin dashboard requests. Mutations require an exact Origin,
    // including form POSTs; do not trust the proxy's Host/X-Forwarded-Host.
    const origin = req.get('origin');
    if ((origin && origin !== REVIEW_SITE_ORIGIN) || req.get('sec-fetch-site') === 'cross-site'
      || (!['GET', 'HEAD'].includes(req.method) && origin !== REVIEW_SITE_ORIGIN)) {
      return fail(403, 'origin_not_allowed');
    }
    const emails = new Set(allowedEmails().split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    if (!emails.size) return fail(503, 'review_auth_not_configured');
    const token = accessToken(req);
    if (!token) return fail(401, 'authentication_required');
    let response, user;
    try {
      response = await fetchImpl(IDENTITY_USER_URL, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store',
      });
      if ([401, 403].includes(response.status)) return fail(401, 'invalid_session');
      if (!response.ok) return fail(503, 'identity_unavailable');
      user = await response.json();
    } catch { return fail(503, 'identity_unavailable'); }
    // These are fields returned by the trusted Identity service, not the browser.
    if (!user?.id || !user.confirmed_at || user.app_metadata?.provider !== 'google'
      || typeof user.email !== 'string' || !emails.has(user.email.toLowerCase())) {
      return fail(403, 'account_not_authorized');
    }
    // Deliberately no authorization cache: removing a user or allowed email
    // takes effect on the next request once the server config is updated.
    req.reviewUser = { id: user.id, email: user.email };
    return next();
  };
}
