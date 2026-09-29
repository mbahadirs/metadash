import { describe, it, expect } from 'vitest';
import { nextSlots, scoreMatrix, DEFAULT_GRID, MIN_SOURCE_POSTS, SHRINK_K } from '../src/main/planner/suggest.js';

const HOUR = 3_600_000;
const MON = new Date(2026, 8, 28, 0, 0, 0).getTime(); // Monday 28 Sep 2026, local midnight
const at = (dayOffset, hour, minute = 0) => new Date(2026, 8, 28 + dayOffset, hour, minute, 0).getTime();

/** bestTime()-shaped result from [weekday, hour, count, value] cells. */
function mk(cells, minPosts = 3) {
  const matrix = Array.from({ length: 7 }, (_, weekday) => Array.from({ length: 24 }, (__, hour) => ({ weekday, hour, count: 0, value: null, avgReach: null, qualified: false })));
  for (const [w, h, count, value] of cells) matrix[w][h] = { weekday: w, hour: h, count, value, avgReach: null, qualified: count >= minPosts };
  return { matrix, best: [], totalPosts: cells.reduce((s, c) => s + c[2], 0), minPosts };
}

// Tue 10h: 5 posts at 8% (qualified); Wed 18h: 1 post at 12% (shrunk); Mon 9h: 10 posts at 2% → account mean = 72/16 = 4.5
const ACCOUNT = mk([[2, 10, 5, 8], [3, 18, 1, 12], [1, 9, 10, 2]]);

describe('scoreMatrix', () => {
  it('uses qualified cells as-is and shrinks thin cells toward the account mean (k = 3)', () => {
    const s = scoreMatrix(ACCOUNT);
    expect(SHRINK_K).toBe(3);
    expect(s.prior).toBeCloseTo(4.5, 6);
    expect(s.cells[2][10]).toMatchObject({ score: 8, qualified: true, posts: 5, avgEr: 8 });
    expect(s.cells[3][18].score).toBeCloseTo((12 + 4.5 * 3) / 4, 6);
    expect(s.cells[3][18].qualified).toBe(false);
    expect(s.cells[4][4].score).toBeCloseTo(4.5, 6);
    expect(s.cells[4][4].avgEr).toBeNull();
  });
});

describe('nextSlots', () => {
  const base = { accountIds: ['a'], fromMs: MON, now: MON, days: 7, count: 3, minGapHours: 3, existing: [] };

  it('ranks qualified cells first, then shrunk ones, from the account matrix', () => {
    const slots = nextSlots({ ...base, sources: { account: ACCOUNT, portfolio: null } });
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ at: at(1, 10), weekday: 2, hour: 10, score: 8, avgEr: 8, posts: 5, qualified: true, source: 'account', conflicts: [] });
    expect(slots[1]).toMatchObject({ at: at(2, 18), weekday: 3, hour: 18, qualified: false, source: 'account' });
    expect(slots[1].score).toBeCloseTo(6.375, 3);
  });

  it(`falls back to the portfolio matrix when the account has fewer than ${MIN_SOURCE_POSTS} posts`, () => {
    const portfolio = mk([[5, 19, 12, 6], [1, 9, 10, 1]]);
    const slots = nextSlots({ ...base, sources: { account: mk([[2, 10, 2, 30]]), portfolio } });
    expect(slots[0]).toMatchObject({ weekday: 5, hour: 19, source: 'portfolio', qualified: true, avgEr: 6 });
    expect(slots.every((s) => s.source === 'portfolio')).toBe(true);
  });

  it('falls back to the default grid when there is no usable history', () => {
    const slots = nextSlots({ ...base, sources: { account: null, portfolio: mk([]) } });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(s.source).toBe('default');
      expect(s.avgEr).toBeNull();
      expect(s.posts).toBe(0);
      expect(s.score).toBe(DEFAULT_GRID[s.weekday][s.hour]);
    }
    const top = Math.max(...DEFAULT_GRID.flat());
    expect(slots[0].score).toBe(top);
  });

  it('skips slots within minGapHours of an existing post for the same account only', () => {
    const existing = [{ postId: 7, ref: 'P-0007', accountId: 'a', scheduledAt: at(1, 11, 30) }];
    const slots = nextSlots({ ...base, existing, sources: { account: ACCOUNT } });
    expect(slots.map((s) => s.at)).not.toContain(at(1, 10));
    const other = nextSlots({ ...base, existing: [{ ...existing[0], accountId: 'zzz' }], sources: { account: ACCOUNT } });
    expect(other[0].at).toBe(at(1, 10));
  });

  it('never suggests the past or anything less than 15 minutes away', () => {
    const now = at(1, 9, 50);
    const slots = nextSlots({ ...base, fromMs: MON, now, sources: { account: ACCOUNT } });
    expect(slots.every((s) => s.at >= now + 15 * 60_000)).toBe(true);
    expect(slots.map((s) => s.at)).not.toContain(at(1, 10));
    const early = nextSlots({ ...base, fromMs: MON, now: at(1, 9, 40), sources: { account: ACCOUNT } });
    expect(early[0].at).toBe(at(1, 10));
  });

  it('keeps suggestions at least minGapHours apart from each other', () => {
    const acc = mk([[2, 10, 5, 8], [2, 11, 5, 7.9], [1, 9, 10, 2]]);
    const slots = nextSlots({ ...base, sources: { account: acc } });
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) expect(Math.abs(slots[i].at - slots[j].at)).toBeGreaterThanOrEqual(3 * HOUR);
    }
  });

  it('returns conflicting slots (with the conflicts listed) only when nothing else fits', () => {
    const existing = [{ postId: 9, ref: 'P-0009', accountId: 'a', scheduledAt: at(0, 2) }];
    const slots = nextSlots({ ...base, days: 3 / 24, count: 1, existing, sources: { account: ACCOUNT } });
    expect(slots).toHaveLength(1);
    expect(slots[0].conflicts).toEqual([existing[0]]);
  });

  it('returns the best slots first and respects count (ties: better default-grid hour, then earlier)', () => {
    const slots = nextSlots({ ...base, count: 5, sources: { account: ACCOUNT } });
    expect(slots).toHaveLength(5);
    for (let i = 1; i < slots.length; i += 1) expect(slots[i - 1].score).toBeGreaterThanOrEqual(slots[i].score);
    // slots 3–5 all score the prior; the tie-break prefers typical posting hours over the night
    for (const s of slots.slice(2)) expect(DEFAULT_GRID[s.weekday][s.hour]).toBeGreaterThan(0.5);
  });

  it('rejects an empty matrix gracefully and caps count', () => {
    expect(nextSlots({ ...base, count: 0, sources: {} })).toEqual([]);
    expect(nextSlots({ ...base, count: 999, days: 1, sources: {} }).length).toBeLessThanOrEqual(24);
  });
});
