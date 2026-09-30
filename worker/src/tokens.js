import { GRAPH_BASE, THREADS_BASE, createFetchGraphClient, grantedScopes, broaderScopes, missingScopes, publishError } from './shared.js';
import { openTokenEnvelope } from './crypto.js';

/**
 * Token vault. Tokens arrive sealed with K_tok (AAD = token key), are checked, then stored re-sealed with the data key.
 * Plaintext tokens only exist in memory for the duration of a Graph call.
 *
 * Strict scopes (MD_STRICT_SCOPES=1, default): Instagram tokens (Meta user tokens) are re-checked with
 * GET /me/permissions; a token with scopes beyond publishing is refused unless the desktop sent `broad: true` (the user
 * ticked "allow broader token"). Facebook Page tokens and Threads tokens are checked with GET /me (valid token).
 * Threads tokens are refreshed (th_refresh_token) at most once a day when they expire within 20 days.
 */
export const THREADS_REFRESH_BEFORE_MS = 20 * 86_400_000;
export const THREADS_REFRESH_EVERY_MS = 86_400_000;
const PLATFORMS = new Set(['instagram', 'facebook', 'threads']);

export class TokenRejected extends Error {
  constructor(code, message, extra = {}) {
    super(message ?? code);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * @param {{ store: object, vault: object, getSecret: () => string, fetchImpl?: typeof fetch, now?: () => number,
 *   strictScopes?: boolean, log: object }} opts
 */
export function createTokenVault({ store, vault, getSecret, fetchImpl = globalThis.fetch, now = Date.now, strictScopes = true, log }) {
  const meta = createFetchGraphClient({ base: GRAPH_BASE, name: 'meta', fetchImpl });
  const threads = createFetchGraphClient({ base: THREADS_BASE, name: 'threads', fetchImpl });

  async function check(platform, token, declared, broad) {
    if (!strictScopes) return declared;
    try {
      if (platform === 'instagram') {
        const scopes = grantedScopes(await meta.get('/me/permissions', {}, { token }));
        const extra = broaderScopes(platform, scopes);
        if (extra.length && !broad) throw new TokenRejected('broad_scopes', 'token has scopes beyond publishing', { scopes: extra });
        const missing = missingScopes(platform, scopes);
        if (missing.length) throw new TokenRejected('missing_scopes', 'token lacks publishing scopes', { scopes: missing });
        return scopes;
      }
      await (platform === 'threads' ? threads : meta).get('/me', { fields: 'id' }, { token });
      return declared;
    } catch (e) {
      if (e instanceof TokenRejected) throw e;
      if (e?.name === 'MetaError') throw new TokenRejected('token_invalid', 'token rejected by Meta', { metaCode: e.code });
      throw new TokenRejected('check_failed', 'could not verify the token with Meta');
    }
  }

  /** PUT /v1/tokens/:key. Throws TokenRejected. */
  async function accept(key, { platform, accountId, envelope, expiresAt = null, scopes = [], broad = false }) {
    if (!PLATFORMS.has(platform) || !key.startsWith(`${platform}:`)) throw new TokenRejected('bad_platform', 'platform not supported by the worker');
    let token;
    try { token = openTokenEnvelope(getSecret(), envelope, key); } catch { throw new TokenRejected('bad_envelope', 'envelope could not be opened'); }
    const checked = await check(platform, token, Array.isArray(scopes) ? scopes.map(String).slice(0, 50) : [], broad === true);
    const stored = {
      platform, accountId: String(accountId), sealed: vault.seal(token, key), expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
      scopes: checked, broad: broad === true, valid: true, receivedAt: now(), refreshedAt: null, refreshTriedAt: null,
    };
    store.putToken(key, stored);
    log.info('token stored', { tokenKey: key.split(':')[0], expires: stored.expiresAt });
    return describe(key, stored);
  }

  const describe = (key, t) => ({ key, platform: t.platform, accountId: t.accountId, expiresAt: t.expiresAt, valid: t.valid !== false, scopes: t.scopes ?? [] });

  /** Plaintext token for a publish call. Throws an auth-kind PublishError when missing/invalid. */
  function tokenFor(key) {
    const t = store.getToken(key);
    if (!t) throw publishError('worker_token_missing', {}, { kind: 'auth', code: 'token_missing' });
    if (t.valid === false) throw publishError('worker_token_invalid', {}, { kind: 'auth', code: 'token_invalid' });
    return vault.open(t.sealed, key);
  }

  function markInvalid(key) {
    const t = store.getToken(key);
    if (t && t.valid !== false) store.putToken(key, { ...t, valid: false });
  }

  async function refreshThreads() {
    let refreshed = 0;
    for (const t of store.listTokens()) {
      if (t.platform !== 'threads' || t.valid === false || t.expiresAt == null) continue;
      if (t.expiresAt - now() > THREADS_REFRESH_BEFORE_MS) continue;
      if (t.refreshTriedAt && now() - t.refreshTriedAt < THREADS_REFRESH_EVERY_MS) continue;
      const { key, ...rest } = t;
      try {
        const body = await threads.get('https://graph.threads.net/refresh_access_token', { grant_type: 'th_refresh_token' }, { token: vault.open(rest.sealed, key) });
        if (!body?.access_token) throw new Error('no token');
        store.putToken(key, { ...rest, sealed: vault.seal(body.access_token, key), expiresAt: now() + Number(body.expires_in ?? 0) * 1000, refreshedAt: now(), refreshTriedAt: now() });
        refreshed += 1;
      } catch (e) {
        store.putToken(key, { ...rest, refreshTriedAt: now() });
        log.warn('threads token refresh failed', { code: e?.code ?? null });
      }
    }
    return refreshed;
  }

  return {
    accept,
    tokenFor,
    markInvalid,
    refreshThreads,
    list: () => store.listTokens().map((t) => describe(t.key, t)),
    remove: (key) => store.deleteToken(key),
    has: (key) => !!store.getToken(key),
  };
}
