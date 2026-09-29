/**
 * TEMPLATE — copy providers/_template to providers/<platform>/ and fill in. Pure module: no imports.
 * Every capability key of providers/capabilities.js CAPABILITY_SCHEMA must be present.
 */
export default Object.freeze({
  platform: 'example',
  label: 'Example',
  auth: 'example',          // profiles.platform value; share 'meta' only when the same login is used
  keyPrefix: 'ex-',         // unique account-key prefix
  multiProfile: true,       // one profiles row per connected account (external_id)
  experimental: true,
  primaryMetric: 'views',
  capabilities: Object.freeze({
    reach: false, saveRate: false, stories: false, demographics: false, competitors: false, comments: false, ads: false,
    inbox: false, inboxReply: false, watchTime: false, dailySeries: 'derived', experimental: true,
  }),
  kpis: Object.freeze({
    keys: Object.freeze(['views', 'likes', 'newFollowers', 'er', 'posts']),
    chart: Object.freeze(['views', 'follower_count']),
    daily: Object.freeze(['views', 'follower_count']),
    dailyMetric: Object.freeze({ views: 'views' }),
  }),
});
