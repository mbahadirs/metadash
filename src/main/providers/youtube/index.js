import meta from './meta.js';

/**
 * YouTube provider — STUB (v2.0 chunk B). Chunk C1 owns providers/youtube/** and implements it per the v2.0 plan §1:
 * auth.js (Google OAuth via src/main/oauth), api.js, analytics.js, metrics.js, mappers.js, quota.js, inbox.js
 * (InboxAdapter), kpis.js / reportSections.js / demo.js hooks. Set `enabled: true` when it works end to end.
 * `contract: true` makes tests/providers.contract.test.js check the full Provider shape while disabled.
 */
const notYet = async () => { throw Object.assign(new Error('YouTube provider is not implemented yet'), { code: 'NOT_IMPLEMENTED' }); };

const youtube = {
  ...meta,
  meta,
  enabled: false,
  contract: true,
  concurrency: 2,
  labelSuffix: ' (YouTube)',
  client: null,
  dailyWindow: { windowDays: 90, maxLookbackDays: 365 * 3, initialDays: 365, refetchTrailingDays: 7 },

  accountKey: (externalId) => `${meta.keyPrefix}${externalId}`,

  discover: notYet,
  fetchProfile: notYet,
  fetchPosts: notYet,
  fetchPostInsights: notYet,
  fetchPostInsightsBatch: notYet,
  fetchDailyInsights: notYet,
  fetchDemographics: notYet,
  refreshToken: notYet,
  inbox: null,
  reportSections: [],
  demo: null,
};

export default youtube;
