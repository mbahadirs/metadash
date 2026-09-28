import { listMedia } from '../db/queries/media.js';
import { rangeMs, round } from './util.js';

/** 7×24 matrix; cell = avg ER of posts in that slot. Cells with < minPosts posts are flagged. */
export function bestTime({ igId, igIds, from, to, minPosts = 3 }) {
  const { fromMs, toMs } = rangeMs(from, to);
  const ids = igIds?.length ? igIds : igId ? [igId] : undefined;
  const media = listMedia({ igIds: ids, from: fromMs, to: toMs });
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ sum: 0, count: 0, reach: 0 })));
  for (const m of media) {
    if (m.engagementRate == null) continue;
    const c = cells[m.postedWeekday][m.postedHour];
    c.sum += m.engagementRate;
    c.count += 1;
    c.reach += m.reach ?? 0;
  }
  const matrix = cells.map((row, weekday) =>
    row.map((c, hour) => ({
      weekday, hour, count: c.count,
      value: c.count ? round(c.sum / c.count, 3) : null,
      avgReach: c.count ? Math.round(c.reach / c.count) : null,
      qualified: c.count >= minPosts,
    })),
  );
  const qualified = matrix.flat().filter((c) => c.qualified);
  const best = [...qualified].sort((a, b) => b.value - a.value).slice(0, 3);
  return { matrix, best, totalPosts: media.length, minPosts };
}
