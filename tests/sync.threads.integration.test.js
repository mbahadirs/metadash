/**
 * Threads through the real orchestrator + generic platform job, with the real Threads provider and a fake
 * graph.threads.net next to the fake Instagram Graph API. A Threads token error (190) must only affect Threads:
 * token:warning { platform: 'threads' }, status 'partial', Instagram jobs complete.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeFetch } from './fixtures/fakeFetch.js';
import { instagramGraph } from './fixtures/graph/instagram.js';
import { threadsGraph } from './fixtures/graph/threads.js';

process.env.METADASH_GRAPH_DELAY_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-threads-sync-'));
const NOW = Date.now();

let threadsRoutes = [threadsGraph({ now: NOW })];
const fetchImpl = async (input) => {
  const fake = createFakeFetch({ meta: [instagramGraph({ now: NOW })], threads: threadsRoutes });
  return fake(input);
};
const hosts = [];

let m;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
    hosts.push({ host: url.host, path: url.pathname, token: url.searchParams.get('access_token') });
    return fetchImpl(input);
  }));
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
  };
  const metaId = m.profiles.upsertProfile({ label: 'Meta', appId: '123', tokenRef: store.storeToken('profile:123', 'LONG_TOKEN'), tokenExpiresAt: NOW + 30 * 86_400_000 });
  const thId = m.profiles.upsertProfile({ label: 'Threads', appId: '777', tokenRef: store.storeToken('threads:777', 'TH_LONG'), tokenExpiresAt: NOW + 50 * 86_400_000, platform: 'threads', refreshedAt: NOW });
  m.accounts.upsertAccount({ igId: 'ig1', profileId: metaId, username: 'brand_one' });
  m.accounts.upsertAccount({ igId: 'th-42', platform: 'threads', externalId: '42', profileId: thId, username: 'thready' });
});
afterAll(async () => { const { closeDb } = await import('../src/main/db/index.js'); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

const runAndWait = async (params) => {
  const done = new Promise((resolve) => m.progress.progressBus.once('sync:done', resolve));
  await m.orch.runSync(params);
  return done;
};

describe('Threads sync (real provider, fake graph.threads.net)', () => {
  it('uses the real Threads provider', () => {
    expect(m.registry.getProvider('threads')).toMatchObject({ platform: 'threads', enabled: true, auth: 'threads' });
  });

  it('syncs Instagram and Threads side by side', { timeout: 60_000 }, async () => {
    hosts.length = 0;
    const d = await runAndWait({ scope: 'organic' });
    expect(['ok', 'partial']).toContain(d.status);
    expect(d).toMatchObject({ tokenInvalid: false, invalidAuth: [] });

    const threadsCalls = hosts.filter((h) => h.host === 'graph.threads.net');
    expect(threadsCalls.length).toBeGreaterThan(0);
    expect(threadsCalls.every((h) => h.token === 'TH_LONG')).toBe(true);
    expect(hosts.filter((h) => h.host === 'graph.facebook.com').every((h) => h.token !== 'TH_LONG')).toBe(true);
    expect(m.sync.recentErrors(50).filter((e) => e.platform === 'threads')).toEqual([]);

    expect(m.accounts.getAccount('th-42')).toMatchObject({ platform: 'threads', username: 'thready', name: 'Thready', followers: 250, lastSyncedAt: expect.any(Number) });
    expect(m.accounts.getAccount('ig1').lastSyncedAt).toBeGreaterThan(NOW - 1000);

    const posts = m.media.listMedia({ igIds: ['th-42'] });
    expect(posts.map((p) => p.mediaId).sort()).toEqual(['th-9001', 'th-9003']); // REPOST_FACADE skipped
    const t1 = m.media.getMedia('th-9001');
    expect(t1).toMatchObject({ platform: 'threads', externalId: '9001', mediaType: 'TEXT_POST', views: 900, likes: 30, comments: 6, shares: 5, reposts: 4, quotes: 2 });
    expect(t1.engagementRate).toBeCloseTo(((30 + 6 + 5 + 4 + 2) / 250) * 100, 5);

    const since = new Date(NOW - 40 * 86_400_000).toISOString().slice(0, 10);
    const until = new Date(NOW + 86_400_000).toISOString().slice(0, 10);
    const rows = m.accounts.insightSeries('th-42', since, until, ['views', 'likes', 'replies', 'link_clicks']);
    expect(rows.some((r) => r.views === 55)).toBe(true);
    expect(rows.filter((r) => r.likes === 11).length).toBeGreaterThanOrEqual(30);
    expect(rows.some((r) => r.link_clicks === 5)).toBe(true);
    expect(m.accounts.lastDemographicCapture('th-42')).toBeGreaterThan(NOW - 60_000);
  });

  it('a Threads 190 warns for threads only; Instagram completes and the run is partial', { timeout: 60_000 }, async () => {
    threadsRoutes = [threadsGraph({ now: NOW, tokenError: true })];
    const warned = new Promise((resolve) => m.progress.progressBus.once('token:warning', resolve));
    const before = m.accounts.getAccount('ig1').lastSyncedAt;
    const d = await runAndWait({ scope: 'organic' });
    expect(await warned).toMatchObject({ platform: 'threads', code: 190 });
    expect(d).toMatchObject({ status: 'partial', tokenInvalid: false, invalidAuth: ['threads'] });
    expect(m.accounts.getAccount('ig1').lastSyncedAt).toBeGreaterThanOrEqual(before);
    const err = m.sync.recentErrors(20).find((e) => e.code === 190);
    expect(err).toMatchObject({ igId: 'th-42', platform: 'threads' });
    threadsRoutes = [threadsGraph({ now: NOW })];
  });
});
