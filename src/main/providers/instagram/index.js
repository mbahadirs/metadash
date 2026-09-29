import { metaClient } from '../../meta/client.js';
import { MetaError } from '../../meta/errors.js';
import * as api from './api.js';
import meta from './meta.js';

const DEMOGRAPHIC_DIMENSIONS = [['city', 'city'], ['gender_age', 'genderAge'], ['country', 'country']];

const token = (ctx) => (ctx.tokenFor ? ctx.tokenFor('meta') : ctx.token);

/** Instagram (Graph API via Facebook Login). Wraps the pre-1.3 functions in ./api.js unchanged. */
const instagram = {
  platform: 'instagram',
  enabled: true,
  auth: 'meta',
  concurrency: 2,
  meta,
  capabilities: meta.capabilities,
  primaryMetric: meta.primaryMetric,
  labelSuffix: '',
  client: metaClient,
  dailyWindow: { windowDays: 30, maxLookbackDays: 90, initialDays: 30 },

  accountKey: (externalId) => String(externalId),

  async discover(ctx) {
    const list = await api.discoverAccounts(token(ctx));
    const items = list.filter((p) => p.ig).map((p) => ({
      ...p.ig, accountId: p.ig.igId, externalId: p.ig.igId, pageId: p.pageId, pageName: p.pageName, sources: p.sources, noPage: !!p.noPage,
    }));
    return { items, warnings: list.warnings ?? [], businesses: list.businesses ?? [], pages: list };
  },

  async fetchProfile(ctx, account) {
    return api.fetchAccountProfile(account.externalId ?? account.igId, token(ctx));
  },

  async fetchPosts(ctx, account, { sinceUnix, max } = {}) {
    const items = await api.fetchMedia(account.externalId ?? account.igId, token(ctx), { sinceUnix, ...(max ? { max } : {}) });
    return items.map((m) => ({
      mediaId: m.mediaId, externalId: m.mediaId, mediaType: m.mediaType, mediaProductType: m.mediaProductType,
      caption: m.caption, permalink: m.permalink, thumbnailUrl: m.thumbnailUrl, timestamp: m.timestamp,
    }));
  },

  skipInsights: (post) => post.mediaProductType === 'STORY',

  async fetchPostInsights(ctx, post, { disabled = [], overrides = null } = {}) {
    return api.fetchMediaInsights(
      { mediaId: post.externalId ?? post.mediaId, mediaProductType: post.mediaProductType, mediaType: post.mediaType },
      token(ctx), { disabled, overrides },
    );
  },

  /** Daily insights + the follower_count series (the latter's invalid-parameter errors are ignored, as before 1.3). */
  async fetchDailyInsights(ctx, account, { sinceUnix, untilUnix, disabled = [], overrides = null }) {
    const id = account.externalId ?? account.igId;
    const { series, dropped } = await api.fetchAccountInsightsDaily(id, token(ctx), { sinceUnix, untilUnix, disabled, overrides });
    let merged = series;
    try {
      const fc = await api.fetchFollowerCountSeries(id, token(ctx), { sinceUnix, untilUnix });
      merged = { ...series, follower_count: fc };
    } catch (e) {
      if (!(e instanceof MetaError && e.isInvalidParam)) throw e;
    }
    return { series: merged, dropped };
  },

  async fetchDemographics(ctx, account, { disabled = [], overrides = null } = {}) {
    const demo = await api.fetchDemographics(account.externalId ?? account.igId, token(ctx), { disabled, overrides });
    const dimensions = Object.fromEntries(DEMOGRAPHIC_DIMENSIONS.map(([dim, key]) => [dim, demo[key] ?? []]));
    return { dimensions, dropped: demo.dropped ?? [] };
  },

  async fetchComments(ctx, post) {
    return api.fetchComments(post.externalId ?? post.mediaId, token(ctx));
  },
};

export default instagram;
