import { q } from '../db/index.js';
import { listAccounts } from '../db/queries/accounts.js';
import { getActiveProfile, getProfileById, profileScopes } from '../db/queries/profiles.js';
import { capabilitiesFor } from '../providers/capabilities.js';
import { adapterFor } from './registry.js';

/**
 * inbox:capabilities → [{ accountId, platform, read, reply, hide, maxReplyLength, missingScopes }] for tracked accounts
 * of inbox platforms. Meta scopes come from /debug_token (cached 10 min, like publishing readiness); Threads/YouTube
 * from the profile's stored scopes. Unknown scopes (lookup failed, or never stored) count as granted — the call is
 * tried and a permission error is reported then. Demo mode: everything is available (sends are simulated).
 */
const CACHE_MS = 10 * 60_000;
let metaCache = { at: 0, scopes: null };

export function clearCapabilityCache() {
  metaCache = { at: 0, scopes: null };
}

async function metaScopes({ now, debug, readToken }) {
  if (metaCache.scopes && now - metaCache.at < CACHE_MS) return metaCache.scopes;
  try {
    const token = readToken('meta');
    if (!token) return null;
    const res = await debug(token);
    metaCache = { at: now, scopes: res.scopes ?? [] };
    return metaCache.scopes;
  } catch (e) {
    console.warn('[inbox] scope lookup failed:', e?.message ?? e);
    return null;
  }
}

function storedScopes(account) {
  const profile = account.profileId ? getProfileById(account.profileId) : getActiveProfile(account.platform === 'threads' ? 'threads' : 'meta');
  const list = profileScopes(profile);
  return list.length ? list : null;
}

/** One account's capability given the granted scopes (null = unknown → assume granted). */
export function capabilityOf(account, adapter, scopes) {
  const missing = (need) => (scopes ? need.filter((s) => !scopes.includes(s)) : []);
  const s = adapter.scopes ?? { read: [], reply: [], hide: [] };
  const missRead = missing(s.read ?? []);
  const missReply = missing(s.reply ?? []);
  const missHide = missing(s.hide ?? []);
  return {
    accountId: account.igId,
    platform: account.platform,
    read: missRead.length === 0,
    reply: !!adapter.reply && missReply.length === 0,
    hide: !!adapter.hide && missHide.length === 0,
    maxReplyLength: adapter.maxReplyLength ?? null,
    missingScopes: [...new Set([...missRead, ...missReply, ...missHide])],
  };
}

export async function inboxCapabilities(deps = {}) {
  const now = deps.now ?? Date.now();
  const accounts = (deps.accounts ?? listAccounts()).filter((a) => capabilitiesFor(a.platform ?? 'instagram').inbox);
  const demo = deps.isDemo ?? (await import('../publishing/context.js').then((m) => m.isDemoMode()).catch(() => false));
  const needMeta = accounts.some((a) => a.platform === 'instagram' || a.platform === 'facebook');
  let meta = null;
  if (!demo && needMeta) {
    const debug = deps.debug ?? (await import('../meta/auth.js')).debugToken;
    const readToken = deps.readToken ?? (await import('../publishing/context.js')).readAuthToken;
    meta = await metaScopes({ now, debug, readToken });
  }
  const out = [];
  for (const a of accounts) {
    const platform = a.platform ?? 'instagram';
    const adapter = adapterFor(platform);
    if (!adapter) continue;
    const scopes = demo ? null : platform === 'instagram' || platform === 'facebook' ? meta : storedScopes(a);
    out.push(capabilityOf({ ...a, platform }, adapter, scopes));
  }
  return out;
}

/** Name of this install's team member (F1 team_members.is_self), used as the outbox author; null without a team. */
export function selfAuthor() {
  try { return q.get('SELECT name FROM team_members WHERE is_self = 1 LIMIT 1')?.name ?? null; } catch { return null; }
}
