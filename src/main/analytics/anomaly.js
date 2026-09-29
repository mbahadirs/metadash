import { listAccounts, insightSeries } from '../db/queries/accounts.js';
import { listMedia } from '../db/queries/media.js';
import { mean, stddev, fmtDate, toDate, rangeMs, round } from './util.js';
import { platformOf, primaryMetricFor } from './platform.js';
import { subDays } from 'date-fns';

/**
 * ±2σ deviation from the trailing 30-day mean → badge.
 * Checks the platform's primary daily metric (reach; views on Threads) over the last 3 days, and the ER of posts
 * published in the last 3 days. `kind` is the metric name ('reach' | 'views') or 'post_er'.
 */
export function anomalies({ from, to, igIds, platforms, sigma = 2 } = {}) {
  const accounts = listAccounts({ platforms }).filter((a) => !igIds?.length || igIds.includes(a.igId));
  const end = toDate(to);
  const baseFrom = fmtDate(subDays(end, 32));
  const recentFrom = fmtDate(subDays(end, 2));
  const out = [];
  // One media query for every account (listMedia joins paid aggregates, so per-account calls are slow).
  const { fromMs, toMs } = rangeMs(baseFrom, to);
  const allPosts = accounts.length ? listMedia({ igIds: accounts.map((a) => a.igId), from: fromMs, to: toMs }) : [];
  const postsByAccount = new Map();
  for (const p of allPosts) postsByAccount.set(p.igId, [...(postsByAccount.get(p.igId) ?? []), p]);
  for (const a of accounts) {
    const platform = platformOf(a);
    const metric = primaryMetricFor(platform);
    const series = insightSeries(a.igId, baseFrom, to, [metric]);
    const base = series.filter((s) => s.date < recentFrom).map((s) => s[metric]);
    const recent = series.filter((s) => s.date >= recentFrom);
    const m = mean(base);
    const sd = stddev(base);
    if (m != null && sd > 0) {
      for (const r of recent) {
        const z = (r[metric] - m) / sd;
        if (Math.abs(z) >= sigma) {
          out.push({ igId: a.igId, username: a.username, platform, kind: metric, date: r.date, value: r[metric], mean: round(m, 0), sigma: round(sd, 0), z: round(z, 2), direction: z > 0 ? 'up' : 'down' });
        }
      }
    }
    const posts = postsByAccount.get(a.igId) ?? [];
    const recentMs = rangeMs(recentFrom, to).fromMs;
    const basePosts = posts.filter((p) => p.postedAt < recentMs).map((p) => p.engagementRate);
    const pm = mean(basePosts);
    const psd = stddev(basePosts);
    if (pm != null && psd > 0) {
      for (const p of posts.filter((p) => p.postedAt >= recentMs && p.engagementRate != null)) {
        const z = (p.engagementRate - pm) / psd;
        if (Math.abs(z) >= sigma) {
          out.push({ igId: a.igId, username: a.username, platform, kind: 'post_er', mediaId: p.mediaId, date: fmtDate(new Date(p.postedAt)), value: round(p.engagementRate, 2), mean: round(pm, 2), sigma: round(psd, 2), z: round(z, 2), direction: z > 0 ? 'up' : 'down' });
        }
      }
    }
  }
  return out.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
}
