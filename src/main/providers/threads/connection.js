import { getActiveProfile, upsertProfile, updateProfileToken, deactivateProfiles } from '../../db/queries/profiles.js';
import { upsertAccount, setTrackedAccounts, listAccounts } from '../../db/queries/accounts.js';
import { getSetting, setSetting } from '../../db/queries/settings.js';
import { storeToken, readToken, storeAppSecret, readAppSecret } from '../../config/store.js';
import { MetaError } from '../../meta/errors.js';
import { emitTokenWarning } from '../../sync/progress.js';
import { msg } from '../../i18n.js';
import { threadsClient } from './client.js';
import { exchangeCode, exchangeLongLived, refreshLongLived, extractCode, shouldAutoRefresh, canRefresh, LONG_LIVED_DAYS } from './auth.js';
import { fetchMe } from './api.js';
import { threadsKey } from './mappers.js';

/** Settings keys (the Threads app id lives here until a profile exists). */
export const SETTING_APP_ID = 'threads.appId';
export const SETTING_REDIRECT_URI = 'threads.redirectUri';
export const DEFAULT_REDIRECT_URI = 'https://localhost/';

const DAY_MS = 86_400_000;
const tokenKey = (appId) => `threads:${appId}`;
export const isDemoThreads = (profile) => !!profile && String(profile.token_ref ?? '').startsWith('demo');

export function threadsAppId() {
  return getSetting(SETTING_APP_ID, null) ?? getActiveProfile('threads')?.app_id ?? null;
}

/** Validates and stores the Threads App ID + secret (secret encrypted via storeAppSecret). */
export function saveThreadsApp({ appId, appSecret } = {}) {
  const id = String(appId ?? '').trim();
  const secret = String(appSecret ?? '').trim();
  if (!/^\d{5,}$/.test(id)) throw new Error(msg('threads_app_id_digits'));
  if (secret.length < 16) throw new Error(msg('threads_app_secret_short'));
  setSetting(SETTING_APP_ID, id);
  storeAppSecret(id, secret);
  return { appId: id };
}

export function requireApp() {
  const appId = threadsAppId();
  const appSecret = appId ? readAppSecret(appId) : null;
  if (!appId || !appSecret) throw new Error(msg('threads_app_missing'));
  return { appId, appSecret };
}

export function validRedirectUri(input) {
  const uri = String(input ?? '').trim() || getSetting(SETTING_REDIRECT_URI, null) || DEFAULT_REDIRECT_URI;
  if (!/^https:\/\/\S+$/i.test(uri)) throw new Error(msg('threads_redirect_https'));
  return uri;
}

/** The single Threads account row of the active profile (null when none). */
export function threadsAccount() {
  const profile = getActiveProfile('threads');
  const rows = listAccounts({ onlyTracked: false, platforms: ['threads'] });
  return rows.find((a) => profile && a.profileId === profile.id) ?? rows[0] ?? null;
}

/**
 * Turns a pasted short-lived token or authorization code into a stored long-lived token, creates/updates the Threads
 * profile and the `th-<id>` account (tracked). Returns { expiresAt, username }.
 */
export async function connectThreads({ shortToken, code, redirectUri } = {}, { client = threadsClient, now = Date.now() } = {}) {
  const { appId, appSecret } = requireApp();
  const pastedCode = extractCode(code);
  const pastedToken = String(shortToken ?? '').trim();
  if (!pastedCode && pastedToken.length < 20) throw new Error(msg('threads_token_or_code'));

  let short = pastedToken;
  if (pastedCode) {
    try {
      short = (await exchangeCode({ appId, appSecret, code: pastedCode, redirectUri: validRedirectUri(redirectUri) })).token;
    } catch (e) {
      if (e instanceof MetaError) throw Object.assign(new Error(msg('threads_code_invalid')), { code: e.code, detail: e.message });
      throw e;
    }
  }

  let long;
  try {
    long = await exchangeLongLived({ appSecret, shortToken: short, client, now });
  } catch (e) {
    if (!(e instanceof MetaError)) throw e;
    if (e.isTokenError) throw Object.assign(new Error(msg('threads_token_invalid')), { code: e.code, detail: e.message });
    // Possibly already long-lived (dashboard token generator): keep it if /me accepts it.
    long = { token: short, expiresAt: now + LONG_LIVED_DAYS * DAY_MS };
  }

  let me;
  try {
    me = await fetchMe(long.token, client);
  } catch (e) {
    if (e instanceof MetaError) throw Object.assign(new Error(msg('threads_token_invalid')), { code: e.code, detail: e.message });
    throw e;
  }

  const ref = storeToken(tokenKey(appId), long.token);
  const existing = getActiveProfile('threads');
  const profileId = existing && !isDemoThreads(existing) && existing.app_id === appId
    ? (updateProfileToken(existing.id, ref, long.expiresAt, now), existing.id)
    : upsertProfile({ label: msg('threads_connection'), appId, tokenRef: ref, tokenExpiresAt: long.expiresAt, platform: 'threads', refreshedAt: now });
  const key = threadsKey(me.id);
  upsertAccount({
    igId: key, platform: 'threads', externalId: String(me.id), profileId, username: me.username ?? String(me.id),
    name: me.name ?? null, profilePicUrl: me.threads_profile_picture_url ?? null, biography: me.threads_biography ?? null,
  });
  setTrackedAccounts([key], { platform: 'threads' });
  return { expiresAt: long.expiresAt, username: me.username ?? null };
}

/**
 * Refreshes the active Threads token and stores it. `force` skips the 20-day window (manual refresh) but never the
 * 24-hour minimum age. Returns { expiresAt }.
 */
export async function refreshThreadsToken({ client = threadsClient, now = Date.now() } = {}) {
  const profile = getActiveProfile('threads');
  if (!profile) throw new Error(msg('threads_not_connected'));
  if (isDemoThreads(profile)) return { expiresAt: profile.token_expires_at ?? null };
  if (profile.token_expires_at && profile.token_expires_at <= now) throw new Error(msg('threads_token_expired'));
  if (!canRefresh(profile, now)) throw new Error(msg('threads_refresh_too_early'));
  const token = readToken(profile.token_ref);
  if (!token) throw new Error(msg('threads_token_invalid'));
  const next = await refreshLongLived({ token, client, now });
  updateProfileToken(profile.id, storeToken(tokenKey(profile.app_id), next.token), next.expiresAt, now);
  return { expiresAt: next.expiresAt };
}

/**
 * Scheduler hook: refresh when >24h since the last refresh and <20 days to expiry. A failed refresh (or an expired
 * token) emits token:warning { platform: 'threads' } instead of throwing.
 */
export async function threadsMaintenance({ client = threadsClient, now = Date.now() } = {}) {
  const profile = getActiveProfile('threads');
  if (!profile || isDemoThreads(profile)) return { refreshed: false };
  if (profile.token_expires_at && profile.token_expires_at <= now) {
    emitTokenWarning({ platform: 'threads', code: 190, message: msg('threads_token_expired') });
    return { refreshed: false, expired: true };
  }
  if (!shouldAutoRefresh(profile, now)) return { refreshed: false };
  try {
    const { expiresAt } = await refreshThreadsToken({ client, now });
    return { refreshed: true, expiresAt };
  } catch (e) {
    emitTokenWarning({ platform: 'threads', code: e?.code ?? null, message: msg('threads_refresh_failed', { detail: e?.message ?? String(e) }) });
    return { refreshed: false, error: e?.message ?? String(e) };
  }
}

/** Deactivates the Threads profile, wipes its token and untracks the Threads account (history is kept). */
export function disconnectThreads() {
  const profile = getActiveProfile('threads');
  if (profile && !isDemoThreads(profile) && profile.token_ref) storeToken(String(profile.token_ref).replace(/^token:/, ''), '');
  deactivateProfiles('threads');
  setTrackedAccounts([], { platform: 'threads' });
  return true;
}

export function setThreadsTracked(tracked) {
  const profile = getActiveProfile('threads');
  const account = threadsAccount();
  if (!profile || !account) throw new Error(msg('threads_not_connected'));
  setTrackedAccounts(tracked ? [account.igId] : [], { platform: 'threads' });
  return { tracked: !!tracked };
}

export function threadsState() {
  const profile = getActiveProfile('threads');
  const appId = threadsAppId();
  const account = profile ? threadsAccount() : null;
  const demo = isDemoThreads(profile);
  return {
    hasApp: demo || (!!appId && !!readAppSecret(appId)),
    appId: appId ?? null,
    hasToken: !!profile && (demo || !!readToken(profile.token_ref)),
    expiresAt: profile?.token_expires_at ?? null,
    username: account?.username ?? null,
    tracked: !!account?.isTracked,
  };
}
