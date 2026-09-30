import crypto from 'node:crypto';
import { MetaError, NetworkError } from '../../meta/errors.js';
import { createPkce, buildAuthorizeUrl } from '../../oauth/pkce.js';

/**
 * TikTok Login Kit for Desktop (checked against developers.tiktok.com on 2026-09-30).
 * CONFIRMED
 *  - Authorize: https://www.tiktok.com/v2/auth/authorize/ with client_key, scope (comma-separated), redirect_uri, state,
 *    response_type=code, code_challenge, code_challenge_method=S256.
 *  - Desktop PKCE is REQUIRED and the challenge is the HEX encoding of SHA256(verifier) — not base64url like RFC 7636,
 *    so oauth/pkce.js createPkce() is only used for the verifier. Verifier: 43–128 chars of [A-Za-z0-9-._~].
 *  - Desktop redirect URIs: host localhost or 127.0.0.1 only, a port is required and `*` is allowed
 *    (e.g. http://127.0.0.1:*\/callback/), static, ≤ 10 URIs, < 512 chars. → loopback is the primary flow.
 *  - Token: POST https://open.tiktokapis.com/v2/oauth/token/ (application/x-www-form-urlencoded) with client_key,
 *    client_secret, code (URL-decoded), grant_type=authorization_code, redirect_uri, code_verifier. Refresh: grant_type=
 *    refresh_token + refresh_token; the returned refresh token may differ and must replace the old one.
 *    Response: access_token, expires_in (86400), open_id, refresh_token, refresh_expires_in (31536000), scope, token_type.
 *    Errors: { error, error_description, log_id }.
 *  - Revoke: POST https://open.tiktokapis.com/v2/oauth/revoke/ with client_key, client_secret, token.
 * VERIFY
 *  - Web-platform redirect (paste-code fallback via the static docs/oauth/callback.html page): Web Login Kit requires
 *    https static URIs and does not document PKCE. We still send the hex challenge + verifier; if TikTok rejects the
 *    verifier for web redirects the user should use the loopback flow (documented in docs/tiktok-setup.md).
 *  - Whether the wildcard port matches every ephemeral port picked by oauth/loopback.js (documented as supported).
 */
export const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
export const TIKTOK_SCOPES = Object.freeze(['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list']);

/** Loopback callback path; register `http://127.0.0.1:*\/callback/` as a Desktop redirect URI. */
export const LOOPBACK_PATH = '/callback/';
export const LOOPBACK_REDIRECT_PATTERN = 'http://127.0.0.1:*/callback/';
/** Paste-code fallback: static GitHub Pages copy of docs/oauth/callback.html (configurable per install). */
export const DEFAULT_PASTE_REDIRECT_URI = 'https://mbahadirs.github.io/metadash/oauth/callback.html';

const DAY_MS = 86_400_000;

/** TikTok desktop code challenge: hex(SHA-256(verifier)). */
export function hexChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('hex');
}

/** { verifier, challenge (hex), method: 'S256' }. The verifier is base64url (subset of TikTok's allowed set). */
export function createTikTokPkce() {
  const { verifier } = createPkce();
  return { verifier, challenge: hexChallenge(verifier), method: 'S256' };
}

export function buildAuthUrl({ clientKey, redirectUri, state, challenge, scopes = TIKTOK_SCOPES }) {
  return buildAuthorizeUrl(TIKTOK_AUTHORIZE_URL, {
    client_key: clientKey,
    scope: scopes.join(','),
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
}

/**
 * Accepts a bare code or the whole redirect URL (as copied from the callback page or the address bar).
 * Returns { code, state|null } with the code URL-decoded, or null (no code / error redirect).
 */
export function extractCode(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('?') || /(^|&)code=/.test(raw)) {
    let params;
    try {
      params = /^https?:\/\//i.test(raw) ? new URL(raw).searchParams : new URLSearchParams(raw.replace(/^\?/, ''));
    } catch {
      return null;
    }
    const code = params.get('code');
    return code ? { code, state: params.get('state') } : null;
  }
  if (/\s/.test(raw)) return null;
  return { code: raw, state: null };
}

async function tokenCall(url, params, endpoint) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new NetworkError(e?.message ?? 'network error', endpoint);
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  const data = body?.data && typeof body.data === 'object' && body.data.access_token ? body.data : body;
  const vendor = typeof body?.error === 'string' ? body.error : body?.error?.code && body.error.code !== 'ok' ? body.error.code : null;
  if (!res.ok || vendor) {
    const code = vendor ?? `http_${res.status}`;
    // invalid_grant = expired/revoked code or refresh token → reconnect (auth error for this account only).
    const err = new MetaError({
      code: code === 'invalid_grant' ? 190 : res.status >= 500 ? 2 : 100,
      message: `TikTok ${code}: ${body?.error_description ?? body?.error?.message ?? `HTTP ${res.status}`}`,
      endpoint, status: res.status, source: 'tiktok', type: code,
    });
    throw Object.assign(err, { vendorCode: code, logId: body?.log_id ?? body?.error?.log_id ?? null });
  }
  return data;
}

function mapTokens(t, now) {
  return {
    accessToken: t.access_token,
    expiresAt: now + (Number(t.expires_in) > 0 ? Number(t.expires_in) * 1000 : DAY_MS),
    refreshToken: t.refresh_token ?? null,
    refreshExpiresAt: Number(t.refresh_expires_in) > 0 ? now + Number(t.refresh_expires_in) * 1000 : null,
    openId: t.open_id != null ? String(t.open_id) : null,
    scopes: String(t.scope ?? '').split(/[,\s]+/).filter(Boolean),
  };
}

export async function exchangeCode({ clientKey, clientSecret, code, redirectUri, codeVerifier, now = Date.now() }) {
  const t = await tokenCall(TIKTOK_TOKEN_URL, {
    client_key: clientKey, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri,
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  }, '/v2/oauth/token/');
  if (!t?.access_token) throw new MetaError({ code: 100, message: 'TikTok token response without access_token', endpoint: '/v2/oauth/token/', source: 'tiktok' });
  return mapTokens(t, now);
}

export async function refreshAccessToken({ clientKey, clientSecret, refreshToken, now = Date.now() }) {
  const t = await tokenCall(TIKTOK_TOKEN_URL, {
    client_key: clientKey, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken,
  }, '/v2/oauth/token/');
  if (!t?.access_token) throw new MetaError({ code: 190, message: 'TikTok refresh without access_token', endpoint: '/v2/oauth/token/', source: 'tiktok' });
  const mapped = mapTokens(t, now);
  return { ...mapped, refreshToken: mapped.refreshToken ?? refreshToken };
}

export async function revokeToken({ clientKey, clientSecret, token }) {
  await tokenCall(TIKTOK_REVOKE_URL, { client_key: clientKey, client_secret: clientSecret, token }, '/v2/oauth/revoke/');
  return true;
}
