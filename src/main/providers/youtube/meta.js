/**
 * YouTube platform metadata (pure). Owned by chunk C1 from here on; the values below are the v2.0 plan §1 contract.
 * `kpis` feeds analytics/platform.js (KPI tiles, chart series, daily metrics) — see providers/types.js ProviderKpis.
 */
export default Object.freeze({
  platform: 'youtube',
  label: 'YouTube',
  auth: 'google',
  keyPrefix: 'yt-',
  multiProfile: true,
  experimental: false,
  primaryMetric: 'views',
  capabilities: Object.freeze({
    reach: false, saveRate: false, stories: false, demographics: true, competitors: false, comments: true, ads: false,
    inbox: true, inboxReply: 'scope', watchTime: true, dailySeries: 'native', experimental: false,
  }),
  kpis: Object.freeze({
    keys: Object.freeze(['views', 'watchTime', 'avgViewDuration', 'newFollowers', 'likes', 'comments', 'shares', 'posts']),
    chart: Object.freeze(['views', 'watch_time_min']),
    daily: Object.freeze(['views', 'watch_time_min', 'avg_view_duration_s', 'likes', 'comments', 'shares', 'unfollows']),
    dailyMetric: Object.freeze({ views: 'views', watchTime: 'watch_time_min', likes: 'likes', comments: 'comments', shares: 'shares' }),
  }),
  demographicsUnit: Object.freeze({ gender_age: 'percent', country: 'count' }),
});
