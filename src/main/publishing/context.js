import crypto from 'node:crypto';
import { q } from '../db/index.js';
import { getActiveProfile } from '../db/queries/profiles.js';
import { getSetting } from '../db/queries/settings.js';
import { getAccount } from '../db/queries/accounts.js';
import { readToken } from '../config/store.js';
import { metaClient } from '../meta/client.js';
import { MetaError } from '../meta/errors.js';
import { threadsClient } from '../providers/threads/client.js';
import { fetchPageToken } from '../providers/facebook/api.js';
import { publishError } from './errors.js';

/**
 * Token and Page-token resolution for publishing outside sync runs (the orchestrator builds its own ctx per run).
 * ctx = { meta, threads, now(), tokenFor(auth), pageToken(pageId) (async, cached), latestMedia(accountId), account(id) }
 */
const PAGE_TOKEN_TTL_MS = 50 * 60_000;
const pageTokenCache = new Map(); // `${pageId}|${userTokenHash}` → { token, at }

/** Auth profile for a platform: Instagram and Facebook share the Meta login. */
export const authOf = (platform) => (platform === 'threads' ? 'threads' : 'meta');

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/** Demo mode = seeded demo data or a demo Meta profile: the worker uses the simulated publisher. */
export function isDemoMode() {
  const profile = getActiveProfile('meta');
  return !!getSetting('demoMode', false) || (!!profile && String(profile.token_ref).startsWith('demo'));
}

/** Stored token for an auth platform, or null. */
export function readAuthToken(auth) {
  const profile = getActiveProfile(auth);
  return profile ? readToken(profile.token_ref) : null;
}

/** Short fingerprint of the current token (auth-paused targets resume when it changes). */
export function tokenFingerprint(auth) {
  const t = readAuthToken(auth);
  return t ? hash(t) : null;
}

export function clearPageTokenCache() {
  pageTokenCache.clear();
}

/**
 * @param {{ meta?: object, threads?: object, now?: () => number, readTokenFor?: (auth: string) => string|null,
 *   fetchPageTokenImpl?: typeof fetchPageToken }} [opts]
 */
export function createPublishContext({ meta = metaClient, threads = threadsClient, now = Date.now, readTokenFor = readAuthToken, fetchPageTokenImpl = fetchPageToken } = {}) {
  const tokens = new Map();
  const tokenFor = (auth) => {
    if (tokens.has(auth)) return tokens.get(auth);
    const t = readTokenFor(auth);
    if (!t) throw new MetaError({ code: 190, message: `${auth} token missing`, source: auth });
    tokens.set(auth, t);
    return t;
  };

  async function pageToken(pageId) {
    const user = tokenFor('meta');
    const key = `${pageId}|${hash(user)}`;
    const hit = pageTokenCache.get(key);
    if (hit && now() - hit.at < PAGE_TOKEN_TTL_MS) return hit.token;
    let res;
    try {
      res = await fetchPageTokenImpl(pageId, user, meta);
    } catch (e) {
      if (e instanceof MetaError && (e.isPermissionError || e.isInvalidParam)) throw publishError('pub_page_token_missing', { name: pageId }, { kind: 'permission', code: 'page_token_missing' });
      throw e;
    }
    if (!res?.token) throw publishError('pub_page_token_missing', { name: res?.name ?? pageId }, { kind: 'permission', code: 'page_token_missing' });
    pageTokenCache.set(key, { token: res.token, at: now() });
    return res.token;
  }

  const latestMedia = (accountId) => q.get('SELECT media_id AS mediaId, permalink FROM media WHERE ig_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY posted_at DESC LIMIT 1', accountId) ?? null;

  return { meta, threads, now, tokenFor, pageToken, latestMedia, account: getAccount };
}
