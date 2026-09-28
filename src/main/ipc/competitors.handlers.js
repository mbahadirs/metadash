import { listCompetitors, addCompetitor, removeCompetitor, competitorSeries } from '../db/queries/competitors.js';
import { getAccount, snapshotSeries, latestFollowers, followersAt } from '../db/queries/accounts.js';
import { aggregateMedia, weeklyPostCounts } from '../db/queries/media.js';
import { rangeMs, pctChange, round, periodDays } from '../analytics/util.js';
import { msg } from '../i18n.js';

export function registerCompetitorHandlers(handle) {
  handle('competitors:list', (igId) => listCompetitors(igId));
  handle('competitors:add', ({ username, igId, label }) => {
    if (!username?.trim()) throw new Error(msg('username_empty'));
    if (!igId) throw new Error(msg('pick_competitor_account'));
    return addCompetitor({ username, igId, label });
  });
  handle('competitors:remove', (id) => { removeCompetitor(id); return true; });
  handle('competitors:compare', ({ igId, from, to }) => {
    const own = getAccount(igId);
    if (!own) throw new Error(msg('account_not_found'));
    const { fromMs, toMs } = rangeMs(from, to);
    const days = periodDays(from, to);
    const agg = aggregateMedia(igId, fromMs, toMs) ?? {};
    const ownSeries = snapshotSeries(igId, from, to);
    const ownStart = followersAt(igId, from, 'after');
    const ownNow = latestFollowers(igId);
    const ownRow = {
      id: null, username: own.username, isOwn: true, color: own.color, followers: ownNow,
      growth: ownNow != null && ownStart != null ? ownNow - ownStart : null, growthPct: pctChange(ownNow, ownStart),
      postsPerWeek: round(((agg.posts ?? 0) / days) * 7, 1), avgLikes: round(agg.posts ? agg.likes / agg.posts : null, 0), avgComments: round(agg.posts ? agg.comments / agg.posts : null, 0),
      series: ownSeries.map((s) => ({ date: s.date, followers: s.followers })),
    };
    const palette = ['#3FBF8F', '#E8B44A', '#C06CE8', '#E5605F', '#48C3D6'];
    const rows = listCompetitors(igId).map((c, i) => {
      const series = competitorSeries(c.id, from, to);
      const first = series[0];
      const last = series[series.length - 1];
      return {
        id: c.id, username: c.username, isOwn: false, color: palette[i % palette.length], followers: last?.followers ?? c.followers ?? null,
        growth: first && last ? last.followers - first.followers : null, growthPct: first && last ? pctChange(last.followers, first.followers) : null,
        postsPerWeek: last?.postsLast7d ?? null, avgLikes: round(last?.avgLikes, 0), avgComments: round(last?.avgComments, 0),
        series: series.map((s) => ({ date: s.date, followers: s.followers })), lastDate: c.lastDate,
      };
    });
    return { rows: [ownRow, ...rows], note: msg('competitor_note') };
  });
}
