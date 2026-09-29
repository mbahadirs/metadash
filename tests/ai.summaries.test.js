import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { subDays } from 'date-fns';
import { openDb, closeDb } from '../src/main/db/index.js';
import { seedDemo } from '../src/main/seed/index.js';
import { listAdAccounts } from '../src/main/db/queries/ads.js';
import { listMedia } from '../src/main/db/queries/media.js';
import { portfolio } from '../src/main/analytics/portfolio.js';
import { fmtDate } from '../src/main/analytics/util.js';
import { commentarySummary } from '../src/main/ai/summaries/commentary.js';
import { anomalySummary } from '../src/main/ai/summaries/anomaly.js';
import { compact } from '../src/main/ai/summaries/compact.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-ai-test-'));
const to = fmtDate(new Date());
const from = fmtDate(subDays(new Date(), 27));
const IG = '17840000';

beforeAll(() => { openDb(path.join(dir, 'data.db')); seedDemo({ reset: true }); });
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

/** Walks a value and returns the paths of undefined/null/NaN leaves. */
function nullishPaths(v, p = '$') {
  if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) return [p];
  if (Array.isArray(v)) return v.flatMap((x, i) => nullishPaths(x, `${p}[${i}]`));
  if (typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => nullishPaths(x, `${p}.${k}`));
  return [];
}

describe('compact', () => {
  it('drops nullish values and empty containers, rounds numbers, does not mutate', () => {
    const input = { a: 1.23456, b: null, c: undefined, d: [], e: {}, f: { g: NaN, h: 'x' }, i: [1, null, 2] };
    expect(compact(input)).toEqual({ a: 1.23, f: { h: 'x' }, i: [1, 2] });
    expect(input.b).toBeNull();
  });
});

describe('commentarySummary', () => {
  it('account report: KPIs vs previous period, top/bottom posts with truncated captions', () => {
    const s = commentarySummary({ template: 'monthly', igIds: [IG], from, to, lang: 'en' });
    expect(nullishPaths(s)).toEqual([]);
    expect(s.report).toMatchObject({ template: 'monthly', from, to, language: 'English' });
    expect(s.report.previousPeriod).toBeTruthy();
    const acc = s.accounts[0];
    expect(acc.username).toBeTruthy();
    expect(acc.kpis.reach.value).toBeGreaterThan(0);
    expect(acc.topPosts.length).toBeGreaterThan(0);
    expect(acc.topPosts.length).toBeLessThanOrEqual(3);
    expect(acc.bottomPosts.length).toBeLessThanOrEqual(3);
    for (const p of [...acc.topPosts, ...acc.bottomPosts]) expect((p.caption ?? '').length).toBeLessThanOrEqual(121);
    expect(JSON.stringify(s).length).toBeLessThan(12_000);
  });

  it('includes ad spend/results for an account with a linked ad account', () => {
    const act = listAdAccounts().find((a) => a.linkedIgId && a.isTracked);
    const s = commentarySummary({ template: 'campaign', igIds: [act.linkedIgId], from, to });
    expect(s.accounts[0].ads.currency).toBeTruthy();
    expect(s.accounts[0].ads.spend).toBeGreaterThan(0);
    expect(nullishPaths(s)).toEqual([]);
  });

  it('caps the number of accounts and notes the omission', () => {
    const ids = portfolio({ from, to }).rows.map((r) => r.igId).slice(0, 12);
    const s = commentarySummary({ template: 'custom', igIds: ids, from, to });
    expect(s.accounts.length).toBeLessThanOrEqual(8);
    expect(s.omittedAccounts).toBe(ids.length - s.accounts.length);
  });

  it('portfolio and weekly templates summarize the whole portfolio', () => {
    const p = commentarySummary({ template: 'portfolio', from, to, tagIds: [] });
    expect(p.portfolio.kpis.totalReach.value).toBeGreaterThan(0);
    expect(p.portfolio.accounts).toBeGreaterThan(0);
    expect(p.portfolio.topAccounts.length).toBeGreaterThan(0);
    expect(nullishPaths(p)).toEqual([]);
    expect(JSON.stringify(p).length).toBeLessThan(12_000);
    const w = commentarySummary({ template: 'weekly', from, to });
    expect(w.report.from).toBe(fmtDate(subDays(new Date(to), 6)));
    expect(nullishPaths(w)).toEqual([]);
  });

  it('basket template summarizes the selected posts', () => {
    const ids = listMedia({ igIds: [IG], sort: 'reach', limit: 2 }).map((m) => m.mediaId);
    const s = commentarySummary({ template: 'basket', basket: ids, from, to });
    expect(s.posts).toHaveLength(2);
    expect(nullishPaths(s)).toEqual([]);
  });

  it('validates input', () => {
    expect(() => commentarySummary({ template: 'nope', from, to })).toThrow();
    expect(() => commentarySummary({ template: 'monthly', igIds: [], from, to })).toThrow();
    expect(() => commentarySummary({ template: 'monthly', igIds: [IG], from: 'x', to })).toThrow();
    expect(() => commentarySummary({ template: 'monthly', igIds: [IG], from: to, to: from })).toThrow();
  });
});

describe('anomalySummary', () => {
  it('gathers ±7 days of series, posts, ads and posting frequency around the anomaly', () => {
    const an = portfolio({ from, to }).attention.anomalies[0];
    const input = an ? { igId: an.igId, date: an.date, kind: an.kind, mediaId: an.mediaId } : { igId: IG, date: fmtDate(subDays(new Date(), 1)), kind: 'reach' };
    const s = anomalySummary(input);
    expect(nullishPaths(s)).toEqual([]);
    expect(s.account.username).toBeTruthy();
    expect(s.anomaly).toMatchObject({ kind: input.kind, date: input.date });
    if (an) expect(s.anomaly.z).toBeDefined();
    expect(s.window.from).toBe(fmtDate(subDays(new Date(input.date), 7)));
    expect(s.dailySeries.length).toBeGreaterThan(0);
    expect(s.dailySeries.length).toBeLessThanOrEqual(15);
    expect(s.postingFrequency).toHaveProperty('postsInWindow');
    expect(s.postingFrequency).toHaveProperty('avgPostsPerWeekPrior30d');
    for (const p of s.postsInWindow ?? []) expect(p.date >= s.window.from && p.date <= s.window.to).toBe(true);
    expect(JSON.stringify(s).length).toBeLessThan(10_000);
  });

  it('validates input', () => {
    expect(() => anomalySummary({ igId: IG, date: 'bad', kind: 'reach' })).toThrow();
    expect(() => anomalySummary({ igId: IG, date: to, kind: 'weird' })).toThrow();
    expect(() => anomalySummary({ igId: 'missing', date: to, kind: 'reach' })).toThrow();
  });
});
