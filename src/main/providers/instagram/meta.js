/**
 * Static platform metadata (pure: no imports). providers/capabilities.js derives its lookup tables from every
 * provider's meta; the provider module spreads it. See providers/types.js ProviderMeta.
 */
export default Object.freeze({
  platform: 'instagram',
  label: 'Instagram',
  auth: 'meta',
  keyPrefix: '',
  multiProfile: false,
  experimental: false,
  primaryMetric: 'reach',
  capabilities: Object.freeze({
    reach: true, saveRate: true, stories: true, demographics: true, competitors: true, comments: true, ads: true,
    inbox: true, inboxReply: true, watchTime: false, dailySeries: 'native', experimental: false,
  }),
});
