/**
 * Orchestrator + generic platform job with a fake non-Instagram provider (the contract chunks B/C plug into):
 * per-auth token handling, token:warning platform, invalidAuth, platform filters, stories IG-only,
 * metric_resolution drops and inline counts.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeFetch } from './fixtures/fakeFetch.js';
import { instagramGraph } from './fixtures/graph/instagram.js';

process.env.METADASH_GRAPH_DELAY_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-platforms-'));
const NOW = Date.now();
const fake = createFakeFetch({ meta: [instagramGraph({ now: NOW })] });

let m;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (input) => fake(input)));
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
    registry: await import('../src/main/providers/index.js'),
    errors: await import('../src/main/meta/errors.js'),
  };
  const metaId = m.profiles.upsertProfile({ label: 'Meta', appId: '123', tokenRef: store.storeToken('profile:123', 'LONG_TOKEN'), tokenExpiresAt: NOW + 86_400_000 });
  const thId = m.profiles.upsertProfile({ label: 'Threads', appId: '777', tokenRef: store.storeToken('threads:777', 'TH_TOKEN'), platform: 'threads' });
  m.accounts.upsertAccount({ igId: 'ig1', profileId: metaId, username: 'brand_one' });
  m.accounts.upsertAccount({ igId: 'th-42', platform: 'threads', externalId: '42', profileId: thId, username: 'thready' });
});
afterEach(() => m.registry.__setProviderForTests('threads', undefined));
afterAll(async () => { const { closeDb } = await import('../src/main/db/index.js'); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

function fakeThreads(overrides = {}) {
  const seen = { tokens: [] };
  const provider = {
    platform: 'threads', enabled: true, auth: 'threads', concurrency: 1, labelSuffix: ' (Threads)', primaryMetric: 'views',
    capabilities: { reach: false, saveRate: false, stories: false, demographics: false, competitors: false, comments: false, ads: false },
    client: { delay: async () => {} },
    dailyWindow: { windowDays: 30, maxLookbackDays: 30, initialDays: 2 },
    accountKey: (id) => `th-${id}`,
    async fetchProfile(ctx, account) { seen.tokens.push(ctx.tokenFor('threads')); expect(account.externalId).toBe('42'); return { username: 'thready', followers: 200 }; },
    async fetchPosts() {
      return [{ mediaId: 'th-1', externalId: '1', mediaType: 'TEXT_POST', mediaProductType: 'THREADS', caption: 'hi #t', timestamp: new Date(NOW - 3_600_000).toISOString(), inline: { likes: 1, shares: 9 } }];
    },
    async fetchPostInsights(ctx, post) {
      expect(post.externalId).toBe('1');
      return { values: { views: 500, likes: 5, comments: 2, reposts: 3, quotes: 1 }, dropped: [{ metric: 'clicks', message: 'unsupported' }] };
    },
    async fetchDailyInsights() { return { series: { views: [{ date: '2026-09-01', value: 70 }] }, dropped: [] }; },
    ...overrides,
  };
  return { provider, seen };
}

const runAndWait = async (params) => {
  const done = new Promise((resolve) => m.progress.progressBus.once('sync:done', resolve));
  await m.orch.runSync(params);
  return done;
};

describe('multi-platform orchestrator', () => {
  it('syncs a non-Instagram account through the generic job with its own token', { timeout: 30_000 }, async () => {
    const { provider, seen } = fakeThreads();
    m.registry.__setProviderForTests('threads', provider);
    const labels = [];
    const onProgress = (p) => labels.push(p.currentAccount);
    m.progress.progressBus.on('sync:progress', onProgress);
    const d = await runAndWait({ scope: 'organic', platforms: ['threads'] });
    m.progress.progressBus.off('sync:progress', onProgress);
    expect(d).toMatchObject({ status: 'partial', tokenInvalid: false, invalidAuth: [] }); // 'partial' because of the logged metric drop
    expect(seen.tokens).toEqual(['TH_TOKEN']);
    expect(labels).toContain('thready (Threads)');
    expect(labels).not.toContain('brand_one');
    const post = m.media.getMedia('th-1');
    expect(post).toMatchObject({ platform: 'threads', externalId: '1', views: 500, likes: 5, shares: 9, reposts: 3, quotes: 1 });
    expect(post.engagementRate).toBeCloseTo(((5 + 2 + 9 + 3 + 1) / 200) * 100, 5);
    expect(m.accounts.insightSeries('th-42', '2026-09-01', '2026-09-01', ['views'])[0].views).toBe(70);
    expect(m.sync.getMetricResolution('threads', 'media', 'clicks')).toMatchObject({ status: 'unsupported' });
    expect(m.sync.listDisabledMetrics().map((x) => x.platform)).toEqual(['threads']); // nothing written to the IG table
    expect(m.accounts.getAccount('th-42')).toMatchObject({ platform: 'threads', externalId: '42', lastSyncedAt: expect.any(Number) });
  });

  it('a Threads token error warns with platform threads, skips Threads only and leaves Meta jobs running', { timeout: 60_000 }, async () => {
    const { provider } = fakeThreads({
      async fetchProfile() { throw new m.errors.MetaError({ code: 190, message: 'Session expired', source: 'threads' }); },
    });
    m.registry.__setProviderForTests('threads', provider);
    const warned = new Promise((resolve) => m.progress.progressBus.once('token:warning', resolve));
    const d = await runAndWait({ scope: 'organic' });
    const w = await warned;
    expect(w).toMatchObject({ platform: 'threads', code: 190 });
    expect(d).toMatchObject({ status: 'partial', tokenInvalid: false, invalidAuth: ['threads'] });
    expect(m.accounts.getAccount('ig1').lastSyncedAt).toBeGreaterThan(NOW - 1000);
    const err = m.sync.recentErrors(20).find((e) => e.code === 190);
    expect(err).toMatchObject({ igId: 'th-42', platform: 'threads' });
    expect(m.orch.syncStatus().invalidAuth).toEqual(['threads']);
  });

  it('stories scope only runs Instagram accounts; disabled platforms are skipped entirely', { timeout: 30_000 }, async () => {
    const d = await runAndWait({ scope: 'stories' });
    expect(d.status).toBe('ok');
    const run = m.sync.listRuns(1)[0];
    expect(run.accountsTotal).toBe(1);
    m.registry.__setProviderForTests('threads', null); // a disabled platform (restored by afterEach)
    const organic = await runAndWait({ scope: 'organic', platforms: ['threads'] });
    expect(m.sync.listRuns(1)[0].accountsTotal).toBe(0);
    expect(organic.status).toBe('ok');
  });
});
