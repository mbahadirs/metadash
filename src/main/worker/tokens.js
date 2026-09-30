import { q } from '../db/index.js';
import { getAccount } from '../db/queries/accounts.js';
import { getActiveProfile, profileScopes } from '../db/queries/profiles.js';
import { metaClient } from '../meta/client.js';
import { threadsClient } from '../providers/threads/client.js';
import { readAuthToken, createPublishContext } from '../publishing/context.js';
import { msg } from '../i18n.js';
import {
  grantedScopes, broaderScopes, missingScopes, tokenKeyFor, authOf,
} from '../../shared/publish/index.js';
import { WORKER_PLATFORMS } from '../db/queries/planner.js';

/**
 * "Worker token" flow. Only publishing tokens leave this machine:
 *   Instagram → the Meta user token (or a dedicated token the user pasted), checked with GET /me/permissions
 *   Facebook  → the Page access token of that Page (derived from the user token), never the user token
 *   Threads   → the Threads token (scopes from the stored profile or GET /me validity for a pasted token)
 * Tokens with scopes beyond publishing are refused unless the user ticked "allow broader token".
 * The worker never gets app secrets, AI keys, analytics data or Google/TikTok tokens.
 */
export const EXPIRING_MS = 7 * 86_400_000;

const workerError = (key, code, vars = {}, extra = {}) => Object.assign(new Error(msg(key, vars)), { code, ...extra });

export function listTokenRows() {
  return q.all('SELECT * FROM worker_tokens ORDER BY platform, account_id');
}

export function listWorkerTokens(now = Date.now()) {
  return listTokenRows().map((r) => {
    let scopes = [];
    try { scopes = JSON.parse(r.scopes ?? '[]'); } catch { scopes = []; }
    const expiring = r.expires_at != null && r.expires_at - now < EXPIRING_MS;
    return { tokenKey: r.token_key, platform: r.platform, accountId: r.account_id, scopes, expiresAt: r.expires_at, pushedAt: r.pushed_at, status: r.status === 'ok' && expiring ? 'expiring' : r.status ?? 'ok' };
  });
}

export function upsertTokenRow({ tokenKey, platform, accountId, scopes, expiresAt, pushedAt, status }) {
  q.run(
    `INSERT INTO worker_tokens (token_key, platform, account_id, scopes, expires_at, pushed_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(token_key) DO UPDATE SET platform = excluded.platform, account_id = excluded.account_id, scopes = excluded.scopes,
       expires_at = excluded.expires_at, pushed_at = excluded.pushed_at, status = excluded.status`,
    tokenKey, platform, accountId, JSON.stringify(scopes ?? []), expiresAt ?? null, pushedAt ?? null, status ?? 'ok',
  );
}

export const deleteTokenRow = (tokenKey) => q.run('DELETE FROM worker_tokens WHERE token_key = ?', tokenKey);
export const hasTokenRow = (tokenKey) => !!q.get("SELECT 1 FROM worker_tokens WHERE token_key = ? AND status <> 'invalid'", tokenKey);

/** Granted scopes of a token (null = unknown). */
async function scopesOf(platform, token, { pasted, meta, threads }) {
  if (platform === 'threads') {
    await threads.get('/me', { fields: 'id' }, { token });
    return pasted ? null : profileScopes(getActiveProfile('threads'));
  }
  return grantedScopes(await meta.get('/me/permissions', {}, { token }));
}

/**
 * Pushes the publishing token of one account to the worker.
 * @param {{ accountId: string, token?: string, allowBroader?: boolean }} p
 * @param {{ client: object, meta?: object, threads?: object, now?: number }} deps
 */
export async function pushToken({ accountId, token, allowBroader = false }, { client, meta = metaClient, threads = threadsClient, now = Date.now() }) {
  const account = getAccount(String(accountId ?? ''));
  if (!account) throw workerError('worker_err_account_unknown', 'ACCOUNT_UNKNOWN', { id: accountId });
  if (!WORKER_PLATFORMS.includes(account.platform)) throw workerError('worker_err_platform', 'PLATFORM_UNSUPPORTED', { platform: account.platform });
  const auth = authOf(account.platform);
  const pasted = typeof token === 'string' && token.trim().length > 0;
  const userToken = pasted ? token.trim() : readAuthToken(auth);
  if (!userToken) throw workerError('worker_err_no_token', 'NO_TOKEN');
  const scopes = await scopesOf(account.platform, userToken, { pasted, meta, threads });
  const broader = scopes ? broaderScopes(account.platform, scopes) : [];
  if (broader.length && !allowBroader) throw workerError('worker_err_broad_scopes', 'BROAD_SCOPES', { scopes: broader.join(', ') }, { scopes: broader });
  const missing = scopes ? missingScopes(account.platform, scopes) : [];
  if (missing.length) throw workerError('worker_err_missing_scopes', 'MISSING_SCOPES', { scopes: missing.join(', ') }, { scopes: missing });
  const sendToken = account.platform === 'facebook'
    ? await createPublishContext({ meta, readTokenFor: () => userToken }).pageToken(account.externalId)
    : userToken;
  const profile = pasted ? null : getActiveProfile(auth);
  const expiresAt = profile?.token_expires_at ?? null;
  const tokenKey = tokenKeyFor(account.platform, account.igId);
  const res = await client.putToken(tokenKey, { platform: account.platform, accountId: account.igId, token: sendToken, expiresAt, scopes: scopes ?? [], broad: broader.length > 0 });
  upsertTokenRow({ tokenKey, platform: account.platform, accountId: account.igId, scopes: res?.scopes ?? scopes ?? [], expiresAt: res?.expiresAt ?? expiresAt, pushedAt: now, status: 'ok' });
  return listWorkerTokens(now).find((t) => t.tokenKey === tokenKey);
}

export async function revokeToken(tokenKey, { client }) {
  await client.deleteToken(tokenKey);
  deleteTokenRow(tokenKey);
  return true;
}

/** Folds /v1/info tokens (validity, refreshed expiry) into the local rows. */
export function applyRemoteTokens(remote = []) {
  const byKey = new Map(remote.map((t) => [t.key, t]));
  for (const row of listTokenRows()) {
    const r = byKey.get(row.token_key);
    const status = !r ? 'missing' : r.valid === false ? 'invalid' : 'ok';
    q.run('UPDATE worker_tokens SET status = ?, expires_at = COALESCE(?, expires_at) WHERE token_key = ?', status, r?.expiresAt ?? null, row.token_key);
  }
}
