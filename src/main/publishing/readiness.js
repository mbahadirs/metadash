import { getActiveProfile } from '../db/queries/profiles.js';
import { listAccounts } from '../db/queries/accounts.js';
import { debugToken, PUBLISH_SCOPES, FIRST_COMMENT_SCOPES } from '../meta/auth.js';
import { metaClient } from '../meta/client.js';
import { extendValidationContext } from '../planner/validationContext.js';
import { isDemoMode, readAuthToken, tokenFingerprint } from './context.js';
import { getMediaHostSettings, isHostConfigured, lastHostTest } from './hosts/index.js';

/**
 * Publish readiness per platform (publishing:readiness) and the cached missing scopes that validation uses
 * (extendValidationContext is synchronous, so it reads the cache filled by refreshReadiness()).
 *  - Meta: scopes from /debug_token; Facebook Pages also need the CREATE_CONTENT task (from /me/accounts?fields=tasks;
 *    Pages reachable only through Business Manager are reported as publishable when the scope is granted).
 *  - Threads: no scope introspection endpoint is used; connected = can try (a missing threads_content_publish fails
 *    the publish with a permission error).
 */
const CACHE_MS = 10 * 60_000;
let cache = { at: 0, scopes: null, pageTasks: new Map(), fp: null };

export function clearReadinessCache() {
  cache = { at: 0, scopes: null, pageTasks: new Map(), fp: null };
}

/** Cached { platform: missingScopes[] } for validation; platforms with unknown scopes are omitted. */
export function cachedMissingScopes() {
  if (!cache.scopes || isDemoMode()) return null;
  const missing = (p) => [...PUBLISH_SCOPES[p], FIRST_COMMENT_SCOPES[p]].filter((s) => !cache.scopes.includes(s));
  return { instagram: missing('instagram'), facebook: missing('facebook') };
}

let unregister = null;
/** Registers the validation-context extender once (called by the IPC module). */
export function registerReadinessValidation() {
  if (unregister) return unregister;
  unregister = extendValidationContext(() => {
    const missingScopes = cachedMissingScopes();
    return missingScopes ? { missingScopes } : {};
  });
  return unregister;
}

async function loadMeta({ client = metaClient, debug = debugToken } = {}) {
  const token = readAuthToken('meta');
  if (!token) return { scopes: [], pageTasks: new Map() };
  const health = await debug(token);
  const pageTasks = new Map();
  try {
    const pages = await client.getAll('/me/accounts', { fields: 'id,tasks', limit: 100 }, { token, max: 500 });
    for (const p of pages) pageTasks.set(String(p.id), p.tasks ?? []);
  } catch (e) {
    console.warn('[publishing] page tasks lookup failed:', e?.message ?? e);
  }
  return { scopes: health.scopes ?? [], pageTasks };
}

const platformState = (scopes, platform) => {
  const missing = [...PUBLISH_SCOPES[platform], FIRST_COMMENT_SCOPES[platform]].filter((s) => !scopes.includes(s));
  return { canPublish: PUBLISH_SCOPES[platform].every((s) => scopes.includes(s)), missingScopes: missing, firstComment: scopes.includes(FIRST_COMMENT_SCOPES[platform]) };
};

/**
 * @param {{ force?: boolean, now?: number, client?: object, debug?: Function }} [opts]
 * @returns {Promise<import('../../renderer/lib/types').PublishingReadiness>}
 */
export async function getReadiness({ force = false, now = Date.now(), client, debug } = {}) {
  const host = getMediaHostSettings();
  const test = lastHostTest();
  const mediaHost = { type: host.type, configured: isHostConfigured(), lastTestOk: test ? !!test.ok : null };
  const fbAccounts = listAccounts({ platforms: ['facebook'] });
  if (isDemoMode()) {
    const ready = { canPublish: true, missingScopes: [], firstComment: true };
    return { instagram: ready, facebook: { ...ready, pages: fbAccounts.map((a) => ({ accountId: a.igId, canPublish: true })) }, threads: ready, mediaHost };
  }
  const hasMeta = !!getActiveProfile('meta');
  const fp = hasMeta ? tokenFingerprint('meta') : null;
  if (hasMeta && (force || !cache.scopes || now - cache.at > CACHE_MS || cache.fp !== fp)) {
    try {
      const loaded = await loadMeta({ client, debug });
      cache = { at: now, ...loaded, fp };
    } catch (e) {
      console.warn('[publishing] readiness check failed:', e?.message ?? e);
    }
  }
  const scopes = hasMeta ? cache.scopes ?? [] : [];
  const ig = platformState(scopes, 'instagram');
  const fb = platformState(scopes, 'facebook');
  const pages = fbAccounts.map((a) => {
    const tasks = cache.pageTasks.get(String(a.externalId));
    return { accountId: a.igId, canPublish: fb.canPublish && (tasks == null || tasks.includes('CREATE_CONTENT')) };
  });
  const threadsConnected = !!readAuthToken('threads');
  const threads = { canPublish: threadsConnected, missingScopes: [], firstComment: threadsConnected };
  return { instagram: ig, facebook: { ...fb, pages }, threads, mediaHost };
}
