import { subDays, addDays } from 'date-fns';
import { getAccount, insightSeries, snapshotSeries } from '../../db/queries/accounts.js';
import { listMedia } from '../../db/queries/media.js';
import { adAccountForIg, adDailySeries } from '../../db/queries/ads.js';
import { anomalies } from '../../analytics/anomaly.js';
import { eachDay, fmtDate, toDate, rangeMs, mean } from '../../analytics/util.js';
import { AiError } from '../errors.js';
import { compact, postSummary, assertDate } from './compact.js';

export const ANOMALY_KINDS = ['reach', 'post_er'];
const WINDOW_DAYS = 7;
const BASELINE_DAYS = 30;
const MAX_POSTS = 20;
const shift = (date, days) => fmtDate(days >= 0 ? addDays(toDate(date), days) : subDays(toDate(date), -days));

/** Compact context around one anomaly: ±7 days of daily metrics, posts, ads and posting frequency. */
export function anomalySummary({ igId, date, kind, mediaId } = {}) {
  if (typeof igId !== 'string' || !igId) throw new AiError('ai_bad_input', { vars: { field: 'igId' } });
  assertDate(date, 'date');
  if (!ANOMALY_KINDS.includes(kind)) throw new AiError('ai_bad_input', { vars: { field: 'kind' } });
  const account = getAccount(igId);
  if (!account) throw new AiError('ai_bad_input', { vars: { field: 'igId' } });
  const today = fmtDate(new Date());
  const from = shift(date, -WINDOW_DAYS);
  const end = shift(date, WINDOW_DAYS);
  const to = end <= today ? end : today >= date ? today : date;
  const posts = postsBetween(igId, from, to);
  const baseFrom = shift(from, -BASELINE_DAYS);
  const baseTo = shift(from, -1);
  const priorPosts = postsBetween(igId, baseFrom, baseTo).length;
  const found = findAnomaly({ igId, date, kind, mediaId, today });
  const target = kind === 'post_er' ? posts.find((p) => (mediaId ? p.mediaId === mediaId : fmtDate(new Date(p.postedAt)) === date)) : null;
  return compact({
    account: { username: `@${account.username}`, name: account.name, client: account.clientName, followers: account.followers },
    anomaly: {
      kind, date, metric: kind === 'reach' ? 'daily organic reach' : 'post engagement rate %',
      direction: found?.direction, value: found?.value, baselineMean: found?.mean, baselineSigma: found?.sigma, z: found?.z,
      post: target ? postSummary(target) : undefined,
    },
    window: { from, to },
    dailySeries: dailySeries(igId, from, to),
    postsInWindow: posts.slice(0, MAX_POSTS).map((p) => postSummary(p)),
    postingFrequency: {
      postsInWindow: posts.length,
      postsBeforeDate: posts.filter((p) => fmtDate(new Date(p.postedAt)) < date).length,
      postsOnOrAfterDate: posts.filter((p) => fmtDate(new Date(p.postedAt)) >= date).length,
      avgPostsPerWeekPrior30d: (priorPosts / BASELINE_DAYS) * 7,
    },
    baseline: { period: { from: baseFrom, to: baseTo }, avgDailyReach: mean(insightSeries(igId, baseFrom, baseTo, ['reach']).map((d) => d.reach)) },
  });
}

function postsBetween(igId, from, to) {
  const { fromMs, toMs } = rangeMs(from, to);
  return listMedia({ igIds: [igId], from: fromMs, to: toMs, sort: 'date' }).sort((a, b) => a.postedAt - b.postedAt);
}

function dailySeries(igId, from, to) {
  const organic = new Map(insightSeries(igId, from, to, ['reach', 'views', 'accounts_engaged', 'profile_views']).map((d) => [d.date, d]));
  const followers = new Map(snapshotSeries(igId, from, to).map((s) => [s.date, s.followers]));
  const act = adAccountForIg(igId);
  const ads = new Map(act ? adDailySeries([act.actId], from, to).map((d) => [d.date, d]) : []);
  return eachDay(from, to).map((date) => {
    const o = organic.get(date) ?? {};
    const a = ads.get(date);
    return { date, reach: o.reach, views: o.views, engaged: o.accounts_engaged, profileViews: o.profile_views, followers: followers.get(date), adSpend: a?.spend, paidReach: a?.reach, ...(a && act?.currency ? { currency: act.currency } : {}) };
  });
}

/** Re-detects the anomaly with the same ±2σ rule; tries the period ends under which `date` falls in the 3-day recent window. */
function findAnomaly({ igId, date, kind, mediaId, today }) {
  const ends = [...new Set([today, shift(date, 2), shift(date, 1), date])].filter((end) => end >= date && end <= shift(date, 2) && end <= today);
  for (const end of ends) {
    const hit = anomalies({ from: date, to: end, igIds: [igId] }).find((a) => a.kind === kind && a.date === date && (!mediaId || a.mediaId === mediaId));
    if (hit) return hit;
  }
  return null;
}
