import { PROVIDER_METAS, metaFor } from './metas.js';

/**
 * What each platform can show, derived from the providers' static meta (providers/<p>/meta.js). Exposed to the
 * renderer through `platforms:list`; analytics/UI hide or grey out features a platform lacks instead of showing zeros.
 *
 * Capability schema (every provider meta must declare every key; tests/providers.contract.test.js):
 *   reach, saveRate, stories, demographics, competitors, comments, ads   boolean (v1.3)
 *   inbox        boolean              comments can be listed in the unified inbox (v2.0 D)
 *   inboxReply   boolean | 'scope'    replies possible; 'scope' = only after an optional scope upgrade (YouTube force-ssl)
 *   watchTime    boolean              watch-time metrics (media_latest.watch_time_min …)
 *   dailySeries  'native' | 'derived' | 'none'   derived = estimated from snapshots (analytics/derived.js)
 *   experimental boolean              UI shows an "Experimental" badge
 */
export const CAPABILITY_SCHEMA = Object.freeze({
  reach: 'boolean', saveRate: 'boolean', stories: 'boolean', demographics: 'boolean', competitors: 'boolean', comments: 'boolean', ads: 'boolean',
  inbox: 'boolean', inboxReply: 'boolean|scope', watchTime: 'boolean', dailySeries: 'native|derived|none', experimental: 'boolean',
});
export const CAPABILITY_KEYS = Object.freeze(Object.keys(CAPABILITY_SCHEMA));

const table = (fn) => Object.freeze(Object.fromEntries(PROVIDER_METAS.map((m) => [m.platform, fn(m)])));

export const CAPABILITIES = table((m) => m.capabilities);

/** Headline reach-like metric per platform (Threads/YouTube/TikTok have no reach; views is their primary metric). */
export const PRIMARY_METRIC = table((m) => m.primaryMetric);

/** Short UI labels (brand names; not translated). */
export const PLATFORM_LABELS = table((m) => m.label);

/** Which auth profile ('meta' | 'threads' | 'google' | 'tiktok') a platform's accounts use. */
export const PLATFORM_AUTH = table((m) => m.auth);

/** Account-key prefixes; Instagram keys are the raw numeric id. */
export const KEY_PREFIX = table((m) => m.keyPrefix);

/** Distinct auth platforms in registry order, and which of them hold one profile row per channel/account. */
export const AUTHS = Object.freeze([...new Set(PROVIDER_METAS.map((m) => m.auth))]);
export const MULTI_PROFILE = Object.freeze(Object.fromEntries(AUTHS.map((a) => [a, PROVIDER_METAS.some((m) => m.auth === a && m.multiProfile)])));

export function capabilitiesFor(platform) {
  return CAPABILITIES[platform] ?? CAPABILITIES.instagram;
}

export function primaryMetricFor(platform) {
  return PRIMARY_METRIC[platform] ?? 'reach';
}

/** Account key for a raw API id on a platform: '123' | 'fb-123' | 'th-123' | 'yt-UC…' | 'tt-…'. */
export function accountKeyFor(platform, externalId) {
  return `${KEY_PREFIX[platform] ?? ''}${externalId}`;
}

/** Non-empty prefixes, longest first (so a future 'fbx-' never matches 'fb-'). */
const PREFIXES = PROVIDER_METAS.filter((m) => m.keyPrefix).map((m) => [m.keyPrefix, m.platform]).sort((a, b) => b[0].length - a[0].length);
const RAW_PLATFORM = PROVIDER_METAS.find((m) => !m.keyPrefix)?.platform ?? 'instagram';

/** Platform of an account key (by prefix); raw ids are Instagram. */
export function platformOfKey(key) {
  const k = String(key ?? '');
  for (const [prefix, platform] of PREFIXES) if (k.startsWith(prefix)) return platform;
  return RAW_PLATFORM;
}

/** Static meta of a platform (label, auth, keyPrefix, capabilities, kpis, …) or null. */
export { metaFor };
