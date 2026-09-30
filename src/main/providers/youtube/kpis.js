import { insightSeries } from '../../db/queries/accounts.js';
import { pctChange, round } from '../../analytics/util.js';

/**
 * provider.computeKpi (analytics/account.js): KPI keys that are not plain daily sums.
 *  - avgViewDuration: views-weighted mean of the daily averageViewDuration (seconds).
 *  - newFollowers: net subscribers = Σ subscribersGained − Σ subscribersLost from Analytics (exact, unlike the
 *    3-significant-figure subscriberCount snapshots); undefined (snapshot fallback) when no daily data exists.
 * Everything else returns undefined → default handling (meta.kpis.dailyMetric sums, posts, …).
 */
export function weightedAvgDuration(rows) {
  let views = 0;
  let weighted = 0;
  for (const r of rows) {
    const v = Number(r.views ?? 0);
    const d = Number(r.avg_view_duration_s);
    if (v > 0 && Number.isFinite(d)) { views += v; weighted += v * d; }
  }
  return views > 0 ? round(weighted / views, 0) : null;
}

function netSubscribers(rows) {
  const withData = rows.filter((r) => r.follower_count != null || r.unfollows != null);
  if (!withData.length) return undefined;
  return withData.reduce((s, r) => s + Number(r.follower_count ?? 0) - Number(r.unfollows ?? 0), 0);
}

const kpi = (value, prev) => ({ value, prev, changePct: pctChange(value, prev) });

export function computeKpi(key, { igId, from, to, prev }) {
  if (key === 'avgViewDuration') {
    const cur = weightedAvgDuration(insightSeries(igId, from, to, ['views', 'avg_view_duration_s']));
    const before = weightedAvgDuration(insightSeries(igId, prev.from, prev.to, ['views', 'avg_view_duration_s']));
    return kpi(cur, before);
  }
  if (key === 'newFollowers') {
    const cur = netSubscribers(insightSeries(igId, from, to, ['follower_count', 'unfollows']));
    if (cur === undefined) return undefined;
    const before = netSubscribers(insightSeries(igId, prev.from, prev.to, ['follower_count', 'unfollows'])) ?? null;
    return kpi(cur, before);
  }
  return undefined;
}
