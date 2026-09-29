/**
 * Instagram + Facebook Pages through the real orchestrator against fake Graph APIs (fakeFetch fixtures):
 * FB discovery via the setup IPC handler, opt-in tracking, page tokens per run, a page without a token skipped
 * (others continue, no token warning), daily insights fallback + metric_resolution, posts/insights → media_latest.
 * The Instagram assertions mirror sync.integration.test.js (unchanged behaviour next to a Facebook Page).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeFetch } from './fixtures/fakeFetch.js';
import { instagramGraph } from './fixtures/graph/instagram.js';
import { facebookGraph, PAGE_TOKEN } from './fixtures/graph/facebook.js';

process.env.METADASH_GRAPH_DELAY_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-multi-'));
const NOW = Date.now();
const fake = createFakeFetch({ meta: [facebookGraph({ now: NOW }), instagramGraph({ now: NOW })] });
const fetchSpy = vi.fn(async (input) => fake(input));

let m;
const handlers = new Map();
beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy);
  const { openDb } = await import('../src/main/db/index.js');
  openDb(path.join(dir, 'data.db'));
  const store = await import('../src/main/config/store.js');
  m = {
    profiles: await import('../src/main/db/queries/profiles.js'),
    accounts: await import('../src/main/db/queries/accounts.js'),
    media: await import('../src/main/db/queries/media.js'),
    sync: await import('../src/main/db/queries/sync.js'),
    orch: await import('../src/main/sync/orchestrator.js'),
    progress: await import('../src/main/sync/progress.js'),
    ipc: await import('../src/main/ipc/setup.facebook.handlers.js'),
  };
  const id = m.profiles.upsertProfile({ label: 'Meta', appId: '123', tokenRef: store.storeToken('profile:123', 'LONG_TOKEN'), tokenExpiresAt: NOW + 86_400_000 });
  m.accounts.upsertAccount({ igId: 'ig1', profileId: id, username: 'brand_one', pageId: 'p1' });
  m.ipc.registerFacebookSetupHandlers((ch, fn) => handlers.set(ch, fn));
});
afterAll(async () => { const { closeDb } = await import('../src/main/db/index.js'); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

const runAndWait = async (params) => {
  const done = new Promise((resolve) => m.progress.progressBus.once('sync:done', resolve));
  await m.orch.runSync(params);
  return done;
};

describe('Instagram + Facebook Pages sync', () => {
  it('discovers pages untracked; tracking is opt-in', async () => {
    const out = await handlers.get('setup:facebook:discover')();
    expect(out.items.map((i) => i.accountId).sort()).toEqual(['fb-p1', 'fb-p2', 'fb-p3']);
    const before = await runAndWait({ scope: 'organic', platforms: ['facebook'] });
    expect(before.status).toBe('ok');
    expect(m.sync.listRuns(1)[0].accountsTotal).toBe(0);
    expect(handlers.get('setup:facebook:saveTracked')({ accountIds: ['fb-p1', 'fb-p2'] })).toEqual({ tracked: 2 });
  });

  it('syncs Instagram and Facebook in one run; the page without a token is skipped with a logged error', { timeout: 60_000 }, async () => {
    const warnings = [];
    const onWarn = (w) => warnings.push(w);
    const labels = [];
    const onProgress = (p) => labels.push(p.currentAccount);
    m.progress.progressBus.on('token:warning', onWarn);
    m.progress.progressBus.on('sync:progress', onProgress);
    const done = await runAndWait({ scope: 'organic' });
    m.progress.progressBus.off('token:warning', onWarn);
    m.progress.progressBus.off('sync:progress', onProgress);

    expect(done).toMatchObject({ status: 'partial', tokenInvalid: false, invalidAuth: [] });
    expect(warnings).toEqual([]);
    expect(labels).toEqual(expect.arrayContaining(['brand_one', 'pageone (FB)']));

    // Instagram unchanged
    const ig = m.media.listMedia({ igIds: ['ig1'] });
    expect(ig.map((x) => x.mediaId).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(ig.find((x) => x.mediaId === 'm1')).toMatchObject({ platform: 'instagram', reach: 1000, views: 1800 });
    expect(m.accounts.getAccount('ig1')).toMatchObject({ platform: 'instagram', username: 'brand_one', lastSyncedAt: expect.any(Number) });

    // Facebook page p1
    const page = m.accounts.getAccount('fb-p1');
    expect(page).toMatchObject({ platform: 'facebook', externalId: 'p1', username: 'pageone', name: 'Page 1', biography: 'About page one', followers: 5100, linkedAccountId: 'ig1', lastSyncedAt: expect.any(Number) });
    const posts = m.media.listMedia({ igIds: ['fb-p1'] });
    expect(Object.fromEntries(posts.map((x) => [x.mediaId, x.mediaType]))).toEqual({ p1_101: 'IMAGE', p1_102: 'VIDEO', p1_103: 'CAROUSEL_ALBUM', p1_104: 'LINK', p1_105: 'TEXT' });
    const p101 = posts.find((x) => x.mediaId === 'p1_101');
    expect(p101).toMatchObject({ platform: 'facebook', externalId: 'p1_101', reach: 700, views: 900, likes: 40, comments: 6, shares: 4, clicks: 15, saved: null, hashtagCount: 1 });
    expect(p101.engagementRate).toBeCloseTo(((40 + 6 + 4) / 5100) * 100, 5);
    expect(posts.find((x) => x.mediaId === 'p1_105')).toMatchObject({ likes: 40, shares: 0 });

    const from = new Date(NOW - 3 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(NOW).toISOString().slice(0, 10);
    const series = m.accounts.insightSeries('fb-p1', from, to, ['views', 'reach', 'post_engagements', 'follower_count', 'followers_total', 'profile_views']);
    expect(series.some((r) => r.views === 120)).toBe(true);
    expect(series.some((r) => r.followers_total === 5100)).toBe(true);
    expect(series.every((r) => r.profile_views == null)).toBe(true);
    expect(m.sync.getMetricResolution('facebook', 'account', 'views')).toMatchObject({ status: 'ok', apiName: 'page_media_view' });
    expect(m.sync.getMetricResolution('facebook', 'account', 'profile_views')).toMatchObject({ status: 'unsupported' });
    expect(m.sync.listDisabledMetrics().filter((d) => d.platform === 'facebook').map((d) => d.metric).sort()).toEqual(['profile_views', 'unfollows']);
    expect(m.sync.listDisabledMetrics().filter((d) => d.platform === 'instagram').map((d) => d.metric)).not.toContain('profile_views');

    // every Page endpoint used the page token (the fixture rejects anything else); the token lookup used the user token
    const urls = fetchSpy.mock.calls.map(([u]) => new URL(String(u)));
    const pageCalls = urls.filter((u) => /^\/v\d+\.\d+\/p1(_\d+)?(\/|$)/.test(u.pathname) && !(u.searchParams.get('fields') ?? '').includes('access_token'));
    expect(pageCalls.length).toBeGreaterThan(5);
    expect(pageCalls.every((u) => u.searchParams.get('access_token') === PAGE_TOKEN)).toBe(true);

    // page p2: no page token → skipped with a permission-class error, never synced
    expect(m.accounts.getAccount('fb-p2').lastSyncedAt).toBeNull();
    const err = m.sync.recentErrors(50).find((e) => e.igId === 'fb-p2');
    expect(err).toMatchObject({ platform: 'facebook', code: 10 });
    expect(err.message).toContain('Page w/o IG');
  });

  it('a second run requests only resolved metric names and restricts to a platform', { timeout: 60_000 }, async () => {
    fake.calls.length = 0;
    const done = await runAndWait({ scope: 'organic', platforms: ['facebook'] });
    expect(done.tokenInvalid).toBe(false);
    const insightCalls = fake.calls.filter((c) => c.startsWith('/p1/insights'));
    expect(insightCalls.length).toBeGreaterThan(0);
    expect(insightCalls.every((c) => !/page_views_total|page_daily_unfollows_unique/.test(c))).toBe(true);
    expect(fake.calls.some((c) => c.startsWith('/ig1'))).toBe(false);
  });
});
