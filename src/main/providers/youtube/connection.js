import { q } from '../../db/index.js';
import { activeProfiles, getProfileById, upsertExternalProfile, updateProfileToken, deactivateProfile, profileScopes } from '../../db/queries/profiles.js';
import { upsertAccount, listAccounts, setTrackedAccounts, updateAccount } from '../../db/queries/accounts.js';
import { getSetting, setSetting } from '../../db/queries/settings.js';
import { storeToken, readToken, storeAppSecret, readAppSecret } from '../../config/store.js';
import { MetaError } from '../../meta/errors.js';
import { emitTokenWarning } from '../../sync/progress.js';
import { msg } from '../../i18n.js';
import { createPkce, randomState } from '../../oauth/pkce.js';
import { startLoopback, OAuthError } from '../../oauth/loopback.js';
import { openAuthUrl } from '../../oauth/openUrl.js';
import { buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken, hasReplyScope } from './auth.js';
import { createYtClient, fetchMyChannel } from './api.js';
import { quotaKeyFor, quotaState, pruneOldQuota } from './quota.js';
import { mapChannel, accountKey } from './mappers.js';

/**
 * YouTube connections: the user's own Google Cloud OAuth client (Desktop app), one `profiles` row per channel
 * (platform 'google', external_id = channel id, app_id = client id, scopes JSON), tokens encrypted via config/store:
 * access `token:google:<channelId>`, refresh `token:google-refresh:<channelId>`, client secret `token:secret:google:<clientId>`.
 */
export const SETTING_CLIENT_ID = 'youtube.clientId';
export const STALE_DAYS = 30;
const DAY = 86_400_000;
const CLIENT_ID_RE = /^[\w.-]+\.apps\.googleusercontent\.com$/;
const accessKey = (channelId) => `google:${channelId}`;
const refreshKey = (channelId) => `google-refresh:${channelId}`;
const secretKey = (clientId) => `google:${clientId}`;

export const isDemoGoogle = (profile) => !!profile && String(profile.token_ref ?? '').startsWith('demo');

export function youtubeClientId() {
  return getSetting(SETTING_CLIENT_ID, null) ?? activeProfiles('google').find((p) => !isDemoGoogle(p))?.app_id ?? null;
}

/** Validates and stores the OAuth client (id in settings, secret encrypted). */
export function saveClient({ clientId, clientSecret } = {}) {
  const id = String(clientId ?? '').trim();
  const secret = String(clientSecret ?? '').trim();
  if (!CLIENT_ID_RE.test(id)) throw new Error(msg('yt_client_id_invalid'));
  if (secret.length < 10) throw new Error(msg('yt_client_secret_short'));
  setSetting(SETTING_CLIENT_ID, id);
  storeAppSecret(secretKey(id), secret);
  return { clientId: id };
}

export function requireClient() {
  const clientId = youtubeClientId();
  const clientSecret = clientId ? readAppSecret(secretKey(clientId)) : null;
  if (!clientId || !clientSecret) throw new Error(msg('yt_client_missing'));
  return { clientId, clientSecret };
}

const OAUTH_MESSAGES = { access_denied: 'yt_connect_denied', timeout: 'yt_connect_timeout', cancelled: 'yt_connect_cancelled', state_mismatch: 'yt_connect_failed', no_code: 'yt_connect_failed', oauth_error: 'yt_connect_failed' };

let pending = null;

/** Cancels a running connect (its loopback rejects with 'cancelled'). */
export function cancelConnect() {
  pending?.cancel();
  pending = null;
  return true;
}

/** Stores tokens + profile + account for a channel; returns { profileId, key }. */
export function saveChannel({ channel, clientId, tokens, now = Date.now() }) {
  const ch = mapChannel(channel);
  const tokenRef = storeToken(accessKey(ch.channelId), tokens.accessToken);
  const refreshRef = tokens.refreshToken ? storeToken(refreshKey(ch.channelId), tokens.refreshToken) : null;
  const profileId = upsertExternalProfile({
    platform: 'google', externalId: ch.channelId, label: ch.name ?? ch.username, appId: clientId, tokenRef, tokenExpiresAt: tokens.expiresAt,
    refreshRef, scopes: tokens.scopes ?? undefined, refreshedAt: now,
  });
  const key = accountKey(ch.channelId);
  const existing = listAccounts({ onlyTracked: false, platforms: ['youtube'], unscoped: true }).some((a) => a.igId === key);
  upsertAccount({
    igId: key, platform: 'youtube', externalId: ch.channelId, profileId, username: ch.username, name: ch.name,
    profilePicUrl: ch.profilePicUrl, biography: ch.biography, website: ch.website,
  });
  if (!existing) updateAccount(key, { isTracked: true });
  return { profileId, key, channel: ch };
}

/**
 * Connect a channel: loopback + PKCE consent in the system browser (channel picked on Google's screen), code exchange,
 * channels.list mine=true. `reply: true` also asks for youtube.force-ssl (inbox replies / moderation).
 * Blocks until the browser returns (5 min timeout) or cancelConnect(). Returns { accountId, title }.
 */
export async function connectChannel({ reply = false } = {}, { open = openAuthUrl, fetchImpl, timeoutMs, lang, now = Date.now } = {}) {
  const { clientId, clientSecret } = requireClient();
  cancelConnect();
  const lb = await startLoopback({ lang, ...(timeoutMs ? { timeoutMs } : {}) });
  pending = lb;
  try {
    const pkce = createPkce();
    const state = randomState();
    const wait = lb.waitForCode(state);
    await open(buildAuthUrl({ clientId, redirectUri: lb.redirectUri, challenge: pkce.challenge, state, reply }));
    const { code } = await wait;
    const tokens = await exchangeCode({ clientId, clientSecret, code, verifier: pkce.verifier, redirectUri: lb.redirectUri, fetchImpl, now: now() });
    const channel = await fetchMyChannel(createYtClient({ token: tokens.accessToken, quotaKey: quotaKeyFor(clientId), fetchImpl }));
    if (!channel) throw new Error(msg('yt_no_channel'));
    const { key, channel: ch } = saveChannel({ channel, clientId, tokens, now: now() });
    return { accountId: key, title: ch.name ?? ch.username };
  } catch (e) {
    if (e instanceof OAuthError) throw Object.assign(new Error(msg(OAUTH_MESSAGES[e.code] ?? 'yt_connect_failed', { detail: e.message })), { code: e.code });
    if (e instanceof MetaError && e.isTokenError) throw Object.assign(new Error(msg('yt_connect_failed', { detail: e.message })), { code: 'OAUTH_EXCHANGE' });
    throw e;
  } finally {
    if (pending === lb) pending = null;
    lb.cancel();
  }
}

/**
 * provider.refreshToken: refresh token → new access token, stored on the profile. invalid_grant (revoked, expired
 * "Testing" token, unused 6 months) → MetaError 190 source 'google' (orchestrator: token:warning for that channel only).
 */
export async function refreshProfileToken(profile, { fetchImpl, now = Date.now() } = {}) {
  if (!profile) throw new MetaError({ code: 190, message: 'google profile missing', source: 'google' });
  if (isDemoGoogle(profile)) return { token: 'demo', expiresAt: now + 3_600_000 };
  const refreshToken = profile.refresh_ref ? readToken(profile.refresh_ref) : null;
  const clientSecret = profile.app_id ? readAppSecret(secretKey(profile.app_id)) : null;
  if (!refreshToken) throw new MetaError({ code: 190, message: 'google refresh token missing', source: 'google' });
  const next = await refreshAccessToken({ clientId: profile.app_id, clientSecret, refreshToken, fetchImpl, now });
  const ref = storeToken(accessKey(profile.external_id), next.accessToken);
  updateProfileToken(profile.id, ref, next.expiresAt, now);
  if (next.refreshToken) storeToken(refreshKey(profile.external_id), next.refreshToken);
  return { token: next.accessToken, expiresAt: next.expiresAt, ...(next.refreshToken ? { refreshToken: next.refreshToken } : {}) };
}

const tableColumns = (table) => {
  try { return q.all(`PRAGMA table_info(${table})`).map((c) => c.name); } catch { return []; }
};
const tables = () => q.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);

/**
 * Deletes everything stored for one account key (YouTube API Services policy: delete API data on revoke/disconnect).
 * Order respects foreign keys: comment children → comments → media children → media → account children → account.
 */
export function deleteAccountData(key) {
  const all = tables();
  const has = (t, c) => all.includes(t) && tableColumns(t).includes(c);
  const mediaIds = q.all('SELECT media_id FROM media WHERE ig_id = ?', key).map((r) => r.media_id);
  const tx = q.tx(() => {
    const inMedia = `SELECT media_id FROM media WHERE ig_id = ?`;
    const commentSel = `SELECT comment_id FROM comments WHERE media_id IN (${inMedia})${has('comments', 'account_id') ? ' OR account_id = ?' : ''}`;
    const commentArgs = has('comments', 'account_id') ? [key, key] : [key];
    for (const t of all) {
      if (t !== 'comments' && has(t, 'comment_id')) q.run(`DELETE FROM ${t} WHERE comment_id IN (${commentSel})`, ...commentArgs);
    }
    if (all.includes('comments')) q.run(`DELETE FROM comments WHERE comment_id IN (${commentSel})`, ...commentArgs);
    for (const t of all) {
      if (t !== 'media' && t !== 'comments' && has(t, 'media_id')) q.run(`DELETE FROM ${t} WHERE media_id IN (${inMedia})`, key);
    }
    if (has('notes', 'entity_id')) {
      q.run('DELETE FROM notes WHERE entity_id = ?', key);
      for (const id of mediaIds) q.run('DELETE FROM notes WHERE entity_id = ?', id);
    }
    q.run('DELETE FROM media WHERE ig_id = ?', key);
    for (const t of all) {
      if (t === 'accounts') continue;
      if (has(t, 'ig_id')) q.run(`DELETE FROM ${t} WHERE ig_id = ?`, key);
      if (['inbox_cursor', 'worker_tokens'].includes(t) && has(t, 'account_id')) q.run(`DELETE FROM ${t} WHERE account_id = ?`, key);
    }
    q.run('DELETE FROM accounts WHERE ig_id = ?', key);
  });
  tx();
}

/**
 * Disconnects one channel: revokes the grant (best effort), wipes its tokens, deactivates the profile; with
 * `deleteData` (default) also deletes the channel's stored data, otherwise only untracks it.
 */
export async function disconnectChannel({ profileId, deleteData = true } = {}, { fetchImpl } = {}) {
  const profile = getProfileById(Number(profileId));
  if (!profile || profile.platform !== 'google') throw new Error(msg('yt_not_connected'));
  if (!isDemoGoogle(profile)) {
    const token = (profile.refresh_ref && readToken(profile.refresh_ref)) || readToken(profile.token_ref);
    if (token) await revokeToken(token, { fetchImpl });
    storeToken(accessKey(profile.external_id), '');
    storeToken(refreshKey(profile.external_id), '');
  }
  deactivateProfile(profile.id);
  const accounts = listAccounts({ onlyTracked: false, platforms: ['youtube'], unscoped: true }).filter((a) => a.profileId === profile.id);
  for (const a of accounts) {
    if (deleteData) deleteAccountData(a.igId);
    else updateAccount(a.igId, { isTracked: false });
  }
  return true;
}

/** Tracked set of YouTube channels (other platforms untouched). */
export function saveTracked({ accountIds } = {}) {
  if (!Array.isArray(accountIds) || accountIds.some((id) => typeof id !== 'string')) throw new Error(msg('yt_invalid_accounts'));
  const known = new Set(listAccounts({ onlyTracked: false, platforms: ['youtube'], unscoped: true }).map((a) => a.igId));
  const ids = [...new Set(accountIds)].filter((id) => known.has(id));
  setTrackedAccounts(ids, { platform: 'youtube' });
  return { accountIds: ids };
}

/** setup:youtube:getState → YouTubeSetupState. */
export function youtubeState({ now = Date.now() } = {}) {
  const clientId = youtubeClientId();
  const accounts = listAccounts({ onlyTracked: false, platforms: ['youtube'], unscoped: true });
  const channels = activeProfiles('google').map((p) => {
    const a = accounts.find((x) => x.profileId === p.id) ?? null;
    const demo = isDemoGoogle(p);
    return {
      accountId: a?.igId ?? accountKey(p.external_id),
      profileId: p.id,
      title: a?.name ?? p.label ?? p.external_id,
      handle: a?.username && a.username !== a.name && !/\s/.test(a.username) ? `@${a.username.replace(/^@/, '')}` : null,
      thumbnail: a?.profilePicUrl ?? null,
      subscribers: a?.followers ?? null,
      tracked: !!a?.isTracked,
      tokenOk: demo || !!(p.refresh_ref && readToken(p.refresh_ref)) || (!!readToken(p.token_ref) && (p.token_expires_at ?? 0) > now),
      canReply: demo || hasReplyScope(profileScopes(p)),
      expiresAt: p.token_expires_at ?? null,
    };
  });
  const hasSecret = !!clientId && !!readAppSecret(secretKey(clientId));
  return { hasClient: hasSecret, clientId: clientId ?? null, channels, quota: clientId ? quotaState(quotaKeyFor(clientId), now) : null };
}

const warnedStale = new Set();

/**
 * Scheduler hook (provider.maintenance): YouTube API Services policy — API data must be refreshed or deleted within
 * 30 days. Channels whose data was not refreshed for 30 days get one token:warning per process (reconnect/sync or
 * disconnect + delete). Also prunes the quota ledger.
 */
export async function youtubeMaintenance({ now = Date.now() } = {}) {
  pruneOldQuota(now);
  const stale = listAccounts({ onlyTracked: false, platforms: ['youtube'], unscoped: true })
    .filter((a) => a.lastSyncedAt && now - a.lastSyncedAt > STALE_DAYS * DAY);
  for (const a of stale) {
    if (warnedStale.has(a.igId)) continue;
    const profile = a.profileId != null ? getProfileById(a.profileId) : null;
    if (isDemoGoogle(profile)) continue;
    warnedStale.add(a.igId);
    emitTokenWarning({ platform: 'google', code: 'YT_STALE', message: msg('yt_stale_data', { name: a.name ?? a.username, days: STALE_DAYS }), accountId: a.igId, profileId: a.profileId ?? null });
  }
  return { stale: stale.map((a) => a.igId) };
}

/** Test hook. */
export function __resetYouTubeConnectionForTests() {
  warnedStale.clear();
  cancelConnect();
}
