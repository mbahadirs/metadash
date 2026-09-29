/**
 * What each platform can show. Exposed to the renderer through `platforms:list`; analytics/UI hide or grey out
 * features a platform lacks instead of showing zeros.
 */
export const CAPABILITIES = Object.freeze({
  instagram: Object.freeze({ reach: true, saveRate: true, stories: true, demographics: true, competitors: true, comments: true, ads: true }),
  facebook: Object.freeze({ reach: true, saveRate: false, stories: false, demographics: false, competitors: false, comments: false, ads: true }),
  threads: Object.freeze({ reach: false, saveRate: false, stories: false, demographics: true, competitors: false, comments: false, ads: false }),
});

/** Headline reach-like metric per platform (Threads has no reach; views is its primary metric). */
export const PRIMARY_METRIC = Object.freeze({ instagram: 'reach', facebook: 'reach', threads: 'views' });

/** Short UI labels (brand names; not translated). */
export const PLATFORM_LABELS = Object.freeze({ instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads' });

/** Which auth profile ('meta' | 'threads') a platform's accounts use. */
export const PLATFORM_AUTH = Object.freeze({ instagram: 'meta', facebook: 'meta', threads: 'threads' });

/** Account-key prefixes; Instagram keys are the raw numeric id. */
export const KEY_PREFIX = Object.freeze({ instagram: '', facebook: 'fb-', threads: 'th-' });

export function capabilitiesFor(platform) {
  return CAPABILITIES[platform] ?? CAPABILITIES.instagram;
}

export function primaryMetricFor(platform) {
  return PRIMARY_METRIC[platform] ?? 'reach';
}

/** Account key for a raw API id on a platform: '123' | 'fb-123' | 'th-123'. */
export function accountKeyFor(platform, externalId) {
  return `${KEY_PREFIX[platform] ?? ''}${externalId}`;
}

/** Platform of an account key (by prefix); raw ids are Instagram. */
export function platformOfKey(key) {
  const k = String(key ?? '');
  if (k.startsWith('fb-')) return 'facebook';
  if (k.startsWith('th-')) return 'threads';
  return 'instagram';
}
