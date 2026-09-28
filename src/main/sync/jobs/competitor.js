import { fetchCompetitor } from '../../meta/competitors.js';
import { upsertCompetitorSnapshot } from '../../db/queries/competitors.js';
import { fmtDate } from '../../analytics/util.js';

export async function syncCompetitor(ctx, competitor) {
  const { token, report } = ctx;
  report('competitors');
  const data = await fetchCompetitor(competitor.linked_ig_id, competitor.username, token);
  upsertCompetitorSnapshot({
    competitorId: competitor.id, date: fmtDate(new Date()), followers: data.followers, mediaCount: data.mediaCount,
    avgLikes: data.avgLikes, avgComments: data.avgComments, postsLast7d: data.postsLast7d,
  });
}
