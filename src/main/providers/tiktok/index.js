import meta from './meta.js';

/**
 * TikTok provider (experimental) — STUB (v2.0 chunk B). Chunk C2 owns providers/tiktok/** and implements it per the
 * v2.0 plan §2 (Login Kit + Display API; no native daily series → capabilities.dailySeries 'derived').
 * `contract: true` makes tests/providers.contract.test.js check the full Provider shape while disabled.
 */
const notYet = async () => { throw Object.assign(new Error('TikTok provider is not implemented yet'), { code: 'NOT_IMPLEMENTED' }); };

const tiktok = {
  ...meta,
  meta,
  enabled: false,
  contract: true,
  concurrency: 1,
  labelSuffix: ' (TikTok)',
  client: null,
  dailyWindow: { windowDays: 30, maxLookbackDays: 30, initialDays: 30 },

  accountKey: (externalId) => `${meta.keyPrefix}${externalId}`,

  discover: notYet,
  fetchProfile: notYet,
  fetchPosts: notYet,
  fetchPostInsights: notYet,
  fetchPostInsightsBatch: notYet,
  fetchDailyInsights: async () => ({ series: {}, dropped: [] }),
  refreshToken: notYet,
  inbox: null,
  reportSections: [],
  demo: null,
};

export default tiktok;
