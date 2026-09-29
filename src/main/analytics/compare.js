import { getAccount, snapshotSeries, insightSeries, followersAt, latestFollowers, insightSum } from '../db/queries/accounts.js';
import { listMedia, aggregateMedia } from '../db/queries/media.js';
import { rangeMs, eachDay, round, pctChange, previousPeriod, fmtDate } from './util.js';
import { healthScores } from './health.js';
import { paidFields } from './paid.js';
import { listAdAccounts, adTotals } from '../db/queries/ads.js';
import { platformOf, capabilitiesFor, primaryMetricFor, platformsIn } from './platform.js';

const SERIES_COLORS = ['#4F7CFF', '#3FBF8F', '#E8B44A', '#C06CE8', '#E5605F', '#48C3D6'];
export const COMPARE_METRICS = ['reach', 'er', 'followers_growth', 'post_frequency', 'save_rate'];

/**
 * Multi-series comparison over one metric; per-account colours are taken from accounts.color.
 * Mixed platforms: 'reach' falls back to the platform's primary metric (views on Threads) — each series says which
 * `metric` it plotted; 'save_rate' is unsupported (all-null points, listed in `unsupported`) where the platform has no saves.
 */
export function compare({ igIds, from, to, metric = 'reach' }) {
  const ids = (igIds ?? []).slice(0, 6);
  const days = eachDay(from, to);
  const { fromMs, toMs } = rangeMs(from, to);
  const prev = previousPeriod(from, to);
  const prevRange = rangeMs(prev.from, prev.to);
  const health = new Map(healthScores({ from, to, igIds: ids }).map((h) => [h.igId, h.score]));
  const actByIg = new Map(listAdAccounts().filter((x) => x.isTracked && x.linkedIgId).map((x) => [x.linkedIgId, x]));

  const raw = ids.map((igId) => getAccount(igId)).filter(Boolean);
  // Account colours come from a 6-colour palette; when two selected accounts collide, fall back to selection order.
  const distinct = new Set(raw.map((a) => a.color)).size === raw.length;
  const accounts = raw.map((a, i) => ({ ...a, color: distinct && a.color ? a.color : SERIES_COLORS[i % SERIES_COLORS.length] }));
  const unsupported = metric === 'save_rate' ? accounts.filter((a) => !capabilitiesFor(platformOf(a)).saveRate).map((a) => a.igId) : [];
  const seriesByAccount = accounts.map((a) => {
    const platform = platformOf(a);
    const caps = capabilitiesFor(platform);
    const used = metric === 'reach' && !caps.reach ? primaryMetricFor(platform) : metric;
    if (unsupported.includes(a.igId)) {
      return { igId: a.igId, username: a.username, color: a.color, platform, metric: used, points: days.map(() => null) };
    }
    return { igId: a.igId, username: a.username, color: a.color, platform, metric: used, points: metricSeries(a.igId, used, from, to, days, fromMs, toMs) };
  });

  const table = accounts.map((a) => {
    const agg = aggregateMedia(a.igId, fromMs, toMs) ?? {};
    const prevAgg = aggregateMedia(a.igId, prevRange.fromMs, prevRange.toMs) ?? {};
    const followers = latestFollowers(a.igId);
    const start = followersAt(a.igId, from, 'after');
    const platform = platformOf(a);
    const caps = capabilitiesFor(platform);
    const primaryMetric = primaryMetricFor(platform);
    const reach = caps.reach ? insightSum(a.igId, from, to, 'reach') : null;
    const prevReach = caps.reach ? insightSum(a.igId, prev.from, prev.to, 'reach') : null;
    const views = insightSum(a.igId, from, to, 'views');
    const prevViews = insightSum(a.igId, prev.from, prev.to, 'views');
    return {
      igId: a.igId, username: a.username, clientName: a.clientName, color: a.color, followers,
      platform, primaryMetric, views, viewsChangePct: pctChange(views, prevViews),
      primaryValue: primaryMetric === 'reach' ? reach : views,
      primaryChangePct: primaryMetric === 'reach' ? pctChange(reach, prevReach) : pctChange(views, prevViews),
      growth: followers != null && start != null ? followers - start : null,
      growthPct: pctChange(followers, start),
      reach, reachChangePct: caps.reach ? pctChange(reach, prevReach) : null,
      er: round(agg.avgEr, 2), erChangePct: pctChange(agg.avgEr, prevAgg.avgEr),
      saveRate: caps.saveRate ? round((agg.saveRate ?? 0) * 100, 2) : null,
      posts: agg.posts ?? 0,
      postsPerWeek: round(((agg.posts ?? 0) / prev.days) * 7, 1),
      health: health.get(a.igId) ?? null,
      ...(() => { const act = actByIg.get(a.igId); return paidFields(act ? adTotals([act.actId], from, to) : null, act); })(),
      totalReach: (reach ?? 0) + (actByIg.get(a.igId) ? adTotals([actByIg.get(a.igId).actId], from, to).reach : 0),
    };
  });

  const merged = days.map((date, i) => Object.fromEntries([['date', date], ...seriesByAccount.map((s) => [s.igId, s.points[i]])]));
  const platforms = platformsIn(accounts);
  return { metric, series: seriesByAccount, merged, table, platforms, mixedPlatforms: platforms.length > 1, unsupported };
}

function metricSeries(igId, metric, from, to, days, fromMs, toMs) {
  if (metric === 'reach' || metric === 'views') {
    const m = new Map(insightSeries(igId, from, to, [metric]).map((d) => [d.date, d[metric]]));
    return days.map((d) => m.get(d) ?? 0);
  }
  if (metric === 'followers_growth') {
    const snaps = snapshotSeries(igId, from, to);
    const m = new Map(snaps.map((s) => [s.date, s.followers]));
    const base = snaps[0]?.followers ?? 0;
    let last = base;
    return days.map((d) => {
      if (m.has(d)) last = m.get(d);
      return last - base;
    });
  }
  const posts = listMedia({ igIds: [igId], from: fromMs, to: toMs });
  const byDay = new Map();
  for (const p of posts) {
    const d = fmtDate(new Date(p.postedAt));
    byDay.set(d, [...(byDay.get(d) ?? []), p]);
  }
  if (metric === 'post_frequency') {
    let acc = 0;
    return days.map((d) => { acc += byDay.get(d)?.length ?? 0; return acc; });
  }
  // er / save_rate: 7-day rolling average
  const daily = days.map((d) => {
    const list = byDay.get(d) ?? [];
    const vals = list.map((p) => (metric === 'er' ? p.engagementRate : p.reach ? ((p.saved ?? 0) / p.reach) * 100 : null)).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  return daily.map((_, i) => {
    const window = daily.slice(Math.max(0, i - 6), i + 1).filter((v) => v != null);
    return window.length ? round(window.reduce((a, b) => a + b, 0) / window.length, 2) : null;
  });
}
