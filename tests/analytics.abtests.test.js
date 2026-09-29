import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, q } from '../src/main/db/index.js';
import { setConfig } from '../src/main/config/store.js';
import { upsertAccount } from '../src/main/db/queries/accounts.js';
import { upsertMedia, upsertLatest } from '../src/main/db/queries/media.js';
import { analyzeAbTest, liftFor, mulberry32, armStats, verdictFor, median } from '../src/main/analytics/abtests.js';
import { createTest, tagItem, untagItem, getTestResults, listTests, concludeTest, candidates, conclusionData, removeTest } from '../src/main/ai/studio/abtests.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 20, 12);
const bench = { posts: 10, reach: 1000, views: 2000, engagementRate: 4, saveRate: 2 };
const obs = (arm, reach, extra = {}) => ({ arm, mediaKey: `${arm}${reach}`, synced: true, postedAt: NOW - 5 * DAY, platform: 'instagram', reach, views: reach * 2, engagementRate: 4, saved: 10, bench, ...extra });

describe('analytics/abtests (pure)', () => {
  it('lift vs the type benchmark per metric, Threads uses views for reach_lift', () => {
    expect(liftFor(obs('A', 1500), 'reach_lift', { now: NOW }).lift).toBeCloseTo(1.5);
    expect(liftFor(obs('A', 1500, { engagementRate: 6 }), 'er', { now: NOW }).lift).toBeCloseTo(1.5);
    expect(liftFor(obs('A', 1000, { saved: 30 }), 'save_rate', { now: NOW }).lift).toBeCloseTo(1.5); // 3% vs 2%
    expect(liftFor(obs('A', 1000, { platform: 'threads', reach: null, views: 1000 }), 'reach_lift', { now: NOW }).lift).toBeCloseTo(0.5);
    expect(liftFor(obs('A', 1000, { views: 3000 }), 'views_lift', { now: NOW }).lift).toBeCloseTo(1.5);
  });
  it('excludes posts younger than 72 h, unsynced ones and ones without a benchmark', () => {
    expect(liftFor(obs('A', 1000, { postedAt: NOW - 71 * HOUR }), 'reach_lift', { now: NOW })).toEqual({ excluded: 'too_young' });
    expect(liftFor(obs('A', 1000, { postedAt: NOW - 73 * HOUR }), 'reach_lift', { now: NOW }).lift).toBe(1);
    expect(liftFor(obs('A', 1000, { synced: false }), 'reach_lift', { now: NOW })).toEqual({ excluded: 'pending' });
    expect(liftFor(obs('A', 1000, { bench: { ...bench, posts: 2 } }), 'reach_lift', { now: NOW })).toEqual({ excluded: 'no_benchmark' });
    expect(liftFor(obs('A', null), 'reach_lift', { now: NOW })).toEqual({ excluded: 'no_metric' });
  });
  it('seeded bootstrap CI is deterministic and brackets the mean', () => {
    const lifts = [0.8, 1.1, 1.3, 0.9, 1.6];
    const a = armStats(lifts, { rng: mulberry32(1), iterations: 1000 });
    const b = armStats(lifts, { rng: mulberry32(1), iterations: 1000 });
    expect(a.ci).toEqual(b.ci);
    expect(a.mean).toBeCloseTo(1.14);
    expect(a.median).toBe(1.1);
    expect(a.ci[0]).toBeLessThan(a.mean);
    expect(a.ci[1]).toBeGreaterThan(a.mean);
    expect(a.ci[0]).toBeGreaterThanOrEqual(0.8);
    expect(a.ci[1]).toBeLessThanOrEqual(1.6);
    expect(median([3, 1, 2, 4])).toBe(2.5);
  });
  it('verdict thresholds: need more posts → directional → inconclusive', () => {
    const two = analyzeAbTest({ metric: 'reach_lift', observations: [obs('A', 2000), obs('A', 2100), obs('B', 900), obs('B', 950), obs('B', 1000)], now: NOW });
    expect(two.verdict).toBe('need_more');
    expect(two.arms.find((a) => a.arm === 'A').n).toBe(2);

    const clear = analyzeAbTest({ metric: 'reach_lift', observations: [obs('A', 2000), obs('A', 2100), obs('A', 2200), obs('B', 900), obs('B', 950), obs('B', 1000)], now: NOW });
    expect(clear.verdict).toBe('directional');
    expect(clear.winner).toBe('A');
    expect(clear.probBest).toBeGreaterThan(0.95);
    expect(clear.arms[0]).toMatchObject({ arm: 'A', n: 3, mean: 2.1, median: 2.1 });

    const noisy = analyzeAbTest({ metric: 'reach_lift', observations: [obs('A', 500), obs('A', 2000), obs('A', 1200), obs('B', 800), obs('B', 1900), obs('B', 1000)], now: NOW });
    expect(noisy.verdict).toBe('inconclusive');
    expect(noisy.winner).toBeNull();

    const young = analyzeAbTest({ metric: 'reach_lift', observations: [obs('A', 2000), obs('A', 2100), obs('A', 2200, { postedAt: NOW - HOUR }), obs('B', 900), obs('B', 950), obs('B', 1000)], now: NOW });
    expect(young.verdict).toBe('need_more');
    expect(young.arms[0].excluded).toBe(1);
    expect(young.arms[0].posts[2]).toMatchObject({ excluded: 'too_young' });
    expect(verdictFor([{ arm: 'A', n: 5 }])).toMatchObject({ verdict: 'need_more' });
  });
});

describe('studio/abtests (DB)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-ab-'));
  const IG = '17841400000000009';
  const T = Date.now();
  beforeAll(() => {
    openDb(path.join(dir, 'data.db'));
    setConfig('ai.enabled', true);
    upsertAccount({ igId: IG, username: 'brand_ab', platform: 'instagram' });
    // 10 benchmark posts (reach 1000) 20–60 days before the test posts.
    for (let i = 0; i < 10; i++) {
      const id = `bench${i}`;
      upsertMedia({ mediaId: id, igId: IG, mediaType: 'IMAGE', mediaProductType: 'FEED', caption: 'bench', postedAt: T - (40 + i * 3) * DAY, postedHour: 9, postedWeekday: 1 });
      upsertLatest(id, { reach: 1000, views: 2000, saved: 20, likes: 40 }, 4);
    }
    const posts = [['a1', 2000], ['a2', 2100], ['a3', 2200], ['b1', 900], ['b2', 950], ['b3', 1000], ['young', 5000]];
    posts.forEach(([id, reach], i) => {
      upsertMedia({ mediaId: id, igId: IG, mediaType: 'IMAGE', mediaProductType: 'FEED', caption: `Caption ${id} #tag`, postedAt: id === 'young' ? T - 2 * HOUR : T - (10 - i) * DAY, postedHour: 9, postedWeekday: 1 });
      upsertLatest(id, { reach, views: reach * 2, saved: 10, likes: 30 }, 3);
    });
    q.run("INSERT INTO planner_posts (id, ref, caption, status, version, source, created_at, updated_at) VALUES (1, 'P-0001', 'Question hook?', 'scheduled', 1, 'manual', ?, ?)", T, T);
    q.run("INSERT INTO planner_targets (id, post_id, account_id, platform, format) VALUES (1, 1, ?, 'instagram', 'image')", IG);
  });
  afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

  let testId;
  it('creates a test with arms from historical media and planner targets, validating input', () => {
    expect(() => createTest({ name: '', arms: [] })).toThrow();
    expect(() => createTest({ name: 'x', variable: 'nope', arms: [{ arm: 'A' }, { arm: 'B' }] })).toThrow();
    expect(() => createTest({ name: 'x', arms: [{ arm: 'A', mediaKeys: ['missing'] }, { arm: 'B' }] })).toThrow();
    expect(() => createTest({ name: 'x', arms: [{ arm: 'A' }, { arm: 'A' }] })).toThrow();
    const res = createTest({
      name: 'Question hook vs statement', hypothesis: 'Questions lift reach', variable: 'caption_hook', metric: 'reach_lift',
      arms: [{ arm: 'A', mediaKeys: ['a1', 'a2'], targetIds: [1] }, { arm: 'B', mediaKeys: ['b1', 'b2', 'b3'] }],
    });
    testId = res.id;
    expect(res.arms).toEqual(['A', 'B']);
    expect(q.get('SELECT COUNT(*) AS n FROM ab_test_items WHERE test_id = ?', testId).n).toBe(6);
  });

  it('results wait for the planner target to sync (need more posts), then turn directional', () => {
    let r = getTestResults({ id: testId });
    expect(r.verdict).toBe('need_more');
    const a = r.arms.find((x) => x.arm === 'A');
    expect(a.n).toBe(2);
    expect(a.posts.find((p) => p.targetId === 1)).toMatchObject({ excluded: 'pending', caption: 'Question hook?' });
    q.run("UPDATE planner_targets SET media_key = 'a3', state = 'published' WHERE id = 1");
    r = getTestResults({ id: testId });
    expect(r.arms.map((x) => x.n)).toEqual([3, 3]);
    expect(r.verdict).toBe('directional');
    expect(r.winner).toBe('A');
    expect(r.arms[0].mean).toBeGreaterThan(1.5); // later test posts join the benchmark of the following ones
    expect(listTests()[0]).toMatchObject({ id: testId, verdict: 'directional', winner: 'A', status: 'running' });
  });

  it('tag / untag; too-young posts are excluded', () => {
    tagItem({ testId, arm: 'B', mediaKey: 'young' });
    expect(() => tagItem({ testId, arm: 'B', mediaKey: 'young' })).toThrow();
    const r = getTestResults({ id: testId });
    const young = r.arms[1].posts.find((p) => p.mediaKey === 'young');
    expect(young.excluded).toBe('too_young');
    untagItem({ testId, itemId: young.itemId });
    expect(getTestResults({ id: testId }).arms[1].posts).toHaveLength(3);
  });

  it('candidates list recent media and planner targets', () => {
    const c = candidates({ accountIds: [IG] });
    expect(c.media.map((m) => m.mediaKey)).toEqual(expect.arrayContaining(['a1', 'b1', 'young']));
    expect(c.targets[0]).toMatchObject({ targetId: 1, postId: 1, caption: 'Question hook?' });
  });

  it('conclusion data holds numbers and short captions only; AI summary goes through runGeneration', async () => {
    const data = conclusionData(getTestResults({ id: testId }));
    const json = JSON.stringify(data);
    expect(json).not.toContain(IG);
    expect(json).not.toContain('brand_ab');
    const seen = [];
    const provider = {
      id: 'anthropic', model: 'claude-haiku-4-5', structuredModes: ['schema'],
      userMessage: (t) => ({ role: 'user', content: t }), appendAssistant: (m) => m,
      complete: async (req) => { seen.push(req); return { text: JSON.stringify({ conclusion: 'Arm A (question hooks) is directionally ahead.' }), toolCalls: [], stopReason: 'end', usage: { inputTokens: 300, outputTokens: 50 } }; },
    };
    const out = await concludeTest({ id: testId, conclusion: 'Keep testing.', summarizeWithAi: true, lang: 'en' }, { provider, caps: { vision: false, structuredModes: ['schema'] } });
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen[0])).not.toContain('brand_ab');
    expect(out).toMatchObject({ status: 'concluded', conclusion: 'Keep testing.\n\nArm A (question hooks) is directionally ahead.' });
    expect(out.generationId).toBeGreaterThan(0);
    const reopened = await concludeTest({ id: testId, reopen: true });
    expect(reopened.status).toBe('running');
    removeTest({ id: testId });
    expect(() => getTestResults({ id: testId })).toThrow();
  });
});
