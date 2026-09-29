import { MetaError, NetworkError } from '../../meta/errors.js';
import { threadsClient, THREADS_HOST, THREADS_AUTHORIZE_URL, THREADS_SCOPES } from './client.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Long-lived tokens live 60 days (from issue or last refresh). */
export const LONG_LIVED_DAYS = 60;
/** Threads only refreshes a long-lived token that is at least 24 hours old and not expired. */
export const MIN_REFRESH_AGE_MS = 24 * HOUR_MS;
/** Auto-refresh once the token expires within this window. */
export const REFRESH_WITHIN_MS = 20 * DAY_MS;

/**
 * v1.4 publishing scopes: threads_content_publish (posts) + threads_manage_replies (first comment as a reply). Opt-in
 * (`publish: true`) because an app whose Threads use case lacks these permissions gets an error on the authorize page.
 */
export const THREADS_PUBLISH_SCOPES = Object.freeze(['threads_content_publish', 'threads_manage_replies']);

/** Authorization window URL (user logs in on threads.com and is redirected to `redirectUri?code=…`). */
export function buildAuthUrl({ appId, redirectUri, state, publish = false }) {
  const url = new URL(THREADS_AUTHORIZE_URL);
  url.searchParams.set('client_id', String(appId));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', [...THREADS_SCOPES, ...(publish ? THREADS_PUBLISH_SCOPES : [])].join(','));
  url.searchParams.set('response_type', 'code');
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Accepts a bare code, a code with the trailing `#_` Threads appends, or the whole redirect URL the user copied from
 * the address bar. Returns the code or null.
 */
export function extractCode(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  let code = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      code = new URL(raw).searchParams.get('code') ?? '';
    } catch {
      return null;
    }
  }
  code = code.replace(/#_?$/, '').trim();
  return code || null;
}

/**
 * Authorization code → short-lived token. `POST https://graph.threads.net/oauth/access_token` (unversioned) with
 * client_id, client_secret, code, grant_type=authorization_code, redirect_uri. Codes are valid 1 hour, single use.
 * @returns {Promise<{ token: string, userId: string|null }>}
 */
export async function exchangeCode({ appId, appSecret, code, redirectUri }) {
  const url = new URL(`${THREADS_HOST}/oauth/access_token`);
  const params = { client_id: appId, client_secret: appSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new NetworkError(e?.message ?? 'network error', '/oauth/access_token');
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || body?.error || !body?.access_token) {
    throw new MetaError({
      code: body?.error?.code ?? res.status, subcode: body?.error?.error_subcode, type: body?.error?.type,
      message: body?.error?.message ?? `HTTP ${res.status}`, endpoint: '/oauth/access_token', status: res.status, source: 'threads',
    });
  }
  return { token: body.access_token, userId: body.user_id != null ? String(body.user_id) : null };
}

const expiresAtFrom = (expiresIn, now) => now + (Number(expiresIn) > 0 ? Number(expiresIn) * 1000 : LONG_LIVED_DAYS * DAY_MS);

/**
 * Short-lived → long-lived (60 days). `GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret&access_token`.
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
export async function exchangeLongLived({ appSecret, shortToken, client = threadsClient, now = Date.now() }) {
  const body = await client.get(`${THREADS_HOST}/access_token`, { grant_type: 'th_exchange_token', client_secret: appSecret, access_token: shortToken });
  return { token: body.access_token, expiresAt: expiresAtFrom(body.expires_in, now) };
}

/**
 * Refreshes a long-lived token for another 60 days. `GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token`.
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
export async function refreshLongLived({ token, client = threadsClient, now = Date.now() }) {
  const body = await client.get(`${THREADS_HOST}/refresh_access_token`, { grant_type: 'th_refresh_token', access_token: token });
  return { token: body.access_token ?? token, expiresAt: expiresAtFrom(body.expires_in, now) };
}

/** Age base for the 24-hour rule: last refresh, else the profile's creation. */
export function tokenIssuedAt(profile) {
  return profile?.refreshed_at ?? profile?.created_at ?? null;
}

/** True once the token is ≥24h old (refresh is allowed) and not expired. */
export function canRefresh(profile, now = Date.now()) {
  const issued = tokenIssuedAt(profile);
  const expires = profile?.token_expires_at ?? null;
  if (expires && expires <= now) return false;
  return issued == null || now - issued >= MIN_REFRESH_AGE_MS;
}

/**
 * Auto-refresh rule used by maintenance(): refresh when more than 24h have passed since the last refresh AND the token
 * expires within 20 days (and has not expired yet). Unknown expiry → refresh once it is refreshable.
 */
export function shouldAutoRefresh(profile, now = Date.now()) {
  if (!profile || !canRefresh(profile, now)) return false;
  const issued = tokenIssuedAt(profile);
  if (issued != null && now - issued <= MIN_REFRESH_AGE_MS) return false;
  const expires = profile.token_expires_at ?? null;
  return expires == null || expires - now < REFRESH_WITHIN_MS;
}
