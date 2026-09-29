/** Static platform metadata (pure). Chunk D may flip capabilities.inbox / inboxReply when its adapter lands. */
export default Object.freeze({
  platform: 'threads',
  label: 'Threads',
  auth: 'threads',
  keyPrefix: 'th-',
  multiProfile: false,
  experimental: false,
  primaryMetric: 'views',
  capabilities: Object.freeze({
    reach: false, saveRate: false, stories: false, demographics: true, competitors: false, comments: false, ads: false,
    inbox: false, inboxReply: false, watchTime: false, dailySeries: 'native', experimental: false,
  }),
});
