import { graphGet } from './client.js';

export const REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'ads_read',
];
/**
 * read_insights: Facebook Page insights (optional — only needed when Pages are tracked).
 * v1.4 publishing (optional — only needed to publish from the Planner): instagram_content_publish (IG), pages_manage_posts
 * (FB Pages), pages_manage_engagement (FB first comment); instagram_manage_comments doubles as the IG first-comment scope.
 */
export const PUBLISH_SCOPES = Object.freeze({
  instagram: Object.freeze(['instagram_content_publish']),
  facebook: Object.freeze(['pages_manage_posts']),
});
export const FIRST_COMMENT_SCOPES = Object.freeze({ instagram: 'instagram_manage_comments', facebook: 'pages_manage_engagement' });
export const OPTIONAL_SCOPES = ['business_management', 'instagram_manage_comments', 'read_insights', 'instagram_content_publish', 'pages_manage_posts', 'pages_manage_engagement'];

/** Scopes each platform needs on the Meta token (Facebook Pages: list, read posts, read insights). */
export const PLATFORM_SCOPES = Object.freeze({
  instagram: REQUIRED_SCOPES,
  facebook: ['pages_show_list', 'pages_read_engagement', 'read_insights'],
});

/** { instagram: bool, facebook: bool } — whether a granted scope list covers each Meta platform. */
export function platformReadiness(scopes = []) {
  return Object.fromEntries(Object.entries(PLATFORM_SCOPES).map(([p, need]) => [p, need.every((s) => scopes.includes(s))]));
}

/** Scopes missing for a platform. */
export function missingScopesFor(platform, scopes = []) {
  return (PLATFORM_SCOPES[platform] ?? []).filter((s) => !scopes.includes(s));
}

/**
 * Publish readiness of a Meta token's scopes: { instagram, facebook } (can publish) + first-comment support.
 * Facebook Pages additionally need the CREATE_CONTENT task on each Page (checked per Page by publishing/readiness.js).
 */
export function publishReadiness(scopes = []) {
  const has = (s) => scopes.includes(s);
  return {
    instagram: PUBLISH_SCOPES.instagram.every(has),
    facebook: PUBLISH_SCOPES.facebook.every(has),
    igFirstComment: has(FIRST_COMMENT_SCOPES.instagram),
    fbFirstComment: has(FIRST_COMMENT_SCOPES.facebook),
  };
}

export async function exchangeLongLivedToken({ appId, appSecret, shortToken }) {
  const body = await graphGet('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  return { token: body.access_token, expiresIn: body.expires_in ?? null, tokenType: body.token_type };
}

export async function debugToken(token) {
  const body = await graphGet('/debug_token', { input_token: token }, { token });
  const d = body.data ?? {};
  const expiresAt = d.expires_at ? d.expires_at * 1000 : null;
  const scopes = d.scopes ?? [];
  return {
    valid: !!d.is_valid,
    appId: d.app_id ?? null,
    userId: d.user_id ?? null,
    expiresAt,
    daysLeft: expiresAt ? Math.floor((expiresAt - Date.now()) / 86_400_000) : null,
    scopes,
    missingScopes: REQUIRED_SCOPES.filter((s) => !scopes.includes(s)),
    optionalScopes: OPTIONAL_SCOPES.map((s) => ({ scope: s, granted: scopes.includes(s) })),
    platformReadiness: platformReadiness(scopes),
    publishReadiness: publishReadiness(scopes),
  };
}
