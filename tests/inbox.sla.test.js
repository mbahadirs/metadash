/** v2.0 chunk D: SLA — median/p90 FRT, within-SLA with eligibility, backlog, grouping, health response component. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { percentile, summarize, computeSla, responseScore, inboxSla } from '../src/main/inbox/sla.js';
import { commentStatsV2, setStatus, slaRows } from '../src/main/db/queries/inbox.js';
import { responseRate, RESPONSE_SPLIT } from '../src/main/analytics/health.js';
import { openTempDb, seedAccounts, post, comment, IG, FB, HOUR, DAY } from './inbox.fixtures.js';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const MIN = 60_000;
const row = (accountId, createdAgoH, frtMin, extra = {}) => ({
  commentId: `${accountId}-${createdAgoH}-${frtMin}`, accountId, platform: extra.platform ?? 'instagram', createdAt: NOW - createdAgoH * HOUR,
  firstResponseAt: frtMin == null ? null : NOW - createdAgoH * HOUR + frtMin * MIN, status: extra.status ?? (frtMin == null ? 'open' : 'replied'),
});

describe('pure metrics', () => {
  it('percentile interpolates linearly', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([10], 0.9)).toBe(10);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBe(91);
  });

  it('answered %, within-SLA % over eligible comments, median/p90 FRT and backlog', () => {
    const rows = [
      row(IG, 100, 60), row(IG, 100, 120), row(IG, 100, 30 * 60), // 2 of 3 answered within 24 h
      row(IG, 100, null), // unanswered, overdue → eligible, backlog
      row(IG, 2, null), // fresh, not eligible yet, not backlog
    ];
    const s = summarize(rows, { slaHours: 24, now: NOW });
    expect(s).toEqual({ incoming: 5, answered: 3, answeredPct: 60, withinSlaPct: 50, medianFrtMin: 120, p90FrtMin: 1464, backlog: 1 });
    expect(responseScore(s)).toBe(55);
    expect(summarize([], { now: NOW })).toMatchObject({ incoming: 0, answeredPct: null, withinSlaPct: null, medianFrtMin: null, backlog: 0 });
    expect(responseScore(summarize([row(IG, 1, null)], { now: NOW }))).toBe(0);
  });

  it('groups by account + platform, busiest backlog first, totals across all', () => {
    const out = computeSla([row(IG, 50, 10), row(FB, 50, null, { platform: 'facebook' }), row(FB, 60, null, { platform: 'facebook' })], { slaHours: 24, now: NOW });
    expect(out.slaHours).toBe(24);
    expect(out.rows.map((r) => [r.accountId, r.platform, r.backlog])).toEqual([[FB, 'facebook', 2], [IG, 'instagram', 0]]);
    expect(out.totals).toMatchObject({ incoming: 3, answered: 1, backlog: 2 });
  });

  it('health response = 50 % answered + 50 % within SLA', () => {
    expect(RESPONSE_SPLIT).toEqual({ answered: 0.5, withinSla: 0.5 });
    expect(responseRate({ incoming: 4, answered: 2, eligible: 4, withinSla: 1 })).toBe(37.5);
    expect(responseRate({ incoming: 0 })).toBe(0);
    expect(responseRate({ incoming: 2, answered: 1, eligible: 0, withinSla: 0 })).toBe(50);
  });
});

describe('db', () => {
  let close;
  beforeAll(() => {
    close = openTempDb();
    seedAccounts();
    post('m1', IG, NOW - 5 * DAY);
    comment('a', 'm1', { at: NOW - 3 * DAY });
    comment('a-r', 'm1', { at: NOW - 3 * DAY + 30 * MIN, owner: true, username: 'cafe_brand', parentId: 'a' });
    comment('b', 'm1', { at: NOW - 3 * DAY });
    comment('b-r', 'm1', { at: NOW - 3 * DAY + 30 * HOUR, owner: true, username: 'cafe_brand', parentId: 'b' });
    comment('c', 'm1', { at: NOW - 3 * DAY });
    comment('d', 'm1', { at: NOW - 2 * DAY, text: 'spam' });
    comment('c-fan', 'm1', { at: NOW - 3 * DAY + HOUR, parentId: 'c', username: 'other' });
    setStatus(['d'], 'ignored');
  });
  afterAll(() => close());

  it('slaRows: top-level incoming only, closed-without-reply excluded', () => {
    expect(slaRows({ fromMs: NOW - 10 * DAY, toMs: NOW, accountIds: [IG] }).map((r) => [r.commentId, r.firstResponseAt != null])).toEqual([['a', true], ['b', true], ['c', false]]);
  });

  it('commentStatsV2 feeds the health score', () => {
    const s = commentStatsV2(IG, NOW - 10 * DAY, NOW, { slaHours: 24, now: NOW });
    expect(s).toMatchObject({ incoming: 3, answered: 2, withinSla: 1, eligible: 3, medianFrtMin: (30 + 30 * 60) / 2, total: 7 });
    expect(Math.round(responseRate(s) * 10) / 10).toBe(Math.round((0.5 * (2 / 3) * 100 + 0.5 * (1 / 3) * 100) * 10) / 10);
  });

  it('inboxSla by date range', () => {
    const out = inboxSla({ from: '2026-09-20', to: '2026-09-30' }, { now: NOW, slaHours: 24 });
    expect(out.totals).toMatchObject({ incoming: 3, answered: 2, answeredPct: 66.7, withinSlaPct: 33.3, backlog: 1 });
  });
});
