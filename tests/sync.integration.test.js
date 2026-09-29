/**
 * End-to-end sync against a fake Graph API: exercises the real orchestrator, jobs, metric adaptor,
 * error handling (unsupported metric, total_value-only metric, paging) and DB writes — no demo profile.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeFetch } from './fixtures/fakeFetch.js';
import { instagramGraph } from './fixtures/graph/instagram.js';

process.env.METADASH_GRAPH_DELAY_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-sync-'));
const NOW = Date.now();

const fake = createFakeFetch({ meta: [instagramGraph({ now: NOW })] });

let mod;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (input) => fake(input)));
  const { openDb } = await import('../src/main/db/index.js');
  openDb(path.join(dir, 'data.db'));
  const profiles = await import('../src/main/db/queries/profiles.js');
  const store = await import('../src/main/config/store.js');
  const ref = store.storeToken('profile:123', 'LONG_TOKEN');
  profiles.upsertProfile({ label: 'Test', appId: '123', tokenRef: ref, tokenExpiresAt: NOW + 86_400_000 });
  mod = {
    auth: await import('../src/main/meta/auth.js'),
    organic: await import('../src/main/meta/organic.js'),
    accounts: await import('../src/main/db/queries/accounts.js'),
    ads: await import('../src/main/db/queries/ads.js'),
    media: await import('../src/main/db/queries/media.js'),
    stories: await import('../src/main/db/queries/stories.js'),
    sync: await import('../src/main/db/queries/sync.js'),
    orch: await import('../src/main/sync/orchestrator.js'),
    progress: await import('../src/main/sync/progress.js'),
    competitors: await import('../src/main/db/queries/competitors.js'),
  };
});
afterAll(async () => { const { closeDb } = await import('../src/main/db/index.js'); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

describe('real-API pipeline (mocked Graph)', () => {
  it('exchanges and debugs a token', async () => {
    const ex = await mod.auth.exchangeLongLivedToken({ appId: '123', appSecret: 'secret', shortToken: 'short' });
    expect(ex.token).toBe('LONG_TOKEN');
    const h = await mod.auth.debugToken(ex.token);
    expect(h.valid).toBe(true);
    expect(h.missingScopes).toEqual([]);
  });

  it('discovers accounts and ad accounts (pages without IG are reported, not stored)', async () => {
    const pages = await mod.organic.discoverAccounts('LONG_TOKEN');
    // p1 (personal + BM, merged), p2 (no IG), p3 (BM only), ig9 (standalone IG in BM)
    expect(pages).toHaveLength(4);
    expect(pages.filter((p) => p.ig).map((p) => p.ig.igId).sort()).toEqual(['ig1', 'ig3', 'ig9']);
    expect(pages.find((p) => p.pageId === 'p1').sources).toEqual(['me/accounts', 'Ajans BM · owned_pages']);
    expect(pages.find((p) => p.ig?.igId === 'ig9').noPage).toBe(true);
    expect(pages.warnings.map((w) => w.endpoint)).toEqual(['/biz1/client_pages']);
    mod.accounts.upsertAccount({ ...pages[0].ig, profileId: 1, pageId: pages[0].pageId });
    const adsApi = await import('../src/main/meta/ads.js');
    const acts = await adsApi.discoverAdAccounts('LONG_TOKEN');
    expect(acts[0]).toMatchObject({ actId: 'act_1', currency: 'TRY', status: 'ACTIVE' });
    mod.ads.upsertAdAccount({ actId: 'act_1', profileId: 1, name: 'Ads 1', currency: 'TRY', status: 'ACTIVE', linkedIgId: 'ig1' });
    mod.competitors.addCompetitor({ username: 'rival', igId: 'ig1' });
  });

  it('runs a full sync through the real orchestrator and populates every table', { timeout: 60_000 }, async () => {
    const done = new Promise((resolve) => mod.progress.progressBus.once('sync:done', resolve));
    const { runId, demo } = await mod.orch.runSync({ scope: 'full' });
    expect(demo).toBe(false);
    const result = await done;
    expect(result.runId).toBe(runId);
    expect(['ok', 'partial']).toContain(result.status);

    // media + paging
    const media = mod.media.listMedia({ igIds: ['ig1'] });
    expect(media.map((m) => m.mediaId).sort()).toEqual(['m1', 'm2', 'm3']);
    const m1 = media.find((m) => m.mediaId === 'm1');
    expect(m1.hashtagCount).toBe(1);
    expect(m1.mentionCount).toBe(1);
    expect(m1.emojiCount).toBe(1);
    expect(m1.reach).toBe(1000);
    expect(m1.engagementRate).toBeCloseTo(((50 * 4) / 12050) * 100, 3);

    // unsupported metric dropped only for that request, recorded, sync continued
    const m2 = media.find((m) => m.mediaId === 'm2');
    expect(m2.reach).toBe(1000);
    expect(m2.shares).toBeNull();
    expect(mod.sync.listDisabledMetrics().map((d) => d.metric)).toContain('shares');

    // account daily insights: time-series metrics + total_value-only metrics per day
    const series = mod.accounts.insightSeries('ig1', new Date(NOW - 40 * 86_400_000).toISOString().slice(0, 10), new Date(NOW).toISOString().slice(0, 10), ['reach', 'profile_views', 'accounts_engaged']);
    expect(series.some((d) => d.reach === 420)).toBe(true);
    expect(series.some((d) => d.profile_views === 33)).toBe(true);
    expect(series.some((d) => d.accounts_engaged === 77)).toBe(true);

    // demographics (country dropped as unsupported), snapshot, stories, ads, ad-media link, competitor
    const demog = mod.accounts.latestDemographics('ig1');
    expect(demog.city[0]).toMatchObject({ bucket: 'Istanbul', value: 500 });
    expect(demog.country).toEqual([]);
    expect(mod.accounts.latestFollowers('ig1')).toBe(12050);
    const st = mod.stories.listStories('ig1', 0, NOW + 1);
    expect(st[0]).toMatchObject({ storyId: 's1', views: 320, navExit: 30 });
    expect(st[0].completionRate).toBeCloseTo(1 - 30 / 320, 3);
    const totals = mod.ads.adTotals(['act_1'], '2000-01-01', '2100-01-01');
    expect(totals.spend).toBeCloseTo(100.5);
    expect(totals.results).toBe(3); // purchase preferred over link_click
    expect(totals.postEngagement).toBe(150);
    expect(totals.pageEngagement).toBe(170);
    expect(totals.costPerPostEngagement).toBeCloseTo(100.5 / 150, 3);
    expect(mod.ads.paidForMedia('m1')?.totals.spend).toBeCloseTo(100.5);
    expect(mod.ads.adBreakdown(['act_1'], '2000-01-01', '2100-01-01', 'gender')[0].bucket).toBe('female');
    expect(mod.competitors.listCompetitors('ig1')[0].followers).toBeNull(); // business discovery stubbed empty → no snapshot values
    expect(mod.accounts.getAccount('ig1').lastSyncedAt).toBeGreaterThan(NOW - 1000);
  });

  it('stops the sync and raises a token warning on code 190', { timeout: 30_000 }, async () => {
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: 190, message: 'Error validating access token' } }), { status: 400 }));
    const warned = new Promise((resolve) => mod.progress.progressBus.once('token:warning', resolve));
    const done = new Promise((resolve) => mod.progress.progressBus.once('sync:done', resolve));
    await mod.orch.runSync({ scope: 'organic' });
    const [w, d] = await Promise.all([warned, done]);
    expect(w.code).toBe(190);
    expect(d.tokenInvalid).toBe(true);
    expect(d.status).toBe('failed');
  });
});
