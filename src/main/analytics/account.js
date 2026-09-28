import { getAccount, followersAt, latestFollowers, snapshotSeries, insightSeries, insightSum, latestDemographics } from '../db/queries/accounts.js';
import { listMedia, aggregateMedia, aggregateByType, commentStats } from '../db/queries/media.js';
import { listStories, storySummary } from '../db/queries/stories.js';
import { previousPeriod, rangeMs, pctChange, round, eachDay } from './util.js';
import { healthScores } from './health.js';
import { paidFields } from './paid.js';
import { adAccountForIg, adTotals, listAdAccounts } from '../db/queries/ads.js';

export function accountAnalytics({ igId, from, to }) {
  const account = getAccount(igId);
  if (!account) return null;
  const prev = previousPeriod(from, to);
  const { fromMs, toMs } = rangeMs(from, to);
  const prevRange = rangeMs(prev.from, prev.to);

  const sums = (f, t) => ({
    reach: insightSum(igId, f, t, 'reach'),
    views: insightSum(igId, f, t, 'views'),
    profileViews: insightSum(igId, f, t, 'profile_views'),
    engaged: insightSum(igId, f, t, 'accounts_engaged'),
  });
  const cur = sums(from, to);
  const pre = sums(prev.from, prev.to);
  const agg = aggregateMedia(igId, fromMs, toMs) ?? {};
  const prevAgg = aggregateMedia(igId, prevRange.fromMs, prevRange.toMs) ?? {};
  const followers = latestFollowers(igId);
  const startFollowers = followersAt(igId, from, 'after');
  const prevStart = followersAt(igId, prev.from, 'after');
  const prevEnd = followersAt(igId, prev.to, 'before');
  const newFollowers = followers != null && startFollowers != null ? followers - startFollowers : null;
  const prevNew = prevEnd != null && prevStart != null ? prevEnd - prevStart : null;

  const daily = insightSeries(igId, from, to, ['reach', 'views', 'profile_views', 'accounts_engaged']);
  const dailyMap = new Map(daily.map((d) => [d.date, d]));
  const series = eachDay(from, to).map((date) => ({ date, reach: 0, views: 0, profile_views: 0, accounts_engaged: 0, ...(dailyMap.get(date) ?? {}) }));
  const prevDaily = insightSeries(igId, prev.from, prev.to, ['reach', 'accounts_engaged']);
  const followerSeries = snapshotSeries(igId, from, to);
  const posts = listMedia({ igIds: [igId], from: fromMs, to: toMs });
  const health = healthScores({ from, to }).find((h) => h.igId === igId) ?? null;
  const actRef = adAccountForIg(igId);
  const act = actRef ? listAdAccounts().find((x) => x.actId === actRef.actId) ?? null : null;
  const paid = act ? { ...paidFields(adTotals([act.actId], from, to), act), prev: paidFields(adTotals([act.actId], prev.from, prev.to), act), actId: act.actId, name: act.name } : null;

  return {
    account: { ...account, followers },
    period: { from, to, prevFrom: prev.from, prevTo: prev.to, days: prev.days },
    kpis: {
      reach: { value: cur.reach, prev: pre.reach, changePct: pctChange(cur.reach, pre.reach) },
      views: { value: cur.views, prev: pre.views, changePct: pctChange(cur.views, pre.views) },
      profileViews: { value: cur.profileViews, prev: pre.profileViews, changePct: pctChange(cur.profileViews, pre.profileViews) },
      er: { value: round(agg.avgEr, 2), prev: round(prevAgg.avgEr, 2), changePct: pctChange(agg.avgEr, prevAgg.avgEr) },
      newFollowers: { value: newFollowers, prev: prevNew, changePct: pctChange(newFollowers, prevNew) },
      posts: { value: agg.posts ?? 0, prev: prevAgg.posts ?? 0, changePct: pctChange(agg.posts, prevAgg.posts) },
      saveRate: { value: round((agg.saveRate ?? 0) * 100, 2), prev: round((prevAgg.saveRate ?? 0) * 100, 2), changePct: pctChange(agg.saveRate, prevAgg.saveRate) },
    },
    series,
    prevSeries: prevDaily,
    followerSeries,
    posts,
    byType: aggregateByType(igId, fromMs, toMs).map((t) => ({ ...t, avgEr: round(t.avgEr, 2), avgReach: Math.round(t.avgReach ?? 0) })),
    comments: commentStats(igId, fromMs, toMs),
    health,
    paid,
  };
}

export function accountStories({ igId, from, to }) {
  const { fromMs, toMs } = rangeMs(from, to);
  return { stories: listStories(igId, fromMs, toMs), summary: storySummary(igId, fromMs, toMs) };
}

export function accountDemographics({ igId }) {
  return latestDemographics(igId);
}
