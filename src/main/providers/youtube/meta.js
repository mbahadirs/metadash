/**
 * YouTube platform metadata (pure). `kpis` feeds analytics/platform.js (KPI tiles, chart series, daily metrics) — see
 * providers/types.js ProviderKpis. avgViewDuration and newFollowers (net subscribers) come from provider.computeKpi
 * (kpis.js); follower_count = subscribersGained, unfollows = subscribersLost (YouTube Analytics).
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
    daily: Object.freeze(['views', 'watch_time_min', 'avg_view_duration_s', 'likes', 'comments', 'shares', 'follower_count', 'unfollows']),
    dailyMetric: Object.freeze({ views: 'views', watchTime: 'watch_time_min', likes: 'likes', comments: 'comments', shares: 'shares' }),
  }),
  demographicsUnit: Object.freeze({ gender_age: 'percent', country: 'count' }),
});
