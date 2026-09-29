import meta from './meta.js';
import * as api from './api.js';
import { accountKey, mapProfile, mapPost } from './mappers.js';

/**
 * TEMPLATE provider — never registered (providers/index.js ignores this folder). Copy to providers/<platform>/,
 * rename, add one line to providers/metas.js and providers/index.js, and follow README.md.
 * Contract: providers/types.js Provider (+ v2.0 hooks). Tokens: multi-profile auths use `await ctx.tokenForAccount(account)`.
 */
const example = {
  ...meta,
  meta,
  enabled: false,
  concurrency: 1,
  labelSuffix: ' (Example)',
  client: null,
  dailyWindow: { windowDays: 30, maxLookbackDays: 90, initialDays: 30 },
  accountKey,

  async discover(ctx) {
    return { items: [], warnings: [] };
  },

  async fetchProfile(ctx, account) {
    return mapProfile(await api.fetchMe(await ctx.tokenForAccount(account)));
  },

  async fetchPosts(ctx, account, { sinceUnix } = {}) {
    void sinceUnix;
    return [].map(mapPost);
  },

  async fetchPostInsights(ctx, post) {
    void post;
    return { values: {}, dropped: [] };
  },

  async fetchDailyInsights() {
    return { series: {}, dropped: [] };
  },

  async refreshToken(profile) {
    void profile;
    throw Object.assign(new Error('not implemented'), { code: 'NOT_IMPLEMENTED' });
  },

  inbox: null,
  reportSections: [],
  demo: null,
};

export default example;
