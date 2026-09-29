import { metaClient } from '../../meta/client.js';
import { MetaError } from '../../meta/errors.js';
import { msg } from '../../i18n.js';
import meta from './meta.js';
import * as api from './api.js';
import { accountKey } from './mappers.js';

const userToken = (ctx) => (ctx.tokenFor ? ctx.tokenFor('meta') : ctx.token);
const pageName = (account, fallback) => account.name ?? account.username ?? fallback ?? account.externalId;

/** A per-page problem that must skip this Page only: permission-class code (never 190, which would abort the run). */
function pageError(key, account, name, cause) {
  return new MetaError({ code: cause?.isPermissionError ? cause.code : 10, message: msg(key, { name: pageName(account, name) }), endpoint: `/${account.externalId}`, source: 'meta' });
}

/** Per-run (per ctx) memo of pages already warned about, so a refusal is logged once, not per chunk/post. */
const warned = new WeakMap();
function firstTime(ctx, key) {
  const seen = warned.get(ctx) ?? new Set();
  if (seen.has(key)) return false;
  warned.set(ctx, new Set([...seen, key]));
  return true;
}

function pageToken(ctx, account) {
  const t = ctx.pageTokens?.get(account.externalId);
  if (!t) throw pageError('fb_page_token_missing', account);
  return t;
}

/**
 * Facebook Pages (Graph API via the same Meta login as Instagram). Page endpoints use a Page access token fetched per
 * run in prepare(); Pages are opt-in (discovered untracked). Shares the Meta client + rate limiter with Instagram.
 */
const facebook = {
  platform: 'facebook',
  enabled: true,
  auth: 'meta',
  concurrency: 2,
  meta,
  capabilities: meta.capabilities,
  primaryMetric: meta.primaryMetric,
  labelSuffix: ' (FB)',
  client: metaClient,
  // Meta allows at most 90 days per since/until request; 30-day chunks keep responses small.
  dailyWindow: { windowDays: 30, maxLookbackDays: 90, initialDays: 30 },

  accountKey,

  async discover(ctx) {
    const { items, warnings, businesses } = await api.discoverPages(userToken(ctx));
    return { items, warnings, businesses };
  },

  /** Fetches the Page access token (cached in ctx.pageTokens). Missing token → MetaError (code 10) skipping this Page. */
  async prepare(ctx, account) {
    if (ctx.pageTokens?.has(account.externalId)) return;
    let res;
    try {
      res = await api.fetchPageToken(account.externalId, userToken(ctx));
    } catch (e) {
      if (e instanceof MetaError && (e.isPermissionError || e.isInvalidParam)) throw pageError('fb_page_token_missing', account, null, e);
      throw e;
    }
    if (!res.token) throw pageError('fb_page_token_missing', account, res.name);
    ctx.pageTokens?.set(account.externalId, res.token);
  },

  async fetchProfile(ctx, account) {
    return api.fetchPageProfile(account.externalId, pageToken(ctx, account));
  },

  async fetchPosts(ctx, account, { sinceUnix, max } = {}) {
    return api.fetchPagePosts(account.externalId, pageToken(ctx, account), { sinceUnix, ...(max ? { max } : {}) });
  },

  async fetchPostInsights(ctx, post, { account } = {}) {
    const onWarning = (e) => firstTime(ctx, `post:${account?.externalId}`) && ctx.log?.({ igId: account?.igId, platform: 'facebook', endpoint: `/${post.externalId}/insights`, code: e.code, message: e.message });
    return api.fetchPostInsights(post.externalId, pageToken(ctx, account), { onWarning });
  },

  /** Daily Page insights; a permission error (no ANALYZE task / read_insights) is logged once and yields no data. */
  async fetchDailyInsights(ctx, account, { sinceUnix, untilUnix }) {
    if (warned.get(ctx)?.has(`daily:${account.externalId}`)) return { series: {}, dropped: [] };
    try {
      return await api.fetchPageInsightsDaily(account.externalId, pageToken(ctx, account), { sinceUnix, untilUnix });
    } catch (e) {
      if (!(e instanceof MetaError && e.isPermissionError)) throw e;
      if (firstTime(ctx, `daily:${account.externalId}`)) ctx.log?.({ igId: account.igId, platform: 'facebook', endpoint: `/${account.externalId}/insights`, code: e.code, message: `${msg('fb_page_no_analyze', { name: pageName(account) })} (${e.message})` });
      return { series: {}, dropped: [] };
    }
  },
};

export default facebook;
