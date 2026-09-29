import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempDb, addAccount, addPosts, DAY } from './fixtures/studioData.js';
import { contentAnalysis } from '../src/main/analytics/content.js';
import { listMedia } from '../src/main/db/queries/media.js';
import { fmtDate, mean, round } from '../src/main/analytics/util.js';
import {
  extractTags, hashtagStats, tagPerformance, shrinkLift, suggestHashtags, relevance, keywords, fold, platformTagMax,
} from '../src/main/analytics/hashtags.js';

const NOW = Date.UTC(2026, 8, 15, 12);

/** The pre-refactor contentAnalysis hashtag block, verbatim (regression fixture). */
function legacyHashtags(posts) {
  const tagStats = new Map();
  for (const p of posts) {
    const tags = new Set((p.caption ?? '').toLowerCase().match(/#[\p{L}\p{N}_]+/gu) ?? []);
    for (const t of tags) {
      const cur = tagStats.get(t) ?? { tag: t, posts: 0, reach: [], er: [], saved: [] };
      tagStats.set(t, { ...cur, posts: cur.posts + 1, reach: [...cur.reach, p.reach], er: [...cur.er, p.engagementRate], saved: [...cur.saved, p.saved] });
    }
  }
  return [...tagStats.values()].filter((h) => h.posts >= 2).map((h) => ({ tag: h.tag, posts: h.posts, avgReach: round(mean(h.reach), 0), avgEr: round(mean(h.er), 2), avgSaved: round(mean(h.saved), 0) }))
    .sort((a, b) => (b.avgReach ?? 0) - (a.avgReach ?? 0)).slice(0, 20);
}

let cleanup;
beforeAll(() => {
  cleanup = tempDb('metadash-hashtags-');
  addAccount('h1');
  const posts = [];
  for (let i = 0; i < 30; i += 1) {
    const old = i < 4;
    const kahve = !old && i % 4 === 0;
    const tags = ['#brand', old ? '#oldwinner' : kahve ? '#Kahve' : '#coffee', !old && i % 5 === 0 ? '#tatlı' : ''].filter(Boolean).join(' ');
    posts.push({ id: `h1_${i}`, caption: `Post ${i} ${tags}`, reach: old ? 3000 : kahve ? 1500 : 900, er: 3 + (i % 4), daysAgo: old ? 200 + i : 1 + i * 3 });
  }
  posts.push({ id: 'h1_reel', caption: 'Reel #brand #reels #coffee', reach: 9000, daysAgo: 2, type: 'VIDEO', product: 'REELS' });
  posts.push({ id: 'h1_reel2', caption: 'Reel #brand #reels #coffee', reach: 9000, daysAgo: 5, type: 'VIDEO', product: 'REELS' });
  addPosts('h1', posts, NOW);
});
afterAll(() => cleanup());

describe('hashtag extraction and contentAnalysis parity', () => {
  it('extractTags is unique and lower-case', () => {
    expect(extractTags('Hi #Yaz #yaz #Tatil_2026 and #çay')).toEqual(['#yaz', '#tatil_2026', '#çay']);
    expect(extractTags(null)).toEqual([]);
  });

  it('contentAnalysis.hashtags output is unchanged by the refactor', () => {
    const from = fmtDate(new Date(NOW - 400 * DAY));
    const to = fmtDate(new Date(NOW));
    const res = contentAnalysis({ from, to, igIds: ['h1'] });
    const posts = listMedia({ igIds: ['h1'], from: NOW - 401 * DAY, to: NOW + DAY, sort: 'date' });
    expect(res.hashtags.length).toBeGreaterThan(3);
    expect(res.hashtags).toEqual(legacyHashtags(posts));
    expect(hashtagStats(posts)).toEqual(legacyHashtags(posts));
    expect(Object.keys(res.hashtags[0])).toEqual(['tag', 'posts', 'avgReach', 'avgEr', 'avgSaved']);
  });
});

describe('tagPerformance', () => {
  it('shrinks lift toward 1 with k = 3', () => {
    expect(shrinkLift(0, 0)).toBe(1);
    expect(shrinkLift(3, 1)).toBe(1.5); // one post at 3× → (3+3)/(1+3)
    expect(shrinkLift(30, 10)).toBeCloseTo(33 / 13);
  });

  it('measures lift against the account type median (reels vs images kept apart)', () => {
    const { tags, totalPosts } = tagPerformance(listMedia({ igIds: ['h1'] }), { now: NOW });
    expect(totalPosts).toBe(32);
    const reels = tags.find((t) => t.tag === '#reels');
    expect(reels.rawLift).toBe(1); // reels only compete with reels
    const winner = tags.find((t) => t.tag === '#oldwinner');
    expect(winner.rawLift).toBeCloseTo(3000 / 900, 2); // image median is 900
    expect(winner.lift).toBeCloseTo((4 * (3000 / 900) + 3) / (4 + 3), 2);
  });

  it('flags overused (>60 % of posts, lift ≤ 1) and stale (unused 90 days, lift > 1.2)', () => {
    const { tags } = tagPerformance(listMedia({ igIds: ['h1'] }), { now: NOW });
    const brand = tags.find((t) => t.tag === '#brand');
    expect(brand.share).toBe(1);
    expect(brand.overused).toBe(false); // everywhere, but lift > 1
    const byTag = Object.fromEntries(tags.map((t) => [t.tag, t]));
    expect(byTag['#oldwinner'].stale).toBe(true);
    expect(byTag['#coffee'].stale).toBe(false);
    expect(byTag['#coffee']).toMatchObject({ posts: 21, lift: 1, overused: true }); // 21/32 posts, lift 1
    expect(byTag['#kahve'].overused).toBe(false);
  });
});

describe('suggestHashtags', () => {
  it('ranks by shrunk lift, drops overused and tags already in the caption', () => {
    const res = suggestHashtags({ accountId: 'h1', platform: 'instagram', now: NOW });
    expect(res.count).toBe(5);
    expect(res.tested[0].tag).toBe('#oldwinner');
    expect(res.tested.map((t) => t.tag)).not.toContain('#coffee');
    expect(res.overused.map((t) => t.tag)).toContain('#coffee');
    expect(res.stale.map((t) => t.tag)).toEqual(['#oldwinner']);
    const again = suggestHashtags({ accountId: 'h1', platform: 'instagram', caption: 'New post #oldwinner', now: NOW });
    expect(again.tested.map((t) => t.tag)).not.toContain('#oldwinner');
  });

  it('keyword relevance lifts matching tags (Turkish folding)', () => {
    expect(fold('TATLI Çay')).toBe('tatli cay');
    expect(keywords('Yeni tatlı menümüz için #tag @me https://x.y')).toEqual(['yeni', 'tatli', 'menumuz']);
    expect(relevance('#tatlı', ['tatli'])).toBe(1);
    expect(relevance('#kahve', ['tatli'])).toBe(0.6);
    expect(relevance('#kahve', [])).toBe(1);
    const res = suggestHashtags({ accountId: 'h1', platform: 'instagram', notes: 'Yeni tatlı menüsü', now: NOW });
    const idx = (tag) => res.tested.findIndex((t) => t.tag === tag);
    expect(idx('#tatlı')).toBeGreaterThanOrEqual(0);
    expect(idx('#tatlı')).toBeLessThan(idx('#kahve'));
  });

  it('respects platform limits (Threads: 1 topic tag)', () => {
    expect(platformTagMax('threads')).toBe(1);
    expect(platformTagMax('instagram')).toBe(30);
    expect(suggestHashtags({ accountId: 'h1', platform: 'threads', count: 5, now: NOW }).tested).toHaveLength(1);
    expect(suggestHashtags({ accountId: 'h1', platform: 'instagram', count: 50, now: NOW }).count).toBe(30);
  });
});
