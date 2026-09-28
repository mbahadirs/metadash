import { describe, it, expect } from 'vitest';
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
