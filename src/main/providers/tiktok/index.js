import meta from './meta.js';
import { activeProfiles, getProfileById, profileScopes } from '../../db/queries/profiles.js';
import * as api from './api.js';
import { mapProfile, mapVideo, videoValues, tiktokKey } from './mappers.js';
import { refreshTikTokProfile, tiktokMaintenance, isDemoTikTok } from './connection.js';
import { seedTikTokDemo, extendTikTokDemoDay } from './demo.js';
import { pctChange } from '../../analytics/util.js';

/**
 * TikTok (experimental, v2.0 chunk C2): Login Kit for Desktop + Display API v2 (see api.js / auth.js for what is
 * confirmed and what still needs verification). One profile per TikTok account (multi-profile auth 'tiktok'), token
 * from ctx.tokenForAccount (refreshed through refreshToken when < 5 min remain; access tokens live 24 h).
 * No native daily insights: capabilities.dailySeries 'derived' → platformAccount.js materializes follower_count / views
 * from snapshots. No comments/inbox, reach, watch time or demographics (Display API does not expose them).
 * Extension point: a TikTok API for Business provider (account insights, comments) would be a separate module
 * (providers/tiktok/business.js, absent) behind its own capability flags.
 */
const openIdOf = (account) => account.externalId ?? String(account.igId).replace(/^tt-/, '');
const token = (ctx, account) => ctx.tokenForAccount({ ...account, platform: 'tiktok' });
const scopesOf = (account) => profileScopes(account.profileId != null ? getProfileById(account.profileId) : null);

/** Per-run cache of the counts video/list already returned (post insights then skip video/query for those). */
const runCache = new WeakMap();
const FRESH_MS = 15 * 60_000;
const cacheFor = (ctx) => {
  if (!ctx || typeof ctx !== 'object') return new Map();
  if (!runCache.has(ctx)) runCache.set(ctx, new Map());
  return runCache.get(ctx);
};

async function fetchPostInsightsBatch(ctx, account, posts) {
  const cache = cacheFor(ctx);
  const now = Date.now();
  const values = {};
  const missing = [];
  for (const p of posts) {
    const hit = cache.get(p.mediaId);
    if (hit && now - hit.at < FRESH_MS && Object.keys(hit.values).length) values[p.mediaId] = hit.values;
    else missing.push(p);
  }
  if (missing.length) {
    const byExternal = new Map(missing.map((p) => [String(p.externalId ?? String(p.mediaId).replace(/^tt-/, '')), p.mediaId]));
    const videos = await api.queryVideos(await token(ctx, account), [...byExternal.keys()]);
    for (const v of videos) {
      const mediaId = byExternal.get(String(v.id));
      if (mediaId) values[mediaId] = videoValues(v);
    }
  }
  return { values, dropped: [] };
}

/** KPI tiles summed over the period's posts (see computeKpi). */
const POST_SUM_KPIS = new Set(['likes', 'comments', 'shares']);

const tiktok = {
  ...meta,
  meta,
  enabled: true,
  contract: true,
  concurrency: 1,
  capabilities: meta.capabilities,
  primaryMetric: meta.primaryMetric,
  labelSuffix: ' (TikTok)',
  client: api.tiktokClient,
  // No native daily insights; the window only drives the (empty) fetchDailyInsights loop.
  dailyWindow: { windowDays: 30, maxLookbackDays: 30, initialDays: 30 },

  accountKey: (externalId) => tiktokKey(externalId),

  /** Accounts of every connected TikTok profile (one per profile). */
  async discover(ctx) {
    const items = [];
    const warnings = [];
    for (const p of activeProfiles('tiktok')) {
      if (isDemoTikTok(p)) continue;
      const account = { igId: tiktokKey(p.external_id), platform: 'tiktok', externalId: p.external_id, profileId: p.id };
      try {
        const u = await api.fetchUserInfo(await token(ctx, account), api.userFieldsFor(profileScopes(p)));
        items.push({ ...mapProfile(u), accountId: account.igId, externalId: String(p.external_id) });
      } catch (e) {
        warnings.push({ profileId: p.id, code: e?.code ?? null, message: e?.message ?? String(e) });
      }
    }
    return { items, warnings };
  },

  async fetchProfile(ctx, account) {
    const u = await api.fetchUserInfo(await token(ctx, account), api.userFieldsFor(scopesOf(account)));
    return mapProfile({ open_id: openIdOf(account), ...u });
  },

  async fetchPosts(ctx, account, { sinceUnix = 0, max } = {}) {
    const videos = await api.listVideosSince(await token(ctx, account), { sinceUnix, ...(max ? { max } : {}) });
    const cache = cacheFor(ctx);
    const at = Date.now();
    return videos.map((v) => {
      const post = mapVideo(v);
      cache.set(post.mediaId, { values: post.inline, at });
      return post;
    });
  },

  fetchPostInsightsBatch,

  async fetchPostInsights(ctx, post, { account } = {}) {
    const { values } = await fetchPostInsightsBatch(ctx, account ?? {}, [post]);
    return { values: values[post.mediaId] ?? {}, dropped: [] };
  },

  /** Display API has no daily series (derived from snapshots instead). */
  fetchDailyInsights: async () => ({ series: {}, dropped: [] }),

  /**
   * analytics/account.js hook. The Display API has no daily likes/comments/shares, so those tiles sum the latest
   * counts of the posts published in the period (media_latest via aggregateMedia) instead of empty daily series.
   */
  computeKpi(key, { agg, prevAgg }) {
    if (!POST_SUM_KPIS.has(key)) return undefined;
    const value = agg?.[key] ?? 0;
    const prev = prevAgg?.[key] ?? 0;
    return { value, prev, changePct: pctChange(value, prev) };
  },

  refreshToken: (profile) => refreshTikTokProfile(profile),

  maintenance: () => tiktokMaintenance(),

  inbox: null,
  reportSections: [],
  demo: { seed: seedTikTokDemo, extendDay: extendTikTokDemoDay },
  connectionCard: 'tiktok',
};

export default tiktok;
