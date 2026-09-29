import { CAPABILITIES, PRIMARY_METRIC } from '../capabilities.js';
import { latestFollowers } from '../../db/queries/accounts.js';
import { threadsClient, THREADS_MIN_SINCE_UNIX } from './client.js';
import * as api from './api.js';
import { mapProfile, threadsKey, REPOST_FACADE } from './mappers.js';
import { DEMOGRAPHICS_MIN_FOLLOWERS } from './metrics.js';
import { threadsMaintenance } from './connection.js';

const token = (ctx) => ctx.tokenFor('threads');
const userId = (account) => account.externalId ?? String(account.igId).replace(/^th-/, '');

/** Threads (graph.threads.net) — own token profile, client and rate limiter; a single connected profile in v1.3. */
const threads = {
  platform: 'threads',
  enabled: true,
  auth: 'threads',
  concurrency: 1,
  capabilities: CAPABILITIES.threads,
  primaryMetric: PRIMARY_METRIC.threads,
  labelSuffix: ' (Threads)',
  client: threadsClient,
  dailyWindow: { windowDays: 30, maxLookbackDays: 90, initialDays: 30, minSinceUnix: THREADS_MIN_SINCE_UNIX },

  accountKey: threadsKey,

  async discover(ctx) {
    const me = await api.fetchMe(token(ctx));
    const followers = await api.fetchFollowersCount(me.id, token(ctx));
    const profile = mapProfile(me, followers ?? undefined);
    return { items: [{ ...profile, accountId: threadsKey(me.id), externalId: String(me.id) }], warnings: [] };
  },

  async fetchProfile(ctx, account) {
    const me = await api.fetchMe(token(ctx));
    await threadsClient.delay();
    const followers = await api.fetchFollowersCount(me.id ?? userId(account), token(ctx));
    return mapProfile(me, followers ?? undefined);
  },

  async fetchPosts(ctx, account, { sinceUnix, max } = {}) {
    return api.fetchThreads(userId(account), token(ctx), { sinceUnix, ...(max ? { max } : {}) });
  },

  skipInsights: (post) => post.mediaType === REPOST_FACADE,

  async fetchPostInsights(ctx, post) {
    return api.fetchPostInsights(post.externalId ?? String(post.mediaId).replace(/^th-/, ''), token(ctx));
  },

  async fetchDailyInsights(ctx, account, { sinceUnix, untilUnix }) {
    return api.fetchDailyInsights(userId(account), token(ctx), { sinceUnix, untilUnix });
  },

  /** Weekly (job-driven). Skipped below 100 followers, where Threads returns no demographics. */
  async fetchDemographics(ctx, account) {
    const followers = latestFollowers(account.igId);
    if (typeof followers === 'number' && followers < DEMOGRAPHICS_MIN_FOLLOWERS) return { dimensions: {}, dropped: [] };
    // Refused breakdowns are skipped silently (not logged: they would turn every sync 'partial').
    const { dimensions, dropped } = await api.fetchDemographics(userId(account), token(ctx));
    return { dimensions, dropped };
  },

  maintenance: () => threadsMaintenance(),
};

export default threads;
