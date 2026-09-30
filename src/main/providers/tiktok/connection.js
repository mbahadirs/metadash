import { q } from '../../db/index.js';
import { activeProfiles, getProfileById, upsertExternalProfile, updateProfileToken, deactivateProfile } from '../../db/queries/profiles.js';
import { upsertAccount, updateAccount, listAccounts } from '../../db/queries/accounts.js';
import { getSetting, setSetting, deleteSetting } from '../../db/queries/settings.js';
import { storeToken, readToken, storeAppSecret, readAppSecret } from '../../config/store.js';
import { MetaError } from '../../meta/errors.js';
import { emitTokenWarning } from '../../sync/progress.js';
import { startLoopback } from '../../oauth/loopback.js';
import { openAuthUrl } from '../../oauth/openUrl.js';
import { randomState, safeEqual } from '../../oauth/pkce.js';
import { msg } from '../../i18n.js';
import {
  createTikTokPkce, buildAuthUrl, extractCode, exchangeCode, refreshAccessToken, revokeToken, LOOPBACK_PATH, DEFAULT_PASTE_REDIRECT_URI,
} from './auth.js';
import { fetchUserInfo, userFieldsFor } from './api.js';
import { tiktokKey } from './mappers.js';

/**
 * TikTok connections (multi-profile: one `profiles` row per TikTok account, external_id = open_id, account `tt-<open_id>`).
 * Client key in settings, client secret encrypted (storeAppSecret). Access token (24 h) at `token:tiktok:<open_id>`,
 * refresh token (365 d, rotating) at `token:tiktok-refresh:<open_id>`; its expiry in settings `tiktok.refreshExpiresAt.<open_id>`
 * (profiles has no column for it).
 */
export const SETTING_CLIENT_KEY = 'tiktok.clientKey';
export const SETTING_REDIRECT_URI = 'tiktok.redirectUri';
export const SETTING_SANDBOX = 'tiktok.sandbox';
const REFRESH_EXP_PREFIX = 'tiktok.refreshExpiresAt.';
const PENDING_TTL_MS = 15 * 60_000;
const WARN_WITHIN_MS = 7 * 86_400_000;
const WARN_COOLDOWN_MS = 12 * 3_600_000;

const accessKey = (openId) => `tiktok:${openId}`;
const refreshKey = (openId) => `tiktok-refresh:${openId}`;
const secretId = (clientKey) => `tiktok:${clientKey}`;
export const isDemoTikTok = (profile) => !!profile && String(profile.token_ref ?? '').startsWith('demo');
const localized = (key, vars, extra = {}) => Object.assign(new Error(msg(key, vars)), extra);

// ---------- client ----------

export function tiktokClientKey() {
  return getSetting(SETTING_CLIENT_KEY, null);
}

export function pasteRedirectUri() {
  return getSetting(SETTING_REDIRECT_URI, null) || DEFAULT_PASTE_REDIRECT_URI;
}

/**
 * Validates and stores the client key + secret (secret encrypted). Optional: `redirectUri` (https paste-code page;
 * '' resets to the default) and `sandbox` (the key belongs to a TikTok sandbox; default: key starts with "sb").
 */
export function saveTikTokClient({ clientKey, clientSecret, redirectUri, sandbox } = {}) {
  const key = String(clientKey ?? '').trim();
  const secret = String(clientSecret ?? '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw localized('tt_client_key_invalid');
  if (secret.length < 16 || /\s/.test(secret)) throw localized('tt_client_secret_short');
  if (redirectUri !== undefined) {
    const uri = String(redirectUri ?? '').trim();
    if (uri && !/^https:\/\/[^\s?#]+$/i.test(uri)) throw localized('tt_redirect_https');
    if (uri) setSetting(SETTING_REDIRECT_URI, uri);
    else deleteSetting(SETTING_REDIRECT_URI);
  }
  setSetting(SETTING_CLIENT_KEY, key);
  setSetting(SETTING_SANDBOX, sandbox === undefined ? /^sb/i.test(key) : !!sandbox);
  storeAppSecret(secretId(key), secret);
  return { clientKey: key };
}

export function requireClient() {
  const clientKey = tiktokClientKey();
  const clientSecret = clientKey ? readAppSecret(secretId(clientKey)) : null;
  if (!clientKey || !clientSecret) throw localized('tt_client_missing', null, { code: 'TT_CLIENT_MISSING' });
  return { clientKey, clientSecret };
}

// ---------- refresh-token expiry ----------

export function refreshExpiry(openId) {
  const v = Number(getSetting(`${REFRESH_EXP_PREFIX}${openId}`, null));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function setRefreshExpiry(openId, at) {
  if (at == null) deleteSetting(`${REFRESH_EXP_PREFIX}${openId}`);
  else setSetting(`${REFRESH_EXP_PREFIX}${openId}`, Number(at));
}

// ---------- state ----------

const tiktokAccounts = () => listAccounts({ onlyTracked: false, platforms: ['tiktok'], unscoped: true });

function tokenOk(profile, now) {
  if (isDemoTikTok(profile)) return true;
  const exp = refreshExpiry(profile.external_id);
  return !!readToken(profile.token_ref) && !!readToken(profile.refresh_ref) && (exp == null || exp > now);
}

/** setup:tiktok:getState → TikTokSetupState. */
export function tiktokState({ now = Date.now() } = {}) {
  const clientKey = tiktokClientKey();
  const accounts = tiktokAccounts();
  const profiles = activeProfiles('tiktok');
  const demo = profiles.some(isDemoTikTok);
  return {
    hasClient: demo || (!!clientKey && !!readAppSecret(secretId(clientKey))),
    clientKey: clientKey ?? null,
    sandbox: !!getSetting(SETTING_SANDBOX, false),
    redirectUri: pasteRedirectUri(),
    accounts: profiles.flatMap((p) => {
      const a = accounts.find((x) => x.profileId === p.id);
      if (!a) return [];
      return [{
        accountId: a.igId, profileId: p.id, username: a.username, displayName: a.name ?? null, avatar: a.profilePicUrl ?? null,
        followers: a.followers ?? null, tracked: !!a.isTracked, tokenOk: tokenOk(p, now), expiresAt: p.token_expires_at ?? null,
        refreshExpiresAt: isDemoTikTok(p) ? null : refreshExpiry(p.external_id),
      }];
    }),
  };
}

// ---------- connect ----------

const pending = new Map(); // state → { verifier, redirectUri, createdAt }

function prunePending(now) {
  for (const [s, p] of pending) if (now - p.createdAt > PENDING_TTL_MS) pending.delete(s);
  while (pending.size > 5) pending.delete(pending.keys().next().value);
}

/** Paste-code flow, step 1: authorize URL for the https callback page. → { url, state } */
export function tiktokAuthUrl({ now = Date.now() } = {}) {
  const { clientKey } = requireClient();
  prunePending(now);
  const redirectUri = pasteRedirectUri();
  const pkce = createTikTokPkce();
  const state = randomState();
  pending.set(state, { verifier: pkce.verifier, redirectUri, createdAt: now });
  return { url: buildAuthUrl({ clientKey, redirectUri, state, challenge: pkce.challenge }), state };
}

/** Paste-code flow, step 2: `code` = the bare code or the whole redirect URL; `state` = the one authUrl returned. */
export async function exchangeTikTokCode({ code, state } = {}, { now = Date.now() } = {}) {
  const { clientKey, clientSecret } = requireClient();
  const parsed = extractCode(code);
  if (!parsed) throw localized('tt_no_code');
  const expected = String(state ?? '');
  if (parsed.state && !safeEqual(parsed.state, expected)) throw localized('tt_state_mismatch');
  prunePending(now);
  const entry = [...pending.entries()].find(([s]) => safeEqual(s, expected))?.[1];
  if (!entry) throw localized('tt_state_expired');
  pending.delete(expected);
  return finishConnect({ clientKey, clientSecret, code: parsed.code, redirectUri: entry.redirectUri, verifier: entry.verifier, now });
}

let activeLoopback = null;

const OAUTH_MESSAGES = {
  cancelled: () => msg('tt_oauth_cancelled'),
  timeout: () => msg('tt_oauth_timeout'),
  access_denied: () => msg('tt_oauth_denied'),
  state_mismatch: () => msg('tt_state_mismatch'),
};

/** Loopback flow (primary): opens the browser and waits for http://127.0.0.1:<port>/callback/. → { accountId, username } */
export async function connectTikTokLoopback({ timeoutMs = 300_000, lang } = {}) {
  if (activeLoopback) throw localized('tt_connect_busy', null, { code: 'BUSY' });
  const { clientKey, clientSecret } = requireClient();
  const lb = await startLoopback({ path: LOOPBACK_PATH, timeoutMs, lang });
  activeLoopback = lb;
  try {
    const pkce = createTikTokPkce();
    const state = randomState();
    const wait = lb.waitForCode(state);
    await openAuthUrl(buildAuthUrl({ clientKey, redirectUri: lb.redirectUri, state, challenge: pkce.challenge }));
    let code;
    try {
      ({ code } = await wait);
    } catch (e) {
      const text = OAUTH_MESSAGES[e?.code]?.() ?? msg('tt_oauth_failed', { detail: e?.message ?? String(e) });
      throw Object.assign(new Error(text), { code: e?.code ?? 'oauth_error' });
    }
    return await finishConnect({ clientKey, clientSecret, code, redirectUri: lb.redirectUri, verifier: pkce.verifier });
  } finally {
    activeLoopback = null;
    lb.cancel();
  }
}

export function cancelTikTokConnect() {
  if (!activeLoopback) return false;
  activeLoopback.cancel();
  return true;
}

async function finishConnect({ clientKey, clientSecret, code, redirectUri, verifier, now = Date.now() }) {
  let tokens;
  try {
    tokens = await exchangeCode({ clientKey, clientSecret, code, redirectUri, codeVerifier: verifier, now });
  } catch (e) {
    if (!(e instanceof MetaError)) throw e;
    const key = e.vendorCode === 'invalid_client' ? 'tt_client_invalid' : 'tt_code_invalid';
    throw localized(key, { detail: e.message }, { code: e.code, vendorCode: e.vendorCode, logId: e.logId });
  }
  const scopes = tokens.scopes;
  const user = await fetchUserInfo(tokens.accessToken, userFieldsFor(scopes));
  const openId = String(user.open_id ?? tokens.openId ?? '');
  if (!openId) throw localized('tt_no_open_id');
  const profileId = upsertExternalProfile({
    platform: 'tiktok', externalId: openId, label: user.display_name || user.username || openId, appId: clientKey,
    tokenRef: storeToken(accessKey(openId), tokens.accessToken), tokenExpiresAt: tokens.expiresAt,
    refreshRef: tokens.refreshToken ? storeToken(refreshKey(openId), tokens.refreshToken) : null,
    scopes: scopes.length ? scopes : null, refreshedAt: now,
  });
  setRefreshExpiry(openId, tokens.refreshExpiresAt);
  const key = tiktokKey(openId);
  const username = user.username || user.display_name || openId;
  upsertAccount({
    igId: key, platform: 'tiktok', externalId: openId, profileId, username, name: user.display_name ?? null,
    profilePicUrl: user.avatar_url ?? null, biography: user.bio_description ?? null, website: user.profile_deep_link ?? null,
  });
  updateAccount(key, { isTracked: true });
  return { accountId: key, username };
}

// ---------- refresh / maintenance ----------

/** provider.refreshToken: refreshes the access token of a TikTok profile row; stores the (possibly rotated) refresh token. */
export async function refreshTikTokProfile(profile, { now = Date.now() } = {}) {
  if (isDemoTikTok(profile)) return { token: 'demo', expiresAt: now + 86_400_000 };
  const authError = (key) => new MetaError({ code: 190, message: msg(key), source: 'tiktok', endpoint: '/v2/oauth/token/' });
  const clientKey = profile?.app_id;
  const clientSecret = clientKey ? readAppSecret(secretId(clientKey)) : null;
  if (!clientSecret) throw authError('tt_client_missing');
  const refreshToken = profile.refresh_ref ? readToken(profile.refresh_ref) : null;
  if (!refreshToken) throw authError('tt_refresh_expired');
  const t = await refreshAccessToken({ clientKey, clientSecret, refreshToken, now });
  const openId = String(profile.external_id);
  const ref = storeToken(accessKey(openId), t.accessToken);
  if (t.refreshToken && t.refreshToken !== refreshToken) {
    const rRef = storeToken(refreshKey(openId), t.refreshToken);
    if (rRef !== profile.refresh_ref) q.run('UPDATE profiles SET refresh_ref = ? WHERE id = ?', rRef, profile.id);
  }
  if (t.refreshExpiresAt) setRefreshExpiry(openId, t.refreshExpiresAt);
  updateProfileToken(profile.id, ref, t.expiresAt, now);
  return { token: t.accessToken, expiresAt: t.expiresAt, refreshToken: t.refreshToken };
}

const warned = new Map(); // profileId → last warning ms

/**
 * Scheduler hook: warns (token:warning, per account) when a refresh token has expired or expires within 7 days.
 * Access tokens are refreshed on demand by the sync (ctx.tokenForAccount); refresh tokens only by reconnecting.
 */
export async function tiktokMaintenance({ now = Date.now() } = {}) {
  const accounts = tiktokAccounts();
  let warnings = 0;
  for (const p of activeProfiles('tiktok')) {
    if (isDemoTikTok(p)) continue;
    const exp = refreshExpiry(p.external_id);
    const missing = !p.refresh_ref || !readToken(p.refresh_ref);
    const expired = missing || (exp != null && exp <= now);
    const soon = !expired && exp != null && exp - now < WARN_WITHIN_MS;
    if (!expired && !soon) continue;
    if (now - (warned.get(p.id) ?? 0) < WARN_COOLDOWN_MS) continue;
    warned.set(p.id, now);
    const account = accounts.find((a) => a.profileId === p.id);
    const days = exp != null ? Math.max(0, Math.ceil((exp - now) / 86_400_000)) : 0;
    emitTokenWarning({
      platform: 'tiktok', code: 190, profileId: p.id, accountId: account?.igId ?? null,
      message: expired ? msg('tt_refresh_expired') : msg('tt_refresh_expiring', { n: days, u: account?.username ?? p.label ?? '' }),
    });
    warnings += 1;
  }
  return { warnings };
}

// ---------- tracking / disconnect ----------

/** setup:tiktok:saveTracked: exactly these TikTok accounts are tracked (other platforms untouched). */
export function setTikTokTracked(accountIds = []) {
  const wanted = new Set((accountIds ?? []).map(String));
  const kept = [];
  for (const a of tiktokAccounts()) {
    const on = wanted.has(a.igId);
    if (on) kept.push(a.igId);
    if (a.isTracked !== on) updateAccount(a.igId, { isTracked: on });
  }
  return { accountIds: kept };
}

/** Deletes everything stored for one account key (posts, snapshots, daily series, tags, notes, the account row). */
export function deleteAccountData(key) {
  q.tx(() => {
    const inMedia = 'SELECT media_id FROM media WHERE ig_id = ?';
    q.run(`DELETE FROM comments WHERE media_id IN (${inMedia}) OR account_id = ?`, key, key);
    q.run(`DELETE FROM media_insight_snapshots WHERE media_id IN (${inMedia})`, key);
    q.run(`DELETE FROM media_latest WHERE media_id IN (${inMedia})`, key);
    q.run('DELETE FROM media WHERE ig_id = ?', key);
    for (const t of ['account_snapshots', 'account_insights_daily', 'account_demographics', 'account_tags', 'account_logos']) q.run(`DELETE FROM ${t} WHERE ig_id = ?`, key);
    q.run('DELETE FROM notes WHERE entity_id = ?', key);
    q.run('DELETE FROM accounts WHERE ig_id = ?', key);
  })();
}

/**
 * setup:tiktok:disconnect: revokes the access token (best effort), wipes both tokens, deactivates the profile and
 * untracks its account — or, with deleteData, deletes the account's stored data.
 */
export async function disconnectTikTok({ profileId, deleteData = false } = {}) {
  const profile = getProfileById(Number(profileId));
  if (!profile || profile.platform !== 'tiktok') throw localized('tt_not_connected');
  const openId = String(profile.external_id ?? '');
  if (!isDemoTikTok(profile)) {
    const token = readToken(profile.token_ref);
    const clientKey = profile.app_id;
    const clientSecret = clientKey ? readAppSecret(secretId(clientKey)) : null;
    if (token && clientSecret) {
      try {
        await revokeToken({ clientKey, clientSecret, token });
      } catch (e) {
        console.warn(`[tiktok] revoke failed for profile ${profile.id}: ${e?.message ?? e}`);
      }
    }
    if (profile.token_ref) storeToken(String(profile.token_ref).replace(/^token:/, ''), '');
    if (profile.refresh_ref) storeToken(String(profile.refresh_ref).replace(/^token:/, ''), '');
    setRefreshExpiry(openId, null);
  }
  deactivateProfile(profile.id);
  for (const a of tiktokAccounts().filter((x) => x.profileId === profile.id)) {
    if (deleteData) deleteAccountData(a.igId);
    else updateAccount(a.igId, { isTracked: false });
  }
  return true;
}

