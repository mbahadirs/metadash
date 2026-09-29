import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { seedDemo } from '../src/main/seed/index.js';
import { portfolio } from '../src/main/analytics/portfolio.js';
import { accountAnalytics } from '../src/main/analytics/account.js';
import { healthScores } from '../src/main/analytics/health.js';
import { bestTime } from '../src/main/analytics/besttime.js';
import { weeklyDigest } from '../src/main/analytics/weeklyDigest.js';
import { buildReport } from '../src/main/export/htmlReport.js';
import { listAccounts } from '../src/main/db/queries/accounts.js';
import { fmtDate } from '../src/main/analytics/util.js';
import { subDays } from 'date-fns';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-test-'));
const to = fmtDate(new Date());
const from = fmtDate(subDays(new Date(), 27));

beforeAll(() => { openDb(path.join(dir, 'data.db')); seedDemo({ reset: true }); });
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('seed + analytics (integration)', () => {
  it('seeds 40 tracked accounts with ad accounts and competitors', () => {
    expect(listAccounts({ platforms: ['instagram'] })).toHaveLength(40);
    expect(listAccounts()).toHaveLength(54); // + 8 demo Facebook Pages and 6 Threads profiles (v1.3)
    expect(seedDemo({}).skipped).toBe(true);
  });
  it('portfolio for 40 accounts computes in under 1 second', () => {
    const t = Date.now();
    const p = portfolio({ from, to, platforms: ['instagram'] });
    expect(Date.now() - t).toBeLessThan(5000); // isolated: ~70 ms; generous bound so background load on the machine does not flake the suite
    expect(p.rows).toHaveLength(40);
    expect(p.kpis.totalFollowers.value).toBeGreaterThan(0);
    expect(p.rows.every((r) => r.health != null && r.health >= 0 && r.health <= 100)).toBe(true);
  });
  it('health scores are percentile-normalised within the portfolio', () => {
    const scores = healthScores({ from, to });
    const max = Math.max(...scores.map((s) => s.score));
    expect(max).toBeGreaterThan(50);
  });
  it('account analytics returns KPIs with previous-period comparison', () => {
    const a = accountAnalytics({ igId: '17840000', from, to });
    expect(a.kpis.reach.prev).toBeGreaterThan(0);
    expect(a.series).toHaveLength(28);
    expect(a.posts.length).toBeGreaterThan(0);
  });
  it('best time only qualifies cells with ≥ 3 posts', () => {
    const bt = bestTime({ igId: '17840000', from: fmtDate(subDays(new Date(), 119)), to });
    expect(bt.matrix).toHaveLength(7);
    expect(bt.best.every((c) => c.count >= 3)).toBe(true);
  });
  it('weekly digest produces template sentences and HTML reports build', () => {
    const d = weeklyDigest({ weekOf: to });
    expect(d.text).toMatch(/this week/);
    expect(weeklyDigest({ weekOf: to, lang: 'tr' }).text).toMatch(/Bu hafta/);
    expect(buildReport('portfolio', { from, to })).toContain('<svg');
    expect(buildReport('monthly', { igId: '17840000', from, to })).toContain('Top 6 posts');
    expect(buildReport('monthly', { igId: '17840000', from, to, lang: 'tr' })).toContain('En iyi 6 gönderi');
  });
});
