import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { seedDemo, clearAll, canLoadDemo } from '../src/main/seed/index.js';
import { upsertProfile } from '../src/main/db/queries/profiles.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-demo-'));
openDb(path.join(dir, 'data.db'));
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });
describe('demo data guard', () => {
  beforeEach(() => clearAll());
  it('allows demo data on an empty database', () => {
    expect(canLoadDemo()).toBe(true);
  });
  it('allows reloading demo data over existing demo data', () => {
    seedDemo({ reset: true });
    expect(canLoadDemo()).toBe(true);
  });
  it('refuses demo data while a real Meta connection exists', () => {
    upsertProfile({ label: 'Real', appId: '123456', tokenRef: 'token:profile', tokenExpiresAt: null });
    expect(canLoadDemo()).toBe(false);
  });
});

describe('demo data per platform', async () => {
  const { listAccounts, getAccount, latestFollowers } = await import('../src/main/db/queries/accounts.js');
  const { listMedia } = await import('../src/main/db/queries/media.js');
  const { getActiveProfile } = await import('../src/main/db/queries/profiles.js');
  const { accountDemographics } = await import('../src/main/analytics/account.js');
  const { extendDemoDay } = await import('../src/main/seed/index.js');
  const { runDemoSync } = await import('../src/main/sync/demo.js');
  const { q } = await import('../src/main/db/index.js');
  let seeded;
  beforeAll(() => { seeded = seedDemo({ reset: true }); });

  it('keeps the 40 Instagram accounts and adds tracked Facebook Pages and Threads profiles', () => {
    expect(seeded).toMatchObject({ accounts: 40, facebookPages: 8, threadsProfiles: 6 });
    expect(listAccounts({ platforms: ['instagram'] })).toHaveLength(40);
    const fb = listAccounts({ platforms: ['facebook'] });
    const th = listAccounts({ platforms: ['threads'] });
    expect(fb).toHaveLength(8);
    expect(th).toHaveLength(6);
    expect(listAccounts({ platforms: ['youtube'] })).toHaveLength(2);
    expect(listAccounts({ platforms: ['tiktok'] })).toHaveLength(3);
    expect(listAccounts()).toHaveLength(59); // 40 IG + 8 FB + 6 Threads + 2 YouTube + 3 TikTok
    for (const a of fb) {
      expect(a.igId).toMatch(/^fb-\d+$/);
      expect(a.externalId).toBe(a.igId.slice(3));
      expect(a.isTracked).toBe(true);
    }
    const linked = fb.filter((a) => a.linkedAccountId);
    expect(linked.length).toBeGreaterThanOrEqual(6);
    for (const a of linked) expect(getAccount(a.linkedAccountId).clientName).toBe(a.clientName);
    for (const a of th) expect(a.igId).toMatch(/^th-\d+$/);
  });

  it('seeds platform-shaped posts, insights and demographics', () => {
    const fb = listAccounts({ platforms: ['facebook'] })[0];
    const fbPosts = listMedia({ igIds: [fb.igId] });
    expect(fbPosts.length).toBeGreaterThan(10);
    expect(fbPosts.every((p) => p.mediaProductType === 'FB_POST' && p.platform === 'facebook')).toBe(true);
    expect(fbPosts.every((p) => p.mediaId.startsWith(`${fb.externalId}_`))).toBe(true);
    expect(fbPosts.some((p) => p.clicks > 0 && p.reach > 0)).toBe(true);
    expect(fbPosts.every((p) => p.saved == null)).toBe(true);
    const fbMetrics = q.all('SELECT DISTINCT metric FROM account_insights_daily WHERE ig_id = ?', fb.igId).map((r) => r.metric).sort();
    expect(fbMetrics).toEqual(['follower_count', 'post_engagements', 'profile_views', 'reach', 'unfollows', 'views']);
    expect(accountDemographics({ igId: fb.igId }).capturedAt).toBeNull();

    const th = listAccounts({ platforms: ['threads'] })[0];
    const thPosts = listMedia({ igIds: [th.igId] });
    expect(thPosts.length).toBeGreaterThan(10);
    expect(thPosts.every((p) => p.mediaId.startsWith('th-') && p.mediaProductType === 'THREADS' && p.reach == null)).toBe(true);
    expect(thPosts.some((p) => p.mediaType === 'TEXT_POST')).toBe(true);
    expect(thPosts.some((p) => p.views > 0 && p.reposts > 0)).toBe(true);
    const thMetrics = q.all('SELECT DISTINCT metric FROM account_insights_daily WHERE ig_id = ?', th.igId).map((r) => r.metric).sort();
    expect(thMetrics).toEqual(['likes', 'link_clicks', 'quotes', 'replies', 'reposts', 'views']);
    const demo = accountDemographics({ igId: th.igId });
    expect(demo.age.length).toBeGreaterThan(3);
    expect(demo.gender.length).toBeGreaterThan(1);
    expect(demo.country.length).toBeGreaterThan(1);
    expect(q.get('SELECT COUNT(*) AS n FROM stories WHERE ig_id LIKE ? OR ig_id LIKE ?', 'fb-%', 'th-%').n).toBe(0);
  });

  it('adds a demo Threads profile row next to the demo Meta profile', () => {
    expect(getActiveProfile('meta').token_ref).toBe('demo');
    expect(getActiveProfile('threads').token_ref).toBe('demo:threads');
    expect(canLoadDemo()).toBe(true);
  });

  it('extendDemoDay rolls every platform forward with its own metrics', () => {
    const fb = listAccounts({ platforms: ['facebook'] })[0];
    const th = listAccounts({ platforms: ['threads'] })[0];
    q.run('DELETE FROM account_snapshots WHERE date = (SELECT MAX(date) FROM account_snapshots)');
    q.run('DELETE FROM account_insights_daily WHERE date = (SELECT MAX(date) FROM account_insights_daily)');
    extendDemoDay(['17840000', fb.igId, th.igId]);
    const today = q.get('SELECT MAX(date) AS d FROM account_insights_daily').d;
    const metrics = (id) => q.all('SELECT metric FROM account_insights_daily WHERE ig_id = ? AND date = ?', id, today).map((r) => r.metric).sort();
    expect(metrics('17840000')).toEqual(['accounts_engaged', 'profile_views', 'reach', 'views']);
    expect(metrics(fb.igId)).toEqual(['post_engagements', 'profile_views', 'reach', 'views']);
    expect(metrics(th.igId)).toEqual(['likes', 'link_clicks', 'quotes', 'replies', 'reposts', 'views']);
    expect(latestFollowers(th.igId)).toBeGreaterThan(0);
  });

  it('demo sync labels accounts per platform and runs stories only for Instagram', async () => {
    const accounts = [...listAccounts({ platforms: ['instagram'] }).slice(0, 1), ...listAccounts({ platforms: ['facebook'] }).slice(0, 1), ...listAccounts({ platforms: ['threads'] }).slice(0, 1)];
    const steps = [];
    await runDemoSync({ scope: 'full', accounts, storyAccounts: accounts.slice(0, 1), adAccounts: [], competitors: [], signal: new AbortController().signal, onStep: (s) => steps.push(s) });
    const labels = new Set(steps.map((s) => `${s.phase}:${s.label}`));
    expect(labels.has(`accounts:${accounts[0].username}`)).toBe(true);
    expect(labels.has(`accounts:${accounts[1].username} (FB)`)).toBe(true);
    expect(labels.has(`accounts:${accounts[2].username} (Threads)`)).toBe(true);
    expect(steps.filter((s) => s.phase === 'stories').map((s) => s.label)).toEqual([`${accounts[0].username} (story)`, `${accounts[0].username} (story)`]);
    expect(steps.at(-1).done).toBe(4);
  });
});
