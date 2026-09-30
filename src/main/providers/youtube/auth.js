import { MetaError, NetworkError } from '../../meta/errors.js';
import { buildAuthorizeUrl } from '../../oauth/pkce.js';

/**
 * Google OAuth 2.0 for installed (desktop) apps — loopback redirect + PKCE (S256). Confirmed against
 * developers.google.com/identity/protocols/oauth2/native-app (2026-09):
 *   authorize  https://accounts.google.com/o/oauth2/v2/auth (response_type=code, code_challenge, code_challenge_method=S256,
 *              redirect_uri=http://127.0.0.1:<port>/…, state, access_type=offline for a refresh token)
 *   token      POST https://oauth2.googleapis.com/token (form-encoded; grant_type=authorization_code with code + code_verifier,
 *              or grant_type=refresh_token). client_secret is optional for desktop clients but Google issues one and
 *              accepts it, so it is sent when present.
 *   revoke     POST https://oauth2.googleapis.com/revoke (token=…) — revoking the refresh token revokes the grant.
 * Refresh tokens: 7-day expiry while the consent screen is "Testing" (external users), invalid after 6 months unused,
 * max 100 live refresh tokens per Google account per client (developers.google.com/identity/protocols/oauth2).
 */
export const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export const SCOPES = Object.freeze({
  readonly: 'https://www.googleapis.com/auth/youtube.readonly',
  analytics: 'https://www.googleapis.com/auth/yt-analytics.readonly',
  forceSsl: 'https://www.googleapis.com/auth/youtube.force-ssl',
});
export const BASE_SCOPES = Object.freeze([SCOPES.readonly, SCOPES.analytics]);
/** Replying to / moderating comments (comments.insert, comments.setModerationStatus). */
export const REPLY_SCOPES = Object.freeze([SCOPES.forceSsl]);

export const scopesFor = ({ reply = false } = {}) => [...BASE_SCOPES, ...(reply ? REPLY_SCOPES : [])];
export const hasReplyScope = (scopes) => REPLY_SCOPES.every((s) => (scopes ?? []).includes(s));

/** Consent URL. prompt=consent makes Google return a refresh token on every connect (also when re-consenting). */
export function buildAuthUrl({ clientId, redirectUri, challenge, state, reply = false }) {
  return buildAuthorizeUrl(AUTHORIZE_URL, {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopesFor({ reply }).join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
  });
}

const authError = (message, extra = {}) => new MetaError({ code: 190, message, endpoint: '/token', source: 'google', ...extra });

async function postForm(url, params, fetchImpl) {
  const body = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString();
  try {
    return await (fetchImpl ?? globalThis.fetch)(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new NetworkError(e?.message ?? 'network error', new URL(url).pathname);
  }
}

async function tokenCall(params, { fetchImpl, now = Date.now() } = {}) {
  const res = await postForm(TOKEN_URL, params, fetchImpl);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body?.access_token) {
    const err = body?.error ?? `HTTP ${res.status}`;
    const message = body?.error_description ? `${err}: ${body.error_description}` : String(err);
    // invalid_grant = revoked/expired refresh token or a bad code; invalid_client = wrong client id/secret.
    if (err === 'invalid_grant' || err === 'invalid_client' || err === 'unauthorized_client' || res.status === 401) throw authError(message, { status: res.status, type: err });
    throw new MetaError({ code: res.status >= 500 ? 2 : 100, message, endpoint: '/token', status: res.status, source: 'google', type: err });
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: now + (Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600) * 1000,
    scopes: typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : null,
  };
}

/** Authorization code (+ PKCE verifier) → tokens. */
export function exchangeCode({ clientId, clientSecret, code, verifier, redirectUri, fetchImpl, now }) {
  return tokenCall({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }, { fetchImpl, now });
}

/** Refresh token → new access token (Google normally keeps the refresh token; a rotated one is returned when sent). */
export function refreshAccessToken({ clientId, clientSecret, refreshToken, fetchImpl, now }) {
  if (!refreshToken) return Promise.reject(authError('google refresh token missing'));
  return tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }, { fetchImpl, now });
}

/** Revokes a token (best effort for callers; returns false on any failure). */
export async function revokeToken(token, { fetchImpl } = {}) {
  if (!token) return false;
  try {
    const res = await postForm(REVOKE_URL, { token }, fetchImpl);
    return res.ok;
  } catch {
    return false;
  }
}
