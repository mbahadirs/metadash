import { graphGet } from './client.js';

export const REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'ads_read',
];
export const OPTIONAL_SCOPES = ['business_management', 'instagram_manage_comments'];

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
  };
}
