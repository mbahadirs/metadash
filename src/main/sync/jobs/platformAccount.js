import { MetaError } from '../../meta/errors.js';
import { upsertAccount, insertSnapshot, markSynced, upsertInsightDaily, upsertDemographic, lastDemographicCapture, latestFollowers } from '../../db/queries/accounts.js';
import { upsertMedia, mediaForAccount, lastSnapshotAt, insertSnapshotMetric } from '../../db/queries/media.js';
import { syncAccountComments } from '../../inbox/poller.js';
import { materializeDerivedSeries } from '../../analytics/derived.js';
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
 * prepare → profile + snapshot → posts → post insights by refresh tier (per post, or one provider.fetchPostInsightsBatch
 * call) → daily account insights (chunked by provider.dailyWindow; refetchTrailingDays re-reads revised days) →
 * derived daily series (capabilities.dailySeries 'derived') → demographics (weekly, when capable) →
 * comments (optional; inbox/poller.js) → markSynced.
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
      postedHour: posted.getHours(), postedWeekday: posted.getDay(), ...analyzeCaption(p.caption), durationS: p.durationS,
    });
    if (p.inline) inline.set(p.mediaId, p.inline);
  }
  if (signal?.aborted) return;

  // 3) post insights by refresh tier
  report('insights');
  const tiers = settings.refreshTiers ?? DEFAULT_TIERS;
  const candidates = mediaForAccount(key, now - (settings.mediaLookbackDays ?? 365) * DAY);
  const writeInsights = (m, ageHours, fetched) => {
    const values = inline.has(m.media_id) ? { ...inline.get(m.media_id), ...fetched } : fetched;
    const capturedAt = Date.now();
    for (const [metric, value] of Object.entries(values)) {
      if (typeof value === 'number') insertSnapshotMetric(m.media_id, capturedAt, ageHours, metric, value);
    }
    materializeLatest(m.media_id, values, followers, capturedAt);
  };
  if (provider.fetchPostInsightsBatch) {
    const due = [];
    for (const m of candidates) {
      const ageHours = Math.max(0, Math.floor((now - m.posted_at) / HOUR));
      const post = { mediaId: m.media_id, externalId: m.external_id ?? m.media_id, mediaProductType: m.media_product_type, mediaType: m.media_type };
      if (provider.skipInsights?.(post)) continue;
      if (!needsRefresh(ageHours, lastSnapshotAt(m.media_id), now, tiers)) continue;
      due.push({ m, ageHours, post });
    }
    if (due.length) {
      try {
        const { values: byMedia, dropped } = await provider.fetchPostInsightsBatch(ctx, account, due.map((d) => d.post), { disabled, overrides });
        (dropped ?? []).forEach(dropMetric('media'));
        for (const d of due) if (byMedia?.[d.m.media_id]) writeInsights(d.m, d.ageHours, byMedia[d.m.media_id]);
      } catch (e) {
        if (!isSoftError(e)) throw e;
        log({ endpoint: 'insights:batch', code: e.code, message: e.message });
      }
      await delay();
    }
  }
  for (const m of provider.fetchPostInsightsBatch ? [] : candidates) {
    if (signal?.aborted) return;
    const ageHours = Math.max(0, Math.floor((now - m.posted_at) / HOUR));
    const post = { mediaId: m.media_id, externalId: m.external_id ?? m.media_id, mediaProductType: m.media_product_type, mediaType: m.media_type };
    if (provider.skipInsights?.(post)) continue;
    if (!needsRefresh(ageHours, lastSnapshotAt(m.media_id), now, tiers)) continue;
    try {
      const { values: fetched, dropped } = await provider.fetchPostInsights(ctx, post, { account, disabled, overrides });
      dropped.forEach(dropMetric('media'));
      writeInsights(m, ageHours, fetched);
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
  const incrementalMs = account.lastSyncedAt ? account.lastSyncedAt - 2 * DAY : now - (win.initialDays ?? 30) * DAY;
  // Providers with revised data (YouTube Analytics lags 2–3 days) re-read the trailing N days on every sync.
  const sinceMs = win.refetchTrailingDays ? Math.min(incrementalMs, now - win.refetchTrailingDays * DAY) : incrementalMs;
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

  // 4b) derived daily series (no native daily insights, e.g. TikTok): follower_count / views from snapshot deltas
  if (provider.capabilities?.dailySeries === 'derived') materializeDerivedSeries(key);

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

  // 6) comments (optional module; inbox/poller.js — chunk D generalises it to every inbox adapter)
  if (settings.syncComments) {
    await syncAccountComments(ctx, provider, account, { candidates, now, log, delay, signal });
    if (signal?.aborted) return;
  }

  markSynced(key, now);
}
