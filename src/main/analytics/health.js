import { listAccounts, followersAt, latestFollowers } from '../db/queries/accounts.js';
import { aggregateMedia, weeklyPostCounts, commentStats } from '../db/queries/media.js';
import { rangeMs, stddev, percentileRank, round, fmtDate, toDate } from './util.js';
import { subDays } from 'date-fns';

export const HEALTH_WEIGHTS = { growth: 0.3, engagement: 0.3, consistency: 0.2, response: 0.2 };

/** Raw component values for one account within a window. */
export function healthComponents(igId, from, to) {
  const { fromMs, toMs } = rangeMs(from, to);
  const start = followersAt(igId, from, 'after');
  const end = latestFollowers(igId);
  const growthPct = start ? ((end - start) / start) * 100 : 0;
  const agg = aggregateMedia(igId, fromMs, toMs);
  const engagement = agg?.avgEr ?? 0;
  const thirtyFrom = fmtDate(subDays(toDate(to), 29));
  const weekly = weeklyPostCounts(igId, rangeMs(thirtyFrom, to).fromMs, toMs).map((w) => w.count);
  const padded = [...weekly, ...Array(Math.max(0, 5 - weekly.length)).fill(0)];
  const consistency = stddev(padded);
  const cs = commentStats(igId, fromMs, toMs);
  const response = cs?.incoming ? ((cs.answered ?? 0) / cs.incoming) * 100 : 0;
  return { growthPct, engagement, consistency, response, posts: agg?.posts ?? 0 };
}

/** Portfolio-normalised 0-100 health scores. */
export function healthScores({ from, to, igIds } = {}) {
  const accounts = listAccounts().filter((a) => !igIds?.length || igIds.includes(a.igId));
  const comps = accounts.map((a) => ({ igId: a.igId, username: a.username, ...healthComponents(a.igId, from, to) }));
  const growthPop = comps.map((c) => c.growthPct);
  const engPop = comps.map((c) => c.engagement);
  const consPop = comps.map((c) => -c.consistency); // lower std-dev is better
  const respPop = comps.map((c) => c.response);
  return comps.map((c) => {
    const g = percentileRank(c.growthPct, growthPop);
    const e = percentileRank(c.engagement, engPop);
    const k = percentileRank(-c.consistency, consPop);
    const r = percentileRank(c.response, respPop);
    const score = HEALTH_WEIGHTS.growth * g + HEALTH_WEIGHTS.engagement * e + HEALTH_WEIGHTS.consistency * k + HEALTH_WEIGHTS.response * r;
    return {
      igId: c.igId, username: c.username, score: Math.round(score),
      components: {
        growth: { raw: round(c.growthPct, 2), pct: Math.round(g) },
        engagement: { raw: round(c.engagement, 2), pct: Math.round(e) },
        consistency: { raw: round(c.consistency, 2), pct: Math.round(k) },
        response: { raw: round(c.response, 1), pct: Math.round(r) },
      },
    };
  });
}
