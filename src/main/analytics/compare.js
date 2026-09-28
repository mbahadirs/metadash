import { getAccount, snapshotSeries, insightSeries, followersAt, latestFollowers, insightSum } from '../db/queries/accounts.js';
import { listMedia, aggregateMedia } from '../db/queries/media.js';
import { rangeMs, eachDay, round, pctChange, previousPeriod, fmtDate } from './util.js';
import { healthScores } from './health.js';
import { paidFields } from './paid.js';
import { listAdAccounts, adTotals } from '../db/queries/ads.js';

const SERIES_COLORS = ['#4F7CFF', '#3FBF8F', '#E8B44A', '#C06CE8', '#E5605F', '#48C3D6'];
export const COMPARE_METRICS = ['reach', 'er', 'followers_growth', 'post_frequency', 'save_rate'];

/** Multi-series comparison over one metric; per-account colours are taken from accounts.color. */
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
  const seriesByAccount = accounts.map((a) => ({ igId: a.igId, username: a.username, color: a.color, points: metricSeries(a.igId, metric, from, to, days, fromMs, toMs) }));

  const table = accounts.map((a) => {
    const agg = aggregateMedia(a.igId, fromMs, toMs) ?? {};
    const prevAgg = aggregateMedia(a.igId, prevRange.fromMs, prevRange.toMs) ?? {};
    const followers = latestFollowers(a.igId);
    const start = followersAt(a.igId, from, 'after');
    const reach = insightSum(a.igId, from, to, 'reach');
    const prevReach = insightSum(a.igId, prev.from, prev.to, 'reach');
    return {
      igId: a.igId, username: a.username, clientName: a.clientName, color: a.color, followers,
      growth: followers != null && start != null ? followers - start : null,
      growthPct: pctChange(followers, start),
      reach, reachChangePct: pctChange(reach, prevReach),
      er: round(agg.avgEr, 2), erChangePct: pctChange(agg.avgEr, prevAgg.avgEr),
      saveRate: round((agg.saveRate ?? 0) * 100, 2),
      posts: agg.posts ?? 0,
      postsPerWeek: round(((agg.posts ?? 0) / prev.days) * 7, 1),
      health: health.get(a.igId) ?? null,
      ...(() => { const act = actByIg.get(a.igId); return paidFields(act ? adTotals([act.actId], from, to) : null, act); })(),
      totalReach: reach + (actByIg.get(a.igId) ? adTotals([actByIg.get(a.igId).actId], from, to).reach : 0),
    };
  });

  const merged = days.map((date, i) => Object.fromEntries([['date', date], ...seriesByAccount.map((s) => [s.igId, s.points[i]])]));
  return { metric, series: seriesByAccount, merged, table };
}

function metricSeries(igId, metric, from, to, days, fromMs, toMs) {
  if (metric === 'reach') {
    const m = new Map(insightSeries(igId, from, to, ['reach']).map((d) => [d.date, d.reach]));
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
