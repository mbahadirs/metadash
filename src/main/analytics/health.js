import { listAccounts, followersAt, latestFollowers } from '../db/queries/accounts.js';
import { aggregateMedia, weeklyPostCounts } from '../db/queries/media.js';
import { commentStatsV2 } from '../db/queries/inbox.js';
import { inboxSettings } from '../inbox/settings.js';
import { rangeMs, stddev, percentileRank, round, fmtDate, toDate } from './util.js';
import { capabilitiesFor, platformOf } from './platform.js';
import { subDays } from 'date-fns';

/**
 * Weights of the 0–100 health score. `response` (v2.0) = 50 % answered rate + 50 % answered-within-SLA rate
 * (inbox.slaHours, default 24 h; see inbox/sla.js), from top-level comments by other people.
 */
export const HEALTH_WEIGHTS = { growth: 0.3, engagement: 0.3, consistency: 0.2, response: 0.2 };
/** Share of the answered rate vs. the within-SLA rate inside the response component. */
export const RESPONSE_SPLIT = { answered: 0.5, withinSla: 0.5 };
/** Platforms without an inbox (capabilities.inbox false, no response rate): the response weight is spread over the rest. */
export const HEALTH_WEIGHTS_NO_RESPONSE = { growth: 0.375, engagement: 0.375, consistency: 0.25 };

/** Raw component values for one account within a window. `withResponse=false` skips the comment query (response null). */
export function healthComponents(igId, from, to, { withResponse = true } = {}) {
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
  let response = null;
  if (withResponse) response = responseRate(commentStatsV2(igId, fromMs, toMs, { slaHours: inboxSettings().slaHours }));
  return { growthPct, engagement, consistency, response, posts: agg?.posts ?? 0 };
}

/** Response component 0–100 from commentStatsV2: 50 % answered/incoming + 50 % withinSla/eligible (0 without comments). */
export function responseRate(cs) {
  if (!cs?.incoming) return 0;
  const answered = ((cs.answered ?? 0) / cs.incoming) * 100;
  const within = cs.eligible ? ((cs.withinSla ?? 0) / cs.eligible) * 100 : answered;
  return RESPONSE_SPLIT.answered * answered + RESPONSE_SPLIT.withinSla * within;
}

/**
 * 0-100 health scores, percentile-normalised within each platform (Instagram accounts are only ranked against
 * Instagram accounts, etc.). Platforms without an inbox get no response component and re-weighted scores.
 */
export function healthScores({ from, to, igIds, platforms } = {}) {
  const accounts = listAccounts({ platforms }).filter((a) => !igIds?.length || igIds.includes(a.igId));
  const comps = accounts.map((a) => {
    const platform = platformOf(a);
    const caps = capabilitiesFor(platform);
    const withResponse = !!(caps.inbox ?? caps.comments);
    return { igId: a.igId, username: a.username, platform, withResponse, ...healthComponents(a.igId, from, to, { withResponse }) };
  });
  const groups = new Map();
  for (const c of comps) groups.set(c.platform, [...(groups.get(c.platform) ?? []), c]);
  const pops = new Map([...groups].map(([p, list]) => [p, {
    growth: list.map((c) => c.growthPct),
    engagement: list.map((c) => c.engagement),
    consistency: list.map((c) => -c.consistency), // lower std-dev is better
    response: list.map((c) => c.response),
  }]));
  return comps.map((c) => scoreOf(c, pops.get(c.platform)));
}

function scoreOf(c, pop) {
  const g = percentileRank(c.growthPct, pop.growth);
  const e = percentileRank(c.engagement, pop.engagement);
  const k = percentileRank(-c.consistency, pop.consistency);
  const r = c.withResponse ? percentileRank(c.response, pop.response) : null;
  const score = c.withResponse
    ? HEALTH_WEIGHTS.growth * g + HEALTH_WEIGHTS.engagement * e + HEALTH_WEIGHTS.consistency * k + HEALTH_WEIGHTS.response * r
    : HEALTH_WEIGHTS_NO_RESPONSE.growth * g + HEALTH_WEIGHTS_NO_RESPONSE.engagement * e + HEALTH_WEIGHTS_NO_RESPONSE.consistency * k;
  return {
    igId: c.igId, username: c.username, platform: c.platform, score: Math.round(score),
    components: {
      growth: { raw: round(c.growthPct, 2), pct: Math.round(g) },
      engagement: { raw: round(c.engagement, 2), pct: Math.round(e) },
      consistency: { raw: round(c.consistency, 2), pct: Math.round(k) },
      response: c.withResponse ? { raw: round(c.response, 1), pct: Math.round(r) } : null,
    },
  };
}
