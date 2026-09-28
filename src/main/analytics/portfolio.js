import { listAccounts, followersAt, latestFollowers, snapshotSeries, insightSum, insightSumAll } from '../db/queries/accounts.js';
import { aggregateMedia, lastPostAt, postCounts } from '../db/queries/media.js';
import { adTotals, listAdAccounts, adTotalsByAccount } from '../db/queries/ads.js';
import { accountsWithRecentErrors } from '../db/queries/sync.js';
import { healthScores } from './health.js';
import { anomalies } from './anomaly.js';
import { previousPeriod, rangeMs, pctChange, round, fmtDate, toDate, mean } from './util.js';
import { subDays } from 'date-fns';
import { paidFields } from './paid.js';

/** Portfolio table + KPI strip for the Overview screen. */
export function portfolio({ from, to, tagIds } = {}) {
  const accounts = listAccounts({ tagIds });
  const prev = previousPeriod(from, to);
  const { fromMs, toMs } = rangeMs(from, to);
  const prevRange = rangeMs(prev.from, prev.to);
  const health = new Map(healthScores({ from, to, igIds: accounts.map((a) => a.igId) }).map((h) => [h.igId, h]));
  const anomalyList = anomalies({ from, to, igIds: accounts.map((a) => a.igId) });
  const anomalyByAcc = new Map();
  for (const an of anomalyList) anomalyByAcc.set(an.igId, [...(anomalyByAcc.get(an.igId) ?? []), an]);
  const errors = new Map(accountsWithRecentErrors(Date.now() - 3 * 86_400_000).map((e) => [e.igId, e]));
  const sparkFrom = fmtDate(subDays(toDate(to), 29));
  const now = Date.now();
  const actByIg = new Map(listAdAccounts().filter((x) => x.isTracked && x.linkedIgId).map((x) => [x.linkedIgId, x]));
  const paidByAct = adTotalsByAccount(from, to);

  const rows = accounts.map((a) => {
    const followers = latestFollowers(a.igId);
    const startFollowers = followersAt(a.igId, from, 'after');
    const prevStart = followersAt(a.igId, prev.from, 'after');
    const prevEnd = followersAt(a.igId, prev.to, 'before');
    const agg = aggregateMedia(a.igId, fromMs, toMs) ?? {};
    const prevAgg = aggregateMedia(a.igId, prevRange.fromMs, prevRange.toMs) ?? {};
    const reach = insightSum(a.igId, from, to, 'reach');
    const prevReach = insightSum(a.igId, prev.from, prev.to, 'reach');
    const lastPost = lastPostAt(a.igId);
    const daysSincePost = lastPost ? Math.floor((now - lastPost) / 86_400_000) : null;
    const act = actByIg.get(a.igId) ?? null;
    const paid = act ? paidByAct.get(act.actId) ?? null : null;
    return {
      ...paidFields(paid, act), spendCurrency: act?.currency ?? null,
      totalReach: reach + (paid?.reach ?? 0), paidShare: reach + (paid?.reach ?? 0) > 0 ? round(((paid?.reach ?? 0) / (reach + (paid?.reach ?? 0))) * 100, 1) : null,
      ...a,
      followers,
      followersChange: followers != null && startFollowers != null ? followers - startFollowers : null,
      followersChangePct: pctChange(followers, startFollowers),
      prevFollowersChange: prevEnd != null && prevStart != null ? prevEnd - prevStart : null,
      reach,
      reachChangePct: pctChange(reach, prevReach),
      posts: agg.posts ?? 0,
      postsPrev: prevAgg.posts ?? 0,
      er: round(agg.avgEr, 2),
      erChangePct: pctChange(agg.avgEr, prevAgg.avgEr),
      saveRate: round((agg.saveRate ?? 0) * 100, 2),
      health: health.get(a.igId)?.score ?? null,
      sparkline: snapshotSeries(a.igId, sparkFrom, to).map((s) => s.followers),
      lastPostAt: lastPost,
      daysSincePost,
      anomalies: anomalyByAcc.get(a.igId) ?? [],
      syncError: errors.get(a.igId) ?? null,
    };
  });

  const ids = accounts.map((a) => a.igId);
  const adAccounts = listAdAccounts().filter((ad) => ad.isTracked && (!ids.length || !ad.linkedIgId || ids.includes(ad.linkedIgId)));
  const currencies = [...new Set(adAccounts.map((x) => x.currency ?? 'USD'))];
  const byCurrency = Object.fromEntries(currencies.map((c) => {
    const acts = adAccounts.filter((x) => (x.currency ?? 'USD') === c).map((x) => x.actId);
    return [c, { value: round(adTotals(acts, from, to).spend, 2), prev: round(adTotals(acts, prev.from, prev.to).spend, 2) }];
  }));
  const mainCurrency = currencies.sort((a, b) => (byCurrency[b].value ?? 0) - (byCurrency[a].value ?? 0))[0] ?? 'USD';
  const spend = byCurrency[mainCurrency] ?? { value: 0, prev: 0 };
  const prevSpend = { spend: spend.prev };
  spend.spend = spend.value;
  const totalFollowers = rows.reduce((s, r) => s + (r.followers ?? 0), 0);
  const totalReach = insightSumAll(from, to, 'reach', ids);
  const prevTotalReach = insightSumAll(prev.from, prev.to, 'reach', ids);
  const totalPosts = rows.reduce((s, r) => s + r.posts, 0);
  const prevTotalPosts = rows.reduce((s, r) => s + r.postsPrev, 0);
  const avgEr = mean(rows.map((r) => r.er));
  const prevAvgEr = mean(rows.map((r) => (r.erChangePct != null && r.er != null ? r.er / (1 + r.erChangePct / 100) : null)));
  const netChange = rows.reduce((s, r) => s + (r.followersChange ?? 0), 0);
  const prevNetChange = rows.reduce((s, r) => s + (r.prevFollowersChange ?? 0), 0);

  return {
    period: { from, to, prevFrom: prev.from, prevTo: prev.to, days: prev.days },
    kpis: {
      totalFollowers: { value: totalFollowers, changePct: pctChange(totalFollowers, totalFollowers - netChange) },
      netFollowers: { value: netChange, prev: prevNetChange, changePct: pctChange(netChange, prevNetChange) },
      totalReach: { value: totalReach, prev: prevTotalReach, changePct: pctChange(totalReach, prevTotalReach) },
      avgEr: { value: round(avgEr, 2), prev: round(prevAvgEr, 2), changePct: pctChange(avgEr, prevAvgEr) },
      totalSpend: { value: round(spend.spend, 2), prev: round(prevSpend.spend, 2), changePct: pctChange(spend.spend, prevSpend.spend), currency: mainCurrency, byCurrency },
      totalPosts: { value: totalPosts, prev: prevTotalPosts, changePct: pctChange(totalPosts, prevTotalPosts) },
    },
    rows,
    attention: {
      anomalies: anomalyList.slice(0, 20),
      silent: rows.filter((r) => r.daysSincePost == null || r.daysSincePost >= 7).map((r) => ({ igId: r.igId, username: r.username, daysSincePost: r.daysSincePost })),
      errors: rows.filter((r) => r.syncError).map((r) => ({ igId: r.igId, username: r.username, code: r.syncError.code, message: r.syncError.message })),
    },
  };
}

export function leaderboard({ from, to, metric = 'reach', tagIds, limit = 10 }) {
  const p = portfolio({ from, to, tagIds });
  const key = { reach: 'reach', er: 'er', growth: 'followersChangePct', saveRate: 'saveRate', health: 'health', posts: 'posts' }[metric] ?? 'reach';
  const sorted = [...p.rows].filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]);
  return { metric, top: sorted.slice(0, limit), bottom: sorted.slice(-limit).reverse() };
}

export function postCountsFor(from, to, igIds) {
  const { fromMs, toMs } = rangeMs(from, to);
  return postCounts(fromMs, toMs, igIds);
}
