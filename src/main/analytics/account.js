import { getAccount, followersAt, latestFollowers, snapshotSeries, insightSeries, insightSum, latestDemographics } from '../db/queries/accounts.js';
import { listMedia, aggregateMedia, aggregateByType, commentStats } from '../db/queries/media.js';
import { listStories, storySummary } from '../db/queries/stories.js';
import { q } from '../db/index.js';
import { previousPeriod, rangeMs, pctChange, round, eachDay } from './util.js';
import { healthScores } from './health.js';
import { paidFields } from './paid.js';
import { adAccountForIg, adTotals, listAdAccounts } from '../db/queries/ads.js';
import { platformOf, capabilitiesFor, primaryMetricFor, kpiKeysFor, chartMetricsFor, dailyMetricsFor, KPI_DAILY_METRIC } from './platform.js';

const kpi = (value, prev) => ({ value, prev, changePct: pctChange(value, prev) });

/** KPI tiles that apply to the account's platform (see platform.js kpiKeysFor); keys not listed are omitted. */
function buildKpis(igId, platform, { from, to, prev, agg, prevAgg, newFollowers, prevNew }) {
  const out = {};
  for (const key of kpiKeysFor(platform)) {
    if (KPI_DAILY_METRIC[key]) {
      const metric = KPI_DAILY_METRIC[key];
      out[key] = kpi(insightSum(igId, from, to, metric), insightSum(igId, prev.from, prev.to, metric));
    } else if (key === 'er') {
      out.er = { value: round(agg.avgEr, 2), prev: round(prevAgg.avgEr, 2), changePct: pctChange(agg.avgEr, prevAgg.avgEr) };
    } else if (key === 'saveRate') {
      out.saveRate = { value: round((agg.saveRate ?? 0) * 100, 2), prev: round((prevAgg.saveRate ?? 0) * 100, 2), changePct: pctChange(agg.saveRate, prevAgg.saveRate) };
    } else if (key === 'newFollowers') {
      out.newFollowers = kpi(newFollowers, prevNew);
    } else if (key === 'posts') {
      out.posts = { value: agg.posts ?? 0, prev: prevAgg.posts ?? 0, changePct: pctChange(agg.posts, prevAgg.posts) };
    }
  }
  return out;
}

/**
 * Account screen data. Platform-aware: `platform`, `capabilities`, `primaryMetric`, `kpiKeys` (ordered KPI tiles),
 * `chartMetrics` ([primary, secondary] daily series) and `kpis` holding only the keys in `kpiKeys`.
 */
export function accountAnalytics({ igId, from, to }) {
  const account = getAccount(igId);
  if (!account) return null;
  const platform = platformOf(account);
  const capabilities = capabilitiesFor(platform);
  const prev = previousPeriod(from, to);
  const { fromMs, toMs } = rangeMs(from, to);
  const prevRange = rangeMs(prev.from, prev.to);

  const agg = aggregateMedia(igId, fromMs, toMs) ?? {};
  const prevAgg = aggregateMedia(igId, prevRange.fromMs, prevRange.toMs) ?? {};
  const followers = latestFollowers(igId);
  const startFollowers = followersAt(igId, from, 'after');
  const prevStart = followersAt(igId, prev.from, 'after');
  const prevEnd = followersAt(igId, prev.to, 'before');
  const newFollowers = followers != null && startFollowers != null ? followers - startFollowers : null;
  const prevNew = prevEnd != null && prevStart != null ? prevEnd - prevStart : null;

  const dailyMetrics = dailyMetricsFor(platform);
  const chartMetrics = chartMetricsFor(platform);
  const dailyMap = new Map(insightSeries(igId, from, to, dailyMetrics).map((d) => [d.date, d]));
  const zeros = Object.fromEntries(dailyMetrics.map((m) => [m, 0]));
  const series = eachDay(from, to).map((date) => ({ date, ...zeros, ...(dailyMap.get(date) ?? {}) }));
  const prevDaily = insightSeries(igId, prev.from, prev.to, chartMetrics);
  const followerSeries = snapshotSeries(igId, from, to);
  const posts = listMedia({ igIds: [igId], from: fromMs, to: toMs });
  const health = healthScores({ from, to }).find((h) => h.igId === igId) ?? null;
  const actRef = capabilities.ads ? adAccountForIg(igId) : null;
  const act = actRef ? listAdAccounts().find((x) => x.actId === actRef.actId) ?? null : null;
  const paid = act ? { ...paidFields(adTotals([act.actId], from, to), act), prev: paidFields(adTotals([act.actId], prev.from, prev.to), act), actId: act.actId, name: act.name } : null;

  return {
    account: { ...account, followers },
    platform,
    capabilities,
    primaryMetric: primaryMetricFor(platform),
    kpiKeys: kpiKeysFor(platform),
    chartMetrics,
    period: { from, to, prevFrom: prev.from, prevTo: prev.to, days: prev.days },
    kpis: buildKpis(igId, platform, { from, to, prev, agg, prevAgg, newFollowers, prevNew }),
    series,
    prevSeries: prevDaily,
    followerSeries,
    posts,
    byType: aggregateByType(igId, fromMs, toMs).map((t) => ({ ...t, avgEr: round(t.avgEr, 2), avgReach: capabilities.reach ? Math.round(t.avgReach ?? 0) : null })),
    comments: commentStats(igId, fromMs, toMs), // empty stats on platforms without comments (capabilities.comments false)
    health,
    paid,
  };
}

export function accountStories({ igId, from, to }) {
  const { fromMs, toMs } = rangeMs(from, to);
  return { stories: listStories(igId, fromMs, toMs), summary: storySummary(igId, fromMs, toMs) };
}

/**
 * Latest follower demographics. Instagram stores city/country/gender_age; Threads stores separate age and gender
 * dimensions (plus city/country), returned as `age` and `gender` (empty arrays when absent).
 */
export function accountDemographics({ igId }) {
  const base = latestDemographics(igId);
  if (!base.capturedAt) return { ...base, age: [], gender: [] };
  const rows = q.all(
    "SELECT dimension, bucket, value FROM account_demographics WHERE ig_id = ? AND captured_at = ? AND dimension IN ('age', 'gender') ORDER BY value DESC",
    igId, base.capturedAt,
  );
  const pick = (dim) => rows.filter((r) => r.dimension === dim).map(({ bucket, value }) => ({ bucket, value }));
  return { ...base, age: pick('age').sort((a, b) => a.bucket.localeCompare(b.bucket)), gender: pick('gender') };
}
