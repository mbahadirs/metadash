import { subDays, differenceInHours } from 'date-fns';
import * as organic from '../../meta/organic.js';
import { graphDelay } from '../../meta/client.js';
import { MetaError } from '../../meta/errors.js';
import { upsertAccount, insertSnapshot, markSynced, upsertInsightDaily, upsertDemographic, lastDemographicCapture, latestFollowers } from '../../db/queries/accounts.js';
import { upsertMedia, mediaForAccount, lastSnapshotAt, insertSnapshotMetric, upsertComment } from '../../db/queries/media.js';
import { disableMetric } from '../../db/queries/sync.js';
import { materializeLatest } from '../../analytics/engagement.js';
import { fmtDate } from '../../analytics/util.js';
import { analyzeCaption } from '../caption.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Which posts need an insight refresh right now, by age tier (hours between refreshes). */
export function needsRefresh(ageHours, lastCapturedAt, now, tiers) {
  if (!lastCapturedAt) return true;
  const sinceLast = (now - lastCapturedAt) / HOUR;
  if (ageHours <= 48) return true;
  if (ageHours <= 24 * 7) return sinceLast >= tiers.recent;
  if (ageHours <= 24 * 30) return sinceLast >= tiers.month;
  return sinceLast >= tiers.old;
}

export async function syncOrganicAccount(ctx, account) {
  const { token, settings, report, log, signal } = ctx;
  const now = Date.now();
  const disabled = settings.disabledMetrics ?? [];
  const overrides = settings.metricOverrides ?? null;
  const dropMetric = (scope) => (d) => {
    disableMetric(d.metric, scope, d.message);
    log({ igId: account.igId, endpoint: scope, code: 100, message: `metric dropped: ${d.metric} — ${d.message}` });
  };

  // 1) profile + snapshot
  report('accounts');
  const profile = await organic.fetchAccountProfile(account.igId, token);
  upsertAccount({ ...profile, profileId: account.profileId, pageId: account.pageId });
  insertSnapshot({ igId: account.igId, date: fmtDate(new Date(now)), followers: profile.followers, follows: profile.follows, mediaCount: profile.mediaCount, capturedAt: now });
  const followers = profile.followers ?? latestFollowers(account.igId);
  await graphDelay();

  // 2) media list (incremental: last sync − 2 days)
  report('media');
  const lookback = account.lastSyncedAt ? account.lastSyncedAt - 2 * DAY : now - (settings.mediaLookbackDays ?? 365) * DAY;
  const items = await organic.fetchMedia(account.igId, token, { sinceUnix: Math.floor(lookback / 1000) });
  for (const m of items) {
    const posted = new Date(m.timestamp);
    upsertMedia({
      mediaId: m.mediaId, igId: account.igId, mediaType: m.mediaType, mediaProductType: m.mediaProductType,
      caption: m.caption, permalink: m.permalink, thumbnailPath: m.thumbnailUrl, postedAt: posted.getTime(),
      postedHour: posted.getHours(), postedWeekday: posted.getDay(), ...analyzeCaption(m.caption),
    });
  }
  if (signal?.aborted) return;

  // 3) media insights by refresh tier
  report('insights');
  const tiers = settings.refreshTiers ?? { fresh: 48, recent: 24, month: 168, old: 720 };
  const candidates = mediaForAccount(account.igId, now - (settings.mediaLookbackDays ?? 365) * DAY);
  for (const m of candidates) {
    if (signal?.aborted) return;
    const ageHours = Math.max(0, Math.floor((now - m.posted_at) / HOUR));
    if (m.media_product_type === 'STORY') continue;
    if (!needsRefresh(ageHours, lastSnapshotAt(m.media_id), now, tiers)) continue;
    try {
      const { values, dropped } = await organic.fetchMediaInsights(
        { mediaId: m.media_id, mediaProductType: m.media_product_type, mediaType: m.media_type }, token, { disabled, overrides },
      );
      dropped.forEach(dropMetric('media'));
      const capturedAt = Date.now();
      for (const [metric, value] of Object.entries(values)) {
        if (typeof value === 'number') insertSnapshotMetric(m.media_id, capturedAt, ageHours, metric, value);
      }
      materializeLatest(m.media_id, values, followers, capturedAt);
    } catch (e) {
      if (e instanceof MetaError && (e.isPermissionError || e.isInvalidParam)) {
        log({ igId: account.igId, endpoint: `/${m.media_id}/insights`, code: e.code, message: e.message });
        continue;
      }
      throw e;
    }
    await graphDelay();
  }

  // 4) account daily insights (max 30-day window per request)
  const sinceMs = account.lastSyncedAt ? account.lastSyncedAt - 2 * DAY : now - 30 * DAY;
  const chunks = [];
  for (let s = Math.max(sinceMs, now - 90 * DAY); s < now; s += 30 * DAY) chunks.push([s, Math.min(s + 30 * DAY, now)]);
  for (const [s, u] of chunks) {
    const { series, dropped } = await organic.fetchAccountInsightsDaily(account.igId, token, {
      sinceUnix: Math.floor(s / 1000), untilUnix: Math.floor(u / 1000), disabled, overrides,
    });
    dropped.forEach(dropMetric('account'));
    for (const [metric, points] of Object.entries(series)) {
      for (const p of points) if (typeof p.value === 'number') upsertInsightDaily(account.igId, p.date, metric, p.value);
    }
    try {
      const fc = await organic.fetchFollowerCountSeries(account.igId, token, { sinceUnix: Math.floor(s / 1000), untilUnix: Math.floor(u / 1000) });
      for (const p of fc) if (typeof p.value === 'number') upsertInsightDaily(account.igId, p.date, 'follower_count', p.value);
    } catch (e) {
      if (!(e instanceof MetaError && e.isInvalidParam)) throw e;
    }
    await graphDelay();
  }

  // 5) demographics weekly
  const lastDemo = lastDemographicCapture(account.igId);
  if (!lastDemo || now - lastDemo > 7 * DAY) {
    try {
      const demo = await organic.fetchDemographics(account.igId, token, { disabled, overrides });
      demo.dropped.forEach(dropMetric('account'));
      const capturedAt = Date.now();
      for (const [dim, key] of [['city', 'city'], ['gender_age', 'genderAge'], ['country', 'country']]) {
        for (const b of demo[key]) upsertDemographic(account.igId, capturedAt, dim, b.bucket, b.value);
      }
    } catch (e) {
      if (e instanceof MetaError && (e.isPermissionError || e.isInvalidParam)) log({ igId: account.igId, endpoint: 'demographics', code: e.code, message: e.message });
      else throw e;
    }
  }

  // 6) comments (optional module)
  if (settings.syncComments) {
    const recent = candidates.filter((m) => now - m.posted_at < 14 * DAY);
    for (const m of recent) {
      if (signal?.aborted) return;
      try {
        const comments = await organic.fetchComments(m.media_id, token);
        storeComments(m.media_id, comments, account.username);
      } catch (e) {
        if (e instanceof MetaError && (e.isPermissionError || e.isInvalidParam)) { log({ igId: account.igId, endpoint: 'comments', code: e.code, message: e.message }); break; }
        throw e;
      }
      await graphDelay();
    }
  }

  markSynced(account.igId, now);
}

function storeComments(mediaId, comments, ownerUsername) {
  for (const c of comments) {
    const createdAt = new Date(c.timestamp).getTime();
    upsertComment({ commentId: c.id, mediaId, username: c.username, text: c.text, likeCount: c.like_count, createdAt, isFromOwner: c.username === ownerUsername, parentId: null });
    for (const r of c.replies?.data ?? []) {
      const rAt = new Date(r.timestamp).getTime();
      const fromOwner = r.username === ownerUsername;
      upsertComment({ commentId: r.id, mediaId, username: r.username, text: r.text ?? '', likeCount: 0, createdAt: rAt, isFromOwner: fromOwner, parentId: c.id, replyLatencyMinutes: fromOwner ? Math.round((rAt - createdAt) / 60_000) : null });
    }
  }
}

export { differenceInHours, subDays };
