import meta from './meta.js';
import { activeProfiles } from '../../db/queries/profiles.js';
import { readToken } from '../../config/store.js';
import { MetaError } from '../../meta/errors.js';
import { createYtClient, fetchMyChannel, fetchChannel, listUploads, fetchVideos } from './api.js';
import { fetchDailyChannel, fetchVideoMetrics, fetchContentTypes, fetchDemographicsReport, isoDate } from './analytics.js';
import { mapChannel, profileOf, mapVideo, statsOf, isTrackable, accountKey, channelIdOf, videoIdOf } from './mappers.js';
import { DEMOGRAPHICS_DAYS } from './metrics.js';
import { quotaKeyFor } from './quota.js';
import { clientFor } from './client.js';
import { refreshProfileToken, youtubeMaintenance, isDemoGoogle } from './connection.js';
import { youtubeInbox } from './inbox.js';
import { computeKpi } from './kpis.js';
import { youtubeReportSections } from './reportSections.js';
import { youtubeDemo } from './demo.js';

/**
 * YouTube provider (v2.0 C1): Data API v3 for channel/videos/comments, YouTube Analytics API v2 for daily channel
 * series, per-video watch metrics and demographics. One Google OAuth profile per channel (multi-profile auth 'google');
 * tokens come from ctx.tokenForAccount (refreshed through refreshToken below). Quota: quota.js ledger per OAuth client.
 * Confirmed vs VERIFY API facts: api.js header.
 */
const DAY = 86_400_000;
const FIRST_YOUTUBE_DAY = '2005-04-23';

/** channelId → { uploadsPlaylistId, publishedAt } from the last fetchProfile (saves a channels.list call in fetchPosts). */
const channelCache = new Map();
/** Channels whose Analytics rejected dimensions=video,creatorContentType (duration heuristic for the rest of the process). */
const contentTypeUnsupported = new Set();

const softAnalytics = (e) => e instanceof MetaError && (e.isPermissionError || e.isInvalidParam);

async function channelInfo(client, channelId) {
  if (channelCache.has(channelId)) return channelCache.get(channelId);
  const ch = await fetchChannel(client, channelId);
  if (!ch) throw new MetaError({ code: 100, message: `YouTube channel ${channelId} not found`, endpoint: '/channels', source: 'google' });
  const info = mapChannel(ch);
  channelCache.set(channelId, { uploadsPlaylistId: info.uploadsPlaylistId, publishedAt: info.publishedAt });
  return channelCache.get(channelId);
}

const youtube = {
  ...meta,
  meta,
  enabled: true,
  contract: true,
  concurrency: 2,
  labelSuffix: ' (YouTube)',
  client: null,
  dailyWindow: { windowDays: 90, maxLookbackDays: 365 * 3, initialDays: 365, refetchTrailingDays: 7 },
  connectionCard: 'youtube',

  accountKey: (externalId) => accountKey(externalId),

  /** Channels of every active Google profile (each profile = one channel). */
  async discover(ctx) {
    const items = [];
    const warnings = [];
    for (const profile of activeProfiles('google')) {
      if (isDemoGoogle(profile)) continue;
      try {
        const account = { platform: 'youtube', profileId: profile.id, igId: accountKey(profile.external_id), externalId: profile.external_id };
        const token = ctx?.tokenForAccount ? await ctx.tokenForAccount(account) : readToken(profile.token_ref);
        const ch = await fetchMyChannel(createYtClient({ token, quotaKey: quotaKeyFor(profile.app_id) }));
        if (!ch) continue;
        const info = mapChannel(ch);
        items.push({ accountId: accountKey(info.channelId), externalId: info.channelId, username: info.username, name: info.name, profilePicUrl: info.profilePicUrl, followers: info.followers });
      } catch (e) {
        warnings.push({ profileId: profile.id, code: e?.code ?? null, message: e?.message ?? String(e) });
      }
    }
    return { items, warnings };
  },

  async fetchProfile(ctx, account) {
    const client = await clientFor(ctx, account);
    const channelId = channelIdOf(account);
    const ch = await fetchChannel(client, channelId);
    if (!ch) throw new MetaError({ code: 100, message: `YouTube channel ${channelId} not found`, endpoint: '/channels', source: 'google' });
    const info = mapChannel(ch);
    channelCache.set(channelId, { uploadsPlaylistId: info.uploadsPlaylistId, publishedAt: info.publishedAt });
    return profileOf(info);
  },

  async fetchPosts(ctx, account, { sinceUnix, max } = {}) {
    const client = await clientFor(ctx, account);
    const channelId = channelIdOf(account);
    const { uploadsPlaylistId } = await channelInfo(client, channelId);
    if (!uploadsPlaylistId) return [];
    const uploads = await listUploads(client, uploadsPlaylistId, { sinceMs: sinceUnix ? sinceUnix * 1000 : 0, ...(max ? { max } : {}) });
    if (!uploads.length) return [];
    const videos = (await fetchVideos(client, uploads.map((u) => u.videoId))).filter(isTrackable);
    let types = new Map();
    if (videos.length && !contentTypeUnsupported.has(channelId)) {
      const oldest = Math.min(...videos.map((v) => Date.parse(v.snippet?.publishedAt ?? '') || Date.now()));
      try {
        types = await fetchContentTypes(client, videos.map((v) => v.id), { startDate: isoDate(oldest), endDate: isoDate(Date.now()) });
      } catch (e) {
        if (!softAnalytics(e)) throw e;
        contentTypeUnsupported.add(channelId);
      }
    }
    const posts = videos.map((v) => mapVideo(v, types.get(v.id) ?? null));
    return posts; // Post.durationS is stored by platformAccount.js (upsertMedia → media.duration_s)
  },

  /** Per-post variant (platformAccount.js uses the batch hook). */
  async fetchPostInsights(ctx, post, { account } = {}) {
    const { values } = await youtube.fetchPostInsightsBatch(ctx, account, [post]);
    return { values: values[post.mediaId] ?? {}, dropped: [] };
  },

  /**
   * videos.list per 50 posts (real-time views/likes/comments, 1 unit) + one Analytics video report per 200 posts
   * (watch time, average view duration/percentage, shares). Counts take the larger of both (Analytics lags 2–3 days).
   * An Analytics refusal is logged and the statistics are kept.
   */
  async fetchPostInsightsBatch(ctx, account, posts) {
    const client = await clientFor(ctx, account);
    const byVideo = new Map(posts.map((p) => [videoIdOf(p), p.mediaId]));
    const ids = [...byVideo.keys()];
    const stats = new Map((await fetchVideos(client, ids)).map((v) => [v.id, statsOf(v)]));
    let analytics = new Map();
    try {
      const published = channelCache.get(channelIdOf(account))?.publishedAt;
      analytics = await fetchVideoMetrics(client, ids, { startDate: published ? isoDate(Date.parse(published)) : FIRST_YOUTUBE_DAY, endDate: isoDate(Date.now()) });
    } catch (e) {
      if (!softAnalytics(e)) throw e;
      ctx.log?.({ endpoint: 'youtubeAnalytics:video', code: e.code, message: e.message });
    }
    const values = {};
    for (const [videoId, mediaId] of byVideo) {
      const s = stats.get(videoId) ?? {};
      const a = analytics.get(videoId) ?? {};
      const merged = { ...a, ...s };
      for (const k of ['views', 'likes', 'comments']) if (a[k] != null || s[k] != null) merged[k] = Math.max(a[k] ?? 0, s[k] ?? 0);
      if (Object.keys(merged).length) values[mediaId] = merged;
    }
    return { values, dropped: [] };
  },

  async fetchDailyInsights(ctx, account, { sinceUnix, untilUnix }) {
    const client = await clientFor(ctx, account);
    const startDate = isoDate(sinceUnix * 1000);
    const endDate = isoDate(Math.max(sinceUnix, untilUnix) * 1000);
    try {
      return { series: await fetchDailyChannel(client, { startDate, endDate }), dropped: [] };
    } catch (e) {
      if (!softAnalytics(e)) throw e;
      return { series: {}, dropped: [{ metric: 'youtubeAnalytics', message: e.message }] };
    }
  },

  /** Weekly (job-driven). Small channels get no demographics (Analytics withholds them) → empty, not an error. */
  async fetchDemographics(ctx, account) {
    const client = await clientFor(ctx, account);
    const end = Date.now();
    try {
      return { dimensions: await fetchDemographicsReport(client, { startDate: isoDate(end - DEMOGRAPHICS_DAYS * DAY), endDate: isoDate(end) }), dropped: [] };
    } catch (e) {
      if (!softAnalytics(e)) throw e;
      return { dimensions: {}, dropped: [] };
    }
  },

  refreshToken: (profile) => refreshProfileToken(profile),
  maintenance: () => youtubeMaintenance(),
  computeKpi,
  inbox: youtubeInbox,
  reportSections: youtubeReportSections,
  demo: youtubeDemo,
};

/** Test hook: forget cached channel info / content-type support. */
export function __resetYouTubeProviderForTests() {
  channelCache.clear();
  contentTypeUnsupported.clear();
}

export default youtube;
