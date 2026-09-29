/** Static platform metadata (pure). Chunk D may flip capabilities.inbox / inboxReply when its adapter lands. */
export default Object.freeze({
  platform: 'facebook',
  label: 'Facebook',
  auth: 'meta',
  keyPrefix: 'fb-',
  multiProfile: false,
  experimental: false,
  primaryMetric: 'reach',
  capabilities: Object.freeze({
    reach: true, saveRate: false, stories: false, demographics: false, competitors: false, comments: false, ads: true,
    inbox: false, inboxReply: false, watchTime: false, dailySeries: 'native', experimental: false,
  }),
});
