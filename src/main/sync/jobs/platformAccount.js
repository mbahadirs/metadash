import { MetaError } from '../../meta/errors.js';
import { upsertAccount, insertSnapshot, markSynced, upsertInsightDaily, upsertDemographic, lastDemographicCapture, latestFollowers } from '../../db/queries/accounts.js';
import { upsertMedia, mediaForAccount, lastSnapshotAt, insertSnapshotMetric } from '../../db/queries/media.js';
import { storeComments } from '../../db/queries/comments.js';
import { disableMetric, markUnsupported } from '../../db/queries/sync.js';
import { materializeLatest } from '../../analytics/engagement.js';
import { fmtDate } from '../../analytics/util.js';
import { needsRefresh, DEFAULT_TIERS } from '../../providers/shared/tiers.js';
import { analyzeCaption } from '../caption.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const isSoftError = (e) => e instanceof MetaError && (e.isPermissionError || e.isInvalidParam);

/**
 * Syncs one account of any platform through its provider:
 * prepare → profile + snapshot → posts → post insights by refresh tier → daily account insights (chunked by
 * provider.dailyWindow) → demographics (weekly, when capable) → comments (optional) → markSynced.
 * Instagram metric drops keep the legacy disabled_metrics table; other platforms record them in metric_resolution.
 */
export async function syncPlatformAccount(ctx, provider, account) {
  const { settings, report, signal } = ctx;
  const platform = provider.platform;
  const key = account.igId;
  const log = (e) => ctx.log({ ...e, igId: key, platform });
  const now = Date.now();
  const disabled = settings.disabledMetrics ?? [];
  const overrides = settings.metricOverrides ?? null;
  const dropMetric = (scope) => (d) => {
    if (platform === 'instagram') disableMetric(d.metric, scope, d.message);
    else markUnsupported(platform, scope, d.metric, d.message);
    log({ endpoint: scope, code: 100, message: `metric dropped: ${d.metric} — ${d.message}` });
  };
  const delay = () => provider.client?.delay?.() ?? Promise.resolve();

  if (provider.prepare) await provider.prepare(ctx, account);

  // 1) profile + snapshot
  report('accounts');
  const profile = await provider.fetchProfile(ctx, account);
  upsertAccount({ ...profile, igId: key, profileId: account.profileId, pageId: account.pageId, platform, externalId: account.externalId ?? key });
  insertSnapshot({ igId: key, date: fmtDate(new Date(now)), followers: profile.followers, follows: profile.follows, mediaCount: profile.mediaCount, capturedAt: now });
  const followers = profile.followers ?? latestFollowers(key);
  await delay();

  // 2) posts (incremental: last sync − 2 days)
  report('media');
  const lookback = account.lastSyncedAt ? account.lastSyncedAt - 2 * DAY : now - (settings.mediaLookbackDays ?? 365) * DAY;
  const posts = await provider.fetchPosts(ctx, account, { sinceUnix: Math.floor(lookback / 1000) });
  const inline = new Map();
  for (const p of posts) {
    const posted = new Date(p.timestamp);
    upsertMedia({
      mediaId: p.mediaId, externalId: p.externalId ?? p.mediaId, igId: key, mediaType: p.mediaType, mediaProductType: p.mediaProductType,
      caption: p.caption, permalink: p.permalink, thumbnailPath: p.thumbnailUrl, postedAt: posted.getTime(),
      postedHour: posted.getHours(), postedWeekday: posted.getDay(), ...analyzeCaption(p.caption),
    });
    if (p.inline) inline.set(p.mediaId, p.inline);
  }
  if (signal?.aborted) return;

  // 3) post insights by refresh tier
  report('insights');
  const tiers = settings.refreshTiers ?? DEFAULT_TIERS;
  const candidates = mediaForAccount(key, now - (settings.mediaLookbackDays ?? 365) * DAY);
  for (const m of candidates) {
    if (signal?.aborted) return;
    const ageHours = Math.max(0, Math.floor((now - m.posted_at) / HOUR));
    const post = { mediaId: m.media_id, externalId: m.external_id ?? m.media_id, mediaProductType: m.media_product_type, mediaType: m.media_type };
    if (provider.skipInsights?.(post)) continue;
    if (!needsRefresh(ageHours, lastSnapshotAt(m.media_id), now, tiers)) continue;
    try {
      const { values: fetched, dropped } = await provider.fetchPostInsights(ctx, post, { account, disabled, overrides });
      dropped.forEach(dropMetric('media'));
      const values = inline.has(m.media_id) ? { ...inline.get(m.media_id), ...fetched } : fetched;
      const capturedAt = Date.now();
      for (const [metric, value] of Object.entries(values)) {
        if (typeof value === 'number') insertSnapshotMetric(m.media_id, capturedAt, ageHours, metric, value);
      }
      materializeLatest(m.media_id, values, followers, capturedAt);
    } catch (e) {
      if (isSoftError(e)) {
        log({ endpoint: `/${post.externalId}/insights`, code: e.code, message: e.message });
        continue;
      }
      throw e;
    }
    await delay();
  }

  // 4) account daily insights, chunked by the provider's window
  const win = provider.dailyWindow ?? { windowDays: 30, maxLookbackDays: 90, initialDays: 30 };
  const windowMs = win.windowDays * DAY;
  const sinceMs = account.lastSyncedAt ? account.lastSyncedAt - 2 * DAY : now - (win.initialDays ?? 30) * DAY;
  const floorMs = Math.max(now - win.maxLookbackDays * DAY, (win.minSinceUnix ?? 0) * 1000);
  for (let s = Math.max(sinceMs, floorMs); s < now; s += windowMs) {
    const u = Math.min(s + windowMs, now);
    const { series, dropped } = await provider.fetchDailyInsights(ctx, account, {
      sinceUnix: Math.floor(s / 1000), untilUnix: Math.floor(u / 1000), disabled, overrides,
    });
    dropped.forEach(dropMetric('account'));
    for (const [metric, points] of Object.entries(series)) {
      for (const p of points) if (typeof p.value === 'number') upsertInsightDaily(key, p.date, metric, p.value);
    }
    await delay();
  }

  // 5) demographics weekly
  if (provider.capabilities?.demographics && provider.fetchDemographics) {
    const lastDemo = lastDemographicCapture(key);
    if (!lastDemo || now - lastDemo > 7 * DAY) {
      try {
        const demo = await provider.fetchDemographics(ctx, account, { disabled, overrides });
        demo.dropped.forEach(dropMetric('account'));
        const capturedAt = Date.now();
        for (const [dim, buckets] of Object.entries(demo.dimensions)) {
          for (const b of buckets) upsertDemographic(key, capturedAt, dim, b.bucket, b.value);
        }
      } catch (e) {
        if (isSoftError(e)) log({ endpoint: 'demographics', code: e.code, message: e.message });
        else throw e;
      }
    }
  }

  // 6) comments (optional module)
  if (settings.syncComments && provider.fetchComments) {
    const recent = candidates.filter((m) => now - m.posted_at < 14 * DAY);
    for (const m of recent) {
      if (signal?.aborted) return;
      try {
        const comments = await provider.fetchComments(ctx, { mediaId: m.media_id, externalId: m.external_id ?? m.media_id }, { account });
        storeComments(m.media_id, comments, account.username);
      } catch (e) {
        if (isSoftError(e)) { log({ endpoint: 'comments', code: e.code, message: e.message }); break; }
        throw e;
      }
      await delay();
    }
  }

  markSynced(key, now);
}
