import { subDays } from 'date-fns';
import { listMedia, getMedia, commentsForMedia, typeBenchmarks, reachRank, mediaTypeKey } from '../db/queries/media.js';
import { paidForMedia } from '../db/queries/ads.js';
import { bestTime } from './besttime.js';
import { mediaLifecycle } from './lifecycle.js';
import { rangeMs, mean, pctChange, round, fmtDate, toDate } from './util.js';

const BENCH_DAYS = 90;
const TYPE_ORDER = ['image', 'carousel', 'video', 'reels', 'story'];

/** Full detail for one post: metrics, benchmark deltas, rank, lifecycle, paid, comments. */
export function mediaDetail(mediaId) {
  const media = getMedia(mediaId);
  if (!media) return null;
  const posted = new Date(media.postedAt);
  const benchFrom = posted.getTime() - BENCH_DAYS * 86_400_000;
  const bench = typeBenchmarks(media.igId, benchFrom, posted.getTime() - 1);
  const typeKey = mediaTypeKey(media);
  const b = bench[typeKey] ?? null;
  const vs = (key) => (b && b.posts >= 3 ? pctChange(media[key], b[key]) : null);
  const periodFrom = fmtDate(subDays(posted, 27));
  const periodTo = fmtDate(posted);
  const { fromMs, toMs } = rangeMs(periodFrom, periodTo);
  const rank = reachRank(media.igId, mediaId, fromMs, toMs);
  const bt = bestTime({ igId: media.igId, from: fmtDate(subDays(posted, 89)), to: periodTo });
  const slot = bt.matrix[media.postedWeekday]?.[media.postedHour] ?? null;
  const lifecycle = mediaLifecycle(mediaId);
  const paid = paidForMedia(mediaId);
  const comments = commentsForMedia(mediaId);
  const organicReach = media.reach ?? 0;
  return {
    media: { ...media, typeKey, ageHours: Math.floor((Date.now() - media.postedAt) / 3_600_000) },
    benchmark: b ? { posts: b.posts, days: BENCH_DAYS, reach: round(b.reach, 0), views: round(b.views, 0), likes: round(b.likes, 0), comments: round(b.comments, 0), saved: round(b.saved, 0), shares: round(b.shares, 0), engagementRate: round(b.engagementRate, 2), saveRate: round(b.saveRate, 2) } : null,
    deltas: { reach: vs('reach'), views: vs('views'), likes: vs('likes'), comments: vs('comments'), saved: vs('saved'), shares: vs('shares'), engagementRate: vs('engagementRate'), saveRate: vs('saveRate') },
    rank: { ...rank, from: periodFrom, to: periodTo },
    slot: slot ? { weekday: media.postedWeekday, hour: media.postedHour, count: slot.count, value: slot.value, qualified: slot.qualified, bestValue: bt.best[0]?.value ?? null } : null,
    derived: {
      viewsPerReach: media.reach && media.views ? round(media.views / media.reach, 2) : null,
      interactionsPerThousandReach: media.reach ? round(((media.totalInteractions ?? 0) / media.reach) * 1000, 1) : null,
      commentRate: media.reach ? round(((media.comments ?? 0) / media.reach) * 100, 3) : null,
      shareRate: media.reach ? round(((media.shares ?? 0) / media.reach) * 100, 3) : null,
      paidShare: paid ? round((paid.totals.reach / (organicReach + paid.totals.reach)) * 100, 1) : null,
    },
    lifecycle,
    paid,
    comments: comments.slice(0, 60),
  };
}

/** Content analysis across accounts: type breakdown, recent-week table with benchmark deltas, hashtag performance, top posts. */
export function contentAnalysis({ from, to, igIds, typeKeys, recentDays = 7 }) {
  const { fromMs, toMs } = rangeMs(from, to);
  const posts = listMedia({ igIds, from: fromMs, to: toMs, typeKeys, sort: 'date' });
  const byType = {};
  for (const p of posts) {
    const k = mediaTypeKey(p);
    byType[k] = [...(byType[k] ?? []), p];
  }
  const types = TYPE_ORDER.filter((k) => byType[k]).map((k) => summarize(k, byType[k]));

  const recentStart = Math.max(fromMs, toDate(to).getTime() - (recentDays - 1) * 86_400_000);
  const benchCache = new Map();
  const benchFor = (igId) => {
    if (!benchCache.has(igId)) benchCache.set(igId, typeBenchmarks(igId, toDate(to).getTime() - BENCH_DAYS * 86_400_000, recentStart - 1));
    return benchCache.get(igId);
  };
  const recent = posts.filter((p) => p.postedAt >= recentStart).map((p) => {
    const b = benchFor(p.igId)[mediaTypeKey(p)];
    const ok = b && b.posts >= 3;
    return {
      ...p, typeKey: mediaTypeKey(p),
      vsReach: ok ? pctChange(p.reach, b.reach) : null, vsEr: ok ? pctChange(p.engagementRate, b.engagementRate) : null,
      vsSaved: ok ? pctChange(p.saved, b.saved) : null, benchPosts: b?.posts ?? 0,
    };
  });

  const tagStats = new Map();
  for (const p of posts) {
    const tags = new Set((p.caption ?? '').toLowerCase().match(/#[\p{L}\p{N}_]+/gu) ?? []);
    for (const t of tags) {
      const cur = tagStats.get(t) ?? { tag: t, posts: 0, reach: [], er: [], saved: [] };
      tagStats.set(t, { ...cur, posts: cur.posts + 1, reach: [...cur.reach, p.reach], er: [...cur.er, p.engagementRate], saved: [...cur.saved, p.saved] });
    }
  }
  const hashtags = [...tagStats.values()].filter((h) => h.posts >= 2).map((h) => ({ tag: h.tag, posts: h.posts, avgReach: round(mean(h.reach), 0), avgEr: round(mean(h.er), 2), avgSaved: round(mean(h.saved), 0) }))
    .sort((a, b) => (b.avgReach ?? 0) - (a.avgReach ?? 0)).slice(0, 20);

  const totalReach = posts.reduce((s, p) => s + (p.reach ?? 0), 0);
  const paidPosts = posts.filter((p) => (p.spend ?? 0) > 0);
  const spendByCurrency = {};
  for (const p of paidPosts) spendByCurrency[p.paidCurrency ?? 'USD'] = (spendByCurrency[p.paidCurrency ?? 'USD'] ?? 0) + (p.spend ?? 0);
  const mainCurrency = Object.entries(spendByCurrency).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const totalSpend = mainCurrency ? spendByCurrency[mainCurrency] : 0;
  return {
    period: { from, to, recentDays, recentFrom: fmtDate(new Date(recentStart)) },
    summary: {
      posts: posts.length, reach: totalReach, avgReach: round(mean(posts.map((p) => p.reach)), 0), avgEr: round(mean(posts.map((p) => p.engagementRate)), 2),
      avgSaveRate: round(mean(posts.map((p) => p.saveRate)), 2), totalSpend: round(totalSpend, 2), paidPosts: paidPosts.length,
      paidReach: paidPosts.reduce((s, p) => s + (p.paidReach ?? 0), 0), currency: mainCurrency, spendByCurrency,
      accounts: new Set(posts.map((p) => p.igId)).size,
    },
    types,
    recent: recent.sort((a, b) => b.postedAt - a.postedAt),
    hashtags,
    top: [...posts].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0)).slice(0, 6),
    topSaved: [...posts].sort((a, b) => (b.saveRate ?? 0) - (a.saveRate ?? 0)).slice(0, 3),
  };
}

function summarize(typeKey, list) {
  return {
    typeKey, posts: list.length,
    share: null,
    avgReach: round(mean(list.map((p) => p.reach)), 0), avgViews: round(mean(list.map((p) => p.views)), 0), avgLikes: round(mean(list.map((p) => p.likes)), 0),
    avgComments: round(mean(list.map((p) => p.comments)), 0), avgSaved: round(mean(list.map((p) => p.saved)), 0), avgShares: round(mean(list.map((p) => p.shares)), 0),
    avgEr: round(mean(list.map((p) => p.engagementRate)), 2), avgSaveRate: round(mean(list.map((p) => p.saveRate)), 2),
    spend: round(list.reduce((s, p) => s + (p.spend ?? 0), 0), 2), paidPosts: list.filter((p) => (p.spend ?? 0) > 0).length,
    totalReach: list.reduce((s, p) => s + (p.reach ?? 0), 0),
  };
}

/** Side-by-side comparison of 2–6 posts: metrics, benchmark deltas, paid totals and reach lifecycle curves. */
export function comparePosts({ mediaIds }) {
  const ids = (mediaIds ?? []).slice(0, 6);
  const items = ids.map((id) => mediaDetail(id)).filter(Boolean);
  const ages = [1, 2, 3, 6, 12, 24, 48, 72, 96, 120, 168, 336, 720];
  const curves = items.map((d) => {
    const s = (d.lifecycle.series.reach ?? []).slice().sort((a, b) => a.ageHours - b.ageHours);
    return { mediaId: d.media.mediaId, points: s.map((p) => ({ ageHours: p.ageHours, value: p.value })) };
  });
  const maxAge = Math.max(1, ...curves.flatMap((c) => c.points.map((p) => p.ageHours)));
  const axis = ages.filter((a) => a <= Math.max(24, maxAge));
  const merged = axis.map((age) => Object.fromEntries([['ageHours', age], ...curves.map((c) => {
    const at = c.points.filter((p) => p.ageHours <= age);
    return [c.mediaId, at.length ? at[at.length - 1].value : null];
  })]));
  const metrics = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'engagementRate', 'saveRate'];
  const best = Object.fromEntries(metrics.map((m) => [m, items.reduce((b, d) => ((d.media[m] ?? -Infinity) > (b?.media[m] ?? -Infinity) ? d : b), null)?.media.mediaId ?? null]));
  return { items, lifecycle: merged, best };
}
