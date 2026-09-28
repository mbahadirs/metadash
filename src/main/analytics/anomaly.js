import { listAccounts } from '../db/queries/accounts.js';
import { insightSeries } from '../db/queries/accounts.js';
import { listMedia } from '../db/queries/media.js';
import { mean, stddev, fmtDate, toDate, rangeMs, round } from './util.js';
import { subDays } from 'date-fns';

/**
 * ±2σ deviation from the trailing 30-day mean → badge.
 * Checks daily reach (last 3 days) and the ER of posts published in the last 3 days.
 */
export function anomalies({ from, to, igIds, sigma = 2 } = {}) {
  const accounts = listAccounts().filter((a) => !igIds?.length || igIds.includes(a.igId));
  const end = toDate(to);
  const baseFrom = fmtDate(subDays(end, 32));
  const recentFrom = fmtDate(subDays(end, 2));
  const out = [];
  for (const a of accounts) {
    const series = insightSeries(a.igId, baseFrom, to, ['reach']);
    const base = series.filter((s) => s.date < recentFrom).map((s) => s.reach);
    const recent = series.filter((s) => s.date >= recentFrom);
    const m = mean(base);
    const sd = stddev(base);
    if (m != null && sd > 0) {
      for (const r of recent) {
        const z = (r.reach - m) / sd;
        if (Math.abs(z) >= sigma) {
          out.push({ igId: a.igId, username: a.username, kind: 'reach', date: r.date, value: r.reach, mean: round(m, 0), sigma: round(sd, 0), z: round(z, 2), direction: z > 0 ? 'up' : 'down' });
        }
      }
    }
    const { fromMs, toMs } = rangeMs(baseFrom, to);
    const posts = listMedia({ igIds: [a.igId], from: fromMs, to: toMs });
    const recentMs = rangeMs(recentFrom, to).fromMs;
    const basePosts = posts.filter((p) => p.postedAt < recentMs).map((p) => p.engagementRate);
    const pm = mean(basePosts);
    const psd = stddev(basePosts);
    if (pm != null && psd > 0) {
      for (const p of posts.filter((p) => p.postedAt >= recentMs && p.engagementRate != null)) {
        const z = (p.engagementRate - pm) / psd;
        if (Math.abs(z) >= sigma) {
          out.push({ igId: a.igId, username: a.username, kind: 'post_er', mediaId: p.mediaId, date: fmtDate(new Date(p.postedAt)), value: round(p.engagementRate, 2), mean: round(pm, 2), sigma: round(psd, 2), z: round(z, 2), direction: z > 0 ? 'up' : 'down' });
        }
      }
    }
  }
  return out.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
}
