/**
 * TikTok platform metadata (pure). Owned by chunk C2 from here on; values are the v2.0 plan §2 contract
 * (Display API: no reach, no native daily series — daily follower_count / views are derived by analytics/derived.js).
 */
export default Object.freeze({
  platform: 'tiktok',
  label: 'TikTok',
  auth: 'tiktok',
  keyPrefix: 'tt-',
  multiProfile: true,
  experimental: true,
  primaryMetric: 'views',
  capabilities: Object.freeze({
    reach: false, saveRate: false, stories: false, demographics: false, competitors: false, comments: false, ads: false,
    inbox: false, inboxReply: false, watchTime: false, dailySeries: 'derived', experimental: true,
  }),
  kpis: Object.freeze({
    keys: Object.freeze(['views', 'likes', 'comments', 'shares', 'newFollowers', 'er', 'posts']),
    chart: Object.freeze(['views', 'follower_count']),
    daily: Object.freeze(['views', 'follower_count']),
    dailyMetric: Object.freeze({ views: 'views' }),
  }),
});
