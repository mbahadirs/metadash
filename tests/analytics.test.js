import { describe, it, expect, afterAll } from 'vitest';
import { pctChange, previousPeriod, percentileRank, stddev, median, eachDay, rangeMs } from '../src/main/analytics/util.js';
import { erByFollowers, erByReach, saveRate, interactions } from '../src/main/analytics/engagement.js';
import { hoursToShare } from '../src/main/analytics/lifecycle.js';
import { needsRefresh } from '../src/main/sync/jobs/organicAccount.js';
import { analyzeCaption } from '../src/main/sync/caption.js';

describe('util', () => {
  it('pctChange handles zero and null', () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(50, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(null, 10)).toBeNull();
  });
  it('previousPeriod is equal length ending the day before', () => {
    expect(previousPeriod('2026-09-01', '2026-09-07')).toEqual({ from: '2026-08-25', to: '2026-08-31', days: 7 });
  });
  it('percentileRank / stddev / median', () => {
    expect(percentileRank(5, [1, 2, 3, 4, 5])).toBe(90);
    expect(percentileRank(null, [1, 2])).toBe(50);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
  it('eachDay and rangeMs are inclusive', () => {
    expect(eachDay('2026-01-30', '2026-02-02')).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
    const { fromMs, toMs } = rangeMs('2026-01-01', '2026-01-01');
    expect(toMs - fromMs).toBe(86_400_000 - 1);
  });
});

describe('engagement', () => {
  const m = { likes: 100, comments: 10, saved: 20, shares: 5, reach: 2700 };
  it('sums interactions and computes rates as percentages', () => {
    expect(interactions(m)).toBe(135);
    expect(erByFollowers(m, 10_000)).toBeCloseTo(1.35);
    expect(erByReach(m)).toBeCloseTo(5);
    expect(saveRate(m)).toBeCloseTo(0.7407, 3);
    expect(erByFollowers(m, 0)).toBeNull();
    expect(saveRate({ ...m, reach: 0 })).toBeNull();
  });
});

describe('lifecycle', () => {
  it('interpolates hours to reach 80% of final value', () => {
    const series = [{ ageHours: 1, value: 10 }, { ageHours: 6, value: 60 }, { ageHours: 24, value: 100 }];
    expect(hoursToShare(series, 0.8)).toBeCloseTo(15);
    expect(hoursToShare([], 0.8)).toBeNull();
  });
});

describe('refresh tiers', () => {
  const tiers = { fresh: 48, recent: 24, month: 168, old: 720 };
  const now = 1_000_000_000_000;
  const H = 3_600_000;
  it('fresh posts refresh every sync', () => expect(needsRefresh(10, now - H, now, tiers)).toBe(true));
  it('2–7 day posts refresh daily', () => {
    expect(needsRefresh(100, now - 12 * H, now, tiers)).toBe(false);
    expect(needsRefresh(100, now - 25 * H, now, tiers)).toBe(true);
  });
  it('30+ day posts refresh monthly', () => {
    expect(needsRefresh(2000, now - 200 * H, now, tiers)).toBe(false);
    expect(needsRefresh(2000, now - 800 * H, now, tiers)).toBe(true);
  });
  it('never captured → refresh', () => expect(needsRefresh(5000, null, now, tiers)).toBe(true));
});

describe('caption analysis', () => {
  it('counts hashtags, mentions and emoji', () => {
    expect(analyzeCaption('Merhaba @ayse #yaz #tatil 🎉☀️')).toEqual({ captionLength: 30, hashtagCount: 2, mentionCount: 1, emojiCount: 2 });
  });
});

describe('budget distribution', async () => {
  const { distributeBudget } = await import('../src/main/analytics/budget.js');
  it('splits evenly when nothing is overridden', () => {
    const r = distributeBudget(100, [{ id: 'a' }, { id: 'b' }], new Map());
    expect(r.rows.map((x) => x.amount)).toEqual([50, 50]);
    expect(r.rows.every((x) => x.mode === 'auto')).toBe(true);
  });
  it('keeps manual amounts and shares the remainder', () => {
    const r = distributeBudget(100, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], new Map([['a', 31]]));
    expect(r.rows[0]).toEqual({ id: 'a', amount: 31, mode: 'manual' });
    expect(r.rows[1].amount).toBeCloseTo(34.5);
    expect(r.rows[2].amount).toBeCloseTo(34.5);
  });
  it('flags over-allocation and gives autos nothing', () => {
    const r = distributeBudget(100, [{ id: 'a' }, { id: 'b' }], new Map([['a', 120]]));
    expect(r.overAllocated).toBe(true);
    expect(r.rows[1].amount).toBe(0);
  });
  it('returns null amounts when the parent has no budget', () => {
    const r = distributeBudget(null, [{ id: 'a' }], new Map());
    expect(r.rows[0].amount).toBeNull();
  });
});

// ---------- multi-platform analytics (v1.3) ----------
describe('multi-platform analytics', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { subDays: sub } = await import('date-fns');
  const { openDb, closeDb } = await import('../src/main/db/index.js');
  const { upsertProfile } = await import('../src/main/db/queries/profiles.js');
  const { upsertAccount, insertSnapshot, upsertInsightDaily } = await import('../src/main/db/queries/accounts.js');
  const { upsertMedia } = await import('../src/main/db/queries/media.js');
  const { materializeLatest } = await import('../src/main/analytics/engagement.js');
  const { fmtDate } = await import('../src/main/analytics/util.js');
  const { portfolio } = await import('../src/main/analytics/portfolio.js');
  const { healthScores, HEALTH_WEIGHTS, HEALTH_WEIGHTS_NO_RESPONSE } = await import('../src/main/analytics/health.js');
  const { accountAnalytics } = await import('../src/main/analytics/account.js');
  const { compare } = await import('../src/main/analytics/compare.js');
  const { anomalies } = await import('../src/main/analytics/anomaly.js');
  const { normalizePlatforms, kpiKeysFor, chartMetricsFor } = await import('../src/main/analytics/platform.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-mp-'));
  openDb(path.join(dir, 'data.db'));
  const now = new Date();
  const to = fmtDate(now);
  const from = fmtDate(sub(now, 13));
  const profileId = upsertProfile({ label: 'Test', appId: '1', tokenRef: 'token:test', tokenExpiresAt: null });
  const ACCS = [
    { igId: '1001', platform: 'instagram', username: 'ig_a', base: 1000, perDay: 2 },
    { igId: '1002', platform: 'instagram', username: 'ig_b', base: 2000, perDay: 1 },
    { igId: 'fb-2001', platform: 'facebook', username: 'fb_a', base: 1000, perDay: 10 },
    { igId: 'fb-2002', platform: 'facebook', username: 'fb_b', base: 1000, perDay: 0 },
    { igId: 'th-3001', platform: 'threads', username: 'th_a', base: 500, perDay: 5 },
    { igId: 'th-3002', platform: 'threads', username: 'th_b', base: 500, perDay: 1 },
  ];
  for (const a of ACCS) {
    upsertAccount({ igId: a.igId, platform: a.platform, externalId: a.igId.replace(/^(fb|th)-/, ''), profileId, username: a.username, name: a.username });
    for (let d = 59; d >= 0; d -= 1) {
      const date = fmtDate(sub(now, d));
      const followers = a.base + (59 - d) * a.perDay;
      insertSnapshot({ igId: a.igId, date, followers, follows: 1, mediaCount: 10 });
      if (a.platform === 'instagram') { upsertInsightDaily(a.igId, date, 'reach', 100); upsertInsightDaily(a.igId, date, 'views', 150); upsertInsightDaily(a.igId, date, 'accounts_engaged', 9); }
      if (a.platform === 'facebook') { upsertInsightDaily(a.igId, date, 'reach', 200); upsertInsightDaily(a.igId, date, 'views', 300); upsertInsightDaily(a.igId, date, 'post_engagements', 20); upsertInsightDaily(a.igId, date, 'profile_views', 5); }
      if (a.platform === 'threads') {
        const views = a.igId === 'th-3001' && d === 0 ? 4000 : d % 2 ? 390 : 410;
        upsertInsightDaily(a.igId, date, 'views', views);
        for (const [m, v] of [['likes', 10], ['replies', 2], ['reposts', 1], ['quotes', 1], ['link_clicks', 3]]) upsertInsightDaily(a.igId, date, m, v);
      }
    }
    for (let i = 0; i < 3; i += 1) {
      const posted = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2 - i * 3, 12, 0);
      const mediaId = `${a.igId}_p${i}`;
      const type = a.platform === 'threads' ? 'TEXT_POST' : 'IMAGE';
      const product = a.platform === 'facebook' ? 'FB_POST' : a.platform === 'threads' ? 'THREADS' : 'FEED';
      upsertMedia({ mediaId, igId: a.igId, mediaType: type, mediaProductType: product, caption: 'x', postedAt: posted.getTime(), postedHour: 12, postedWeekday: posted.getDay() });
      const values = a.platform === 'instagram' ? { reach: 500, views: 700, likes: 40, comments: 4, saved: 6, shares: 2 }
        : a.platform === 'facebook' ? { reach: 800, views: 1000, likes: 30, comments: 3, shares: 5, clicks: 12 }
          : { views: 900, likes: 25, comments: 5, reposts: 3, quotes: 1, shares: 1 };
      materializeLatest(mediaId, values, a.base);
    }
  }
  afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('normalizePlatforms validates the platform filter', () => {
    expect(normalizePlatforms(undefined)).toBeUndefined();
    expect(normalizePlatforms([])).toBeUndefined();
    expect(normalizePlatforms(['facebook', 'threads', 'facebook'])).toEqual(['facebook', 'threads']);
    expect(() => normalizePlatforms(['myspace'])).toThrow();
    expect(() => normalizePlatforms('instagram')).toThrow();
  });

  it('kpi keys and chart metrics depend on the platform', () => {
    expect(kpiKeysFor('instagram')).toEqual(['reach', 'views', 'profileViews', 'er', 'saveRate', 'newFollowers', 'posts']);
    expect(kpiKeysFor('facebook')).toEqual(['reach', 'views', 'postEngagements', 'profileViews', 'er', 'newFollowers', 'posts']);
    expect(kpiKeysFor('threads')).toEqual(['views', 'likes', 'replies', 'reposts', 'linkClicks', 'newFollowers', 'er', 'posts']);
    expect(chartMetricsFor('instagram')).toEqual(['reach', 'accounts_engaged']);
    expect(chartMetricsFor('facebook')).toEqual(['reach', 'post_engagements']);
    expect(chartMetricsFor('threads')).toEqual(['views', 'likes']);
  });

  it('portfolio({ platforms }) filters rows and splits KPIs per platform', () => {
    const fb = portfolio({ from, to, platforms: ['facebook'] });
    expect(fb.rows.map((r) => r.igId).sort()).toEqual(['fb-2001', 'fb-2002']);
    expect(fb.kpis.totalReach.value).toBe(14 * 400);
    const all = portfolio({ from, to });
    expect(all.rows).toHaveLength(6);
    expect(all.kpis.totalReach.value).toBe(14 * (200 + 400)); // Threads has no reach
    expect(all.kpis.byPlatform.instagram).toMatchObject({ accounts: 2, reach: 14 * 200 });
    expect(all.kpis.byPlatform.facebook).toMatchObject({ accounts: 2, reach: 14 * 400, views: 14 * 600 });
    expect(all.kpis.byPlatform.threads.accounts).toBe(2);
    expect(all.kpis.byPlatform.threads.reach).toBeNull();
    expect(all.kpis.byPlatform.threads.views).toBeGreaterThan(0);
    const th = all.rows.find((r) => r.igId === 'th-3001');
    expect(th).toMatchObject({ platform: 'threads', primaryMetric: 'views', reach: null, saveRate: null });
    expect(th.primaryValue).toBeGreaterThan(5000);
    expect(all.rows.find((r) => r.igId === 'fb-2001')).toMatchObject({ platform: 'facebook', primaryMetric: 'reach', primaryValue: 14 * 200, saveRate: null });
    expect(all.rows.find((r) => r.igId === '1001').saveRate).toBeGreaterThan(0);
    expect(all.platforms).toEqual(['instagram', 'facebook', 'threads']);
  });

  it('health percentiles are computed within each platform; no-comments platforms are re-weighted', () => {
    const scores = healthScores({ from, to });
    const fbA = scores.find((s) => s.igId === 'fb-2001');
    expect(fbA.platform).toBe('facebook');
    expect(fbA.components.growth.pct).toBe(75); // best of 2 Facebook pages, not of all 6 accounts
    // v2.0 (chunk D): Facebook and Threads have an inbox, so they get the response component; platforms without one
    // (capabilities.inbox false, e.g. TikTok) keep the re-weighting.
    expect(fbA.components.response).not.toBeNull();
    expect(HEALTH_WEIGHTS_NO_RESPONSE).toEqual({ growth: 0.375, engagement: 0.375, consistency: 0.25 });
    const w = HEALTH_WEIGHTS;
    const c = fbA.components;
    expect(Math.abs(fbA.score - (w.growth * c.growth.pct + w.engagement * c.engagement.pct + w.consistency * c.consistency.pct + w.response * c.response.pct))).toBeLessThanOrEqual(1);
    expect(scores.find((s) => s.igId === '1001').components.response).not.toBeNull();
    expect(scores.find((s) => s.igId === 'th-3001').components.response).not.toBeNull();
  });

  it('accountAnalytics returns platform, capabilities and applicable KPIs', () => {
    const fb = accountAnalytics({ igId: 'fb-2001', from, to });
    expect(fb.platform).toBe('facebook');
    expect(fb.primaryMetric).toBe('reach');
    expect(fb.capabilities).toMatchObject({ reach: true, saveRate: false, stories: false });
    expect(fb.kpiKeys).toEqual(kpiKeysFor('facebook'));
    expect(Object.keys(fb.kpis).sort()).toEqual([...kpiKeysFor('facebook')].sort());
    expect(fb.kpis.postEngagements.value).toBe(14 * 20);
    expect(fb.kpis.reach.value).toBe(14 * 200);
    expect(fb.chartMetrics).toEqual(['reach', 'post_engagements']);
    expect(fb.series[0]).toHaveProperty('post_engagements');
    const th = accountAnalytics({ igId: 'th-3001', from, to });
    expect(th.platform).toBe('threads');
    expect(th.primaryMetric).toBe('views');
    expect(th.kpis.reach).toBeUndefined();
    expect(th.kpis.saveRate).toBeUndefined();
    expect(th.kpis.likes.value).toBe(140);
    expect(th.kpis.linkClicks.value).toBe(42);
    expect(th.series[0]).toHaveProperty('likes');
    expect(th.byType.every((t) => t.avgReach == null)).toBe(true);
    const ig = accountAnalytics({ igId: '1001', from, to });
    expect(ig.platform).toBe('instagram');
    expect(Object.keys(ig.kpis).sort()).toEqual([...kpiKeysFor('instagram')].sort());
    expect(ig.kpis.saveRate.value).toBeGreaterThan(0);
  });

  it('compare handles mixed platforms (Threads reach → views, no save rate)', () => {
    const c = compare({ igIds: ['1001', 'th-3001'], from, to, metric: 'reach' });
    expect(c.mixedPlatforms).toBe(true);
    const th = c.series.find((s) => s.igId === 'th-3001');
    expect(th.metric).toBe('views');
    expect(th.platform).toBe('threads');
    expect(th.points.reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(0);
    expect(c.series.find((s) => s.igId === '1001').metric).toBe('reach');
    expect(c.table.find((r) => r.igId === 'th-3001')).toMatchObject({ platform: 'threads', reach: null, saveRate: null });
    const sr = compare({ igIds: ['1001', 'th-3001'], from, to, metric: 'save_rate' });
    expect(sr.unsupported).toEqual(['th-3001']);
    expect(sr.series.find((s) => s.igId === 'th-3001').points.every((p) => p == null)).toBe(true);
    expect(compare({ igIds: ['1001', '1002'], from, to }).mixedPlatforms).toBe(false);
  });

  it('anomalies use the primary metric (views on Threads)', () => {
    const list = anomalies({ from, to, igIds: ['th-3001'] });
    const hit = list.find((a) => a.kind === 'views');
    expect(hit).toMatchObject({ igId: 'th-3001', platform: 'threads', date: to, direction: 'up' });
    expect(list.some((a) => a.kind === 'reach')).toBe(false);
  });

  it('interactions include Threads reposts and quotes but not link clicks', () => {
    expect(interactions({ likes: 1, comments: 2, reposts: 3, quotes: 4, clicks: 100 })).toBe(10);
  });
});
