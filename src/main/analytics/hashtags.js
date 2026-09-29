import { listMedia, mediaTypeKey } from '../db/queries/media.js';
import { limit } from '../publishing/limits.js';
import { mean, median, round } from './util.js';

/**
 * Hashtag analytics (pure over the local DB; no AI). Used by contentAnalysis (hashtag table) and by the AI studio
 * hashtag suggestions (studio/hashtags.js only re-orders what this module returns).
 */
const TAG_RE = /#[\p{L}\p{N}_]+/gu;
const DAY = 86_400_000;
export const SHRINK_K = 3;
export const OVERUSED_SHARE = 0.6;
export const STALE_DAYS = 90;
export const STALE_LIFT = 1.2;
export const HISTORY_DAYS = 365;
/** Suggested tag count per platform. IG allows 30, but 3–5 is the common best-practice default (VERIFY). */
export const RECOMMENDED_TAGS = Object.freeze({ instagram: 5, facebook: 3, threads: 1 });

/** Unique lower-cased hashtags of a caption, in order of first appearance ("#tag"). */
export function extractTags(caption) {
  return [...new Set((caption ?? '').toLowerCase().match(TAG_RE) ?? [])];
}

/** contentAnalysis.hashtags: tags used on ≥ 2 posts, top 20 by average reach. Output shape is part of the IPC contract. */
export function hashtagStats(posts) {
  const tagStats = new Map();
  for (const p of posts) {
    for (const t of extractTags(p.caption)) {
      const cur = tagStats.get(t) ?? { tag: t, posts: 0, reach: [], er: [], saved: [] };
      tagStats.set(t, { ...cur, posts: cur.posts + 1, reach: [...cur.reach, p.reach], er: [...cur.er, p.engagementRate], saved: [...cur.saved, p.saved] });
    }
  }
  return [...tagStats.values()].filter((h) => h.posts >= 2).map((h) => ({ tag: h.tag, posts: h.posts, avgReach: round(mean(h.reach), 0), avgEr: round(mean(h.er), 2), avgSaved: round(mean(h.saved), 0) }))
    .sort((a, b) => (b.avgReach ?? 0) - (a.avgReach ?? 0)).slice(0, 20);
}

/** Primary distribution metric: reach, or views for Threads (no reach there). */
const exposure = (p) => ((p.platform ?? 'instagram') === 'threads' ? p.views : p.reach);

/** Median exposure per type key, the baseline each post's lift is measured against. */
function typeMedians(posts) {
  const byType = new Map();
  for (const p of posts) {
    const v = exposure(p);
    if (v == null) continue;
    const k = mediaTypeKey(p);
    byType.set(k, [...(byType.get(k) ?? []), v]);
  }
  return new Map([...byType].map(([k, vals]) => [k, median(vals)]));
}

/** Empirical-Bayes style shrinkage toward 1: (Σlift + k) / (n + k). */
export const shrinkLift = (sum, n, k = SHRINK_K) => (sum + k) / (n + k);

/**
 * Per-tag performance from a list of posts (pure). lift = mean(post exposure / account type-median exposure), shrunk
 * toward 1 with k = 3. Flags: overused (in > 60 % of posts and lift ≤ 1), stale (unused for 90 days but lift > 1.2).
 * Returns { totalPosts, tags: [{ tag, posts, share, lift, rawLift, avgReach, avgEr, lastUsedAt, overused, stale }] } by lift.
 */
export function tagPerformance(posts, { now = Date.now() } = {}) {
  const medians = typeMedians(posts);
  const acc = new Map();
  for (const p of posts) {
    const tags = extractTags(p.caption);
    if (!tags.length) continue;
    const base = medians.get(mediaTypeKey(p));
    const v = exposure(p);
    const lift = v != null && base > 0 ? v / base : null;
    for (const tag of tags) {
      const cur = acc.get(tag) ?? { tag, posts: 0, liftSum: 0, liftN: 0, reach: [], er: [], lastUsedAt: 0 };
      acc.set(tag, {
        ...cur,
        posts: cur.posts + 1,
        liftSum: cur.liftSum + (lift ?? 0),
        liftN: cur.liftN + (lift == null ? 0 : 1),
        reach: [...cur.reach, v],
        er: [...cur.er, p.engagementRate],
        lastUsedAt: Math.max(cur.lastUsedAt, p.postedAt ?? 0),
      });
    }
  }
  const total = posts.length;
  const tags = [...acc.values()].map((t) => {
    const lift = shrinkLift(t.liftSum, t.liftN);
    const share = total ? t.posts / total : 0;
    return {
      tag: t.tag,
      posts: t.posts,
      share: round(share, 3),
      lift: round(lift, 3),
      rawLift: t.liftN ? round(t.liftSum / t.liftN, 3) : null,
      avgReach: round(mean(t.reach), 0),
      avgEr: round(mean(t.er), 2),
      lastUsedAt: t.lastUsedAt || null,
      overused: share > OVERUSED_SHARE && lift <= 1,
      stale: t.lastUsedAt > 0 && now - t.lastUsedAt > STALE_DAYS * DAY && lift > STALE_LIFT,
    };
  });
  return { totalPosts: total, tags: tags.sort((a, b) => b.lift - a.lift || b.posts - a.posts || a.tag.localeCompare(b.tag)) };
}

/** DB-backed tagPerformance for one account (default window: last 365 days). */
export function hashtagPerformance({ accountId, from, to, now = Date.now() }) {
  const posts = listMedia({ igIds: [accountId], from: from ?? now - HISTORY_DAYS * DAY, to: to ?? now, sort: 'date' });
  return tagPerformance(posts, { now });
}

/** Turkish-aware folding for keyword matching: lower-case, no diacritics, dotless ı → i. */
export function fold(s) {
  return String(s ?? '').toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'you', 'your', 'our', 'are', 'from', 'bir', 've', 'ile', 'icin', 'bu', 'cok', 'daha', 'gibi', 'ama', 'olan', 'olarak', 'her', 'sen', 'siz', 'biz']);

/** Content words of a text (folded, ≥ 3 chars, no stopwords, no hashtags/mentions/links). */
export function keywords(text) {
  const clean = fold(text).replace(/https?:\/\/\S+|[#@][\p{L}\p{N}_.]+/gu, ' ');
  return [...new Set(clean.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
}

/**
 * Keyword relevance of a tag to the caption/notes: 1 when there is no text; otherwise 0.6 with no overlap and
 * 1 + 0.25 per extra matching keyword (max 2). A keyword matches when it is contained in the tag or vice versa.
 */
export function relevance(tag, words) {
  if (!words.length) return 1;
  const body = fold(tag).replace(/^#/, '');
  const hits = words.filter((w) => body.includes(w) || (body.length >= 3 && w.includes(body))).length;
  return hits ? Math.min(2, 1 + 0.25 * (hits - 1)) : 0.6;
}

/** Max hashtags a platform accepts in one post (Threads: 1 topic tag). */
export function platformTagMax(platform) {
  if (platform === 'threads') return limit('threads', 'topicTagsMax');
  if (platform === 'instagram') return limit('instagram', 'hashtagsMax');
  return 30;
}

const pick = (t, score) => ({ tag: t.tag, posts: t.posts, lift: t.lift, avgReach: t.avgReach, avgEr: t.avgEr, lastUsedAt: t.lastUsedAt, score: round(score, 3) });

/**
 * Hashtag suggestions from the account's own history, no AI: tags used on ≥ 2 posts ranked by shrunk lift × keyword
 * relevance to the caption/notes; tags already in the caption and overused tags are left out of `tested`.
 * perf: optional precomputed tagPerformance result (tests / callers that already have it).
 */
export function suggestHashtags({ accountId, caption = '', notes = '', platform = 'instagram', count, now = Date.now(), perf } = {}) {
  const data = perf ?? hashtagPerformance({ accountId, now });
  const max = platformTagMax(platform);
  const n = Math.max(1, Math.min(Number.isInteger(count) ? count : RECOMMENDED_TAGS[platform] ?? 5, max));
  const used = new Set(extractTags(caption));
  const words = keywords(`${caption}\n${notes}`);
  const scored = data.tags.map((t) => ({ t, score: t.lift * relevance(t.tag, words) }));
  const tested = scored.filter(({ t }) => t.posts >= 2 && !t.overused && !used.has(t.tag))
    .sort((a, b) => b.score - a.score || b.t.posts - a.t.posts || a.t.tag.localeCompare(b.t.tag))
    .slice(0, n).map(({ t, score }) => pick(t, score));
  const overused = scored.filter(({ t }) => t.overused).map(({ t, score }) => pick(t, score));
  const stale = scored.filter(({ t }) => t.stale && !used.has(t.tag)).sort((a, b) => b.t.lift - a.t.lift).map(({ t, score }) => pick(t, score));
  return { tested, overused, stale, untested: [], count: n, platformMax: max, recommended: RECOMMENDED_TAGS[platform] ?? null, totalPosts: data.totalPosts };
}
