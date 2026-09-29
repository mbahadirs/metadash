import { capabilitiesFor, primaryMetricFor, PLATFORM_LABELS } from '../providers/capabilities.js';
import { PLATFORMS } from '../db/queries/accounts.js';
import { msg } from '../i18n.js';

/**
 * Per-platform analytics vocabulary: which KPI tiles apply, which daily metrics are charted and stored.
 * Keys are the `kpis` keys returned by accountAnalytics (camelCase) — the renderer and reports iterate `kpiKeys`.
 */
const KPI_KEYS = Object.freeze({
  instagram: Object.freeze(['reach', 'views', 'profileViews', 'er', 'saveRate', 'newFollowers', 'posts']),
  facebook: Object.freeze(['reach', 'views', 'postEngagements', 'profileViews', 'er', 'newFollowers', 'posts']),
  threads: Object.freeze(['views', 'likes', 'replies', 'reposts', 'linkClicks', 'newFollowers', 'er', 'posts']),
});

/** Two daily series drawn on the account chart: [primary, secondary]. */
const CHART_METRICS = Object.freeze({
  instagram: Object.freeze(['reach', 'accounts_engaged']),
  facebook: Object.freeze(['reach', 'post_engagements']),
  threads: Object.freeze(['views', 'likes']),
});

/** Daily metrics (account_insights_daily canonical names) present in each platform's series rows. */
const DAILY_METRICS = Object.freeze({
  instagram: Object.freeze(['reach', 'views', 'profile_views', 'accounts_engaged']),
  facebook: Object.freeze(['reach', 'views', 'profile_views', 'post_engagements', 'unfollows']),
  threads: Object.freeze(['views', 'likes', 'replies', 'reposts', 'quotes', 'link_clicks']),
});

/** KPI key → daily metric summed for it (the rest — er, saveRate, newFollowers, posts — come from media/snapshots). */
export const KPI_DAILY_METRIC = Object.freeze({
  reach: 'reach', views: 'views', profileViews: 'profile_views', engaged: 'accounts_engaged', postEngagements: 'post_engagements',
  likes: 'likes', replies: 'replies', reposts: 'reposts', quotes: 'quotes', linkClicks: 'link_clicks',
});

export const platformOf = (account) => account?.platform ?? 'instagram';
export const kpiKeysFor = (platform) => [...(KPI_KEYS[platform] ?? KPI_KEYS.instagram)];
export const chartMetricsFor = (platform) => [...(CHART_METRICS[platform] ?? CHART_METRICS.instagram)];
export const dailyMetricsFor = (platform) => [...(DAILY_METRICS[platform] ?? DAILY_METRICS.instagram)];
export const platformLabel = (platform) => PLATFORM_LABELS[platform] ?? platform;
export { capabilitiesFor, primaryMetricFor, PLATFORMS };

/** Validates an optional platform filter from IPC: undefined/[] → undefined (all), otherwise a de-duplicated list. */
export function normalizePlatforms(platforms) {
  if (platforms == null) return undefined;
  if (!Array.isArray(platforms)) throw new Error(msg('invalid_platform', { p: String(platforms) }));
  const bad = platforms.find((p) => !PLATFORMS.includes(p));
  if (bad !== undefined) throw new Error(msg('invalid_platform', { p: String(bad) }));
  const list = [...new Set(platforms)];
  return list.length ? list : undefined;
}

/** Platforms present in a list of accounts/rows, in canonical order. */
export function platformsIn(items) {
  const set = new Set(items.map(platformOf));
  return PLATFORMS.filter((p) => set.has(p));
}
