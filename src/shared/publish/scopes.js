/**
 * Scopes a worker token may carry (plan §4 security model 5). Tokens with anything else (ads_*, read_insights,
 * *_manage_comments, messaging, insights, …) are refused unless the user explicitly allows a broader token.
 * The minimum Meta set is VERIFY against the current permissions reference.
 */
export const PUBLISH_SCOPES = Object.freeze({
  instagram: Object.freeze(['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'business_management']),
  facebook: Object.freeze(['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management']),
  threads: Object.freeze(['threads_basic', 'threads_content_publish']),
});

/** Scopes required for publishing on each platform. */
export const REQUIRED_SCOPES = Object.freeze({
  instagram: Object.freeze(['instagram_content_publish']),
  facebook: Object.freeze(['pages_manage_posts']),
  threads: Object.freeze(['threads_content_publish']),
});

/** Granted scopes beyond the publishing set (IG and FB share one Meta login, so the Meta union is allowed for both). */
export function broaderScopes(platform, scopes) {
  const allowed = platform === 'threads' ? new Set(PUBLISH_SCOPES.threads) : new Set([...PUBLISH_SCOPES.instagram, ...PUBLISH_SCOPES.facebook]);
  return [...new Set((scopes ?? []).map(String))].filter((s) => !allowed.has(s));
}

export function missingScopes(platform, scopes) {
  const have = new Set((scopes ?? []).map(String));
  return (REQUIRED_SCOPES[platform] ?? []).filter((s) => !have.has(s));
}

/** GET /me/permissions payload → granted scope names. */
export const grantedScopes = (body) => (body?.data ?? []).filter((p) => p?.status === 'granted').map((p) => String(p.permission));

export const TOKEN_KEY_RE = /^(instagram|facebook|threads):[A-Za-z0-9_.-]{1,80}$/;
export const tokenKeyFor = (platform, accountId) => `${platform}:${accountId}`;
