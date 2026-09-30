/**
 * YouTube through the real orchestrator + generic platform job, with a fake Google (tests/fixtures/google.js) next to
 * the fake Instagram Graph API. Two channels, each with its own OAuth profile and token. An expired access token whose
 * refresh token was revoked (channel A) must only affect channel A: token:warning { platform: 'google', profileId,
 * accountId }, invalidAuth 'google:<id>'; channel B and the Meta jobs complete.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeFetch } from './fixtures/fakeFetch.js';
import { instagramGraph } from './fixtures/graph/instagram.js';
import { googleApis, demoChannel } from './fixtures/google.js';

process.env.METADASH_GRAPH_DELAY_MS = '0';
process.env.METADASH_GOOGLE_BACKOFF_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-youtube-sync-'));
const NOW = Date.now();
const DAY = 86_400_000;
const CLIENT_ID = 'sync-client.apps.googleusercontent.com';

const google = googleApis({ now: NOW, clientId: CLIENT_ID, channels: [demoChannel('UCaaa', { now: NOW }), demoChannel('UCbbb', { now: NOW, subscribers: 777 })] });
const fake = createFakeFetch({ meta: [instagramGraph({ now: NOW })], google: [google] });
const hosts = [];

let m;
let ids;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
    hosts.push({ host: url.host, path: url.pathname, auth: init?.headers?.Authorization ?? null, query: url.searchParams });
    return fake(input, init);
  }));
  const { openDb } = await import('../src/main/db/index.js');
  openDb(path.join(dir, 'data.db'));
  const store = await import('../src/main/config/store.js');
  m = {
    store,
    profiles: await import('../src/main/db/queries/profiles.js'),
    accounts: await import('../src/main/db/queries/accounts.js'),
    media: await import('../src/main/db/queries/media.js'),
    sync: await import('../src/main/db/queries/sync.js'),
    orch: await import('../src/main/sync/orchestrator.js'),
    progress: await import('../src/main/sync/progress.js'),
    registry: await import('../src/main/providers/index.js'),
    youtube: (await import('../src/main/providers/youtube/index.js')).default,
    conn: await import('../src/main/providers/youtube/connection.js'),
    quota: await import('../src/main/providers/youtube/quota.js'),
    platformInfo: await import('../src/main/providers/platformInfo.js'),
  };
  m.registry.__setProviderForTests('youtube', { ...m.youtube, enabled: true });
  m.conn.saveClient({ clientId: CLIENT_ID, clientSecret: 'GOCSPX-integration-secret' });

  const metaId = m.profiles.upsertProfile({ label: 'Meta', appId: '123', tokenRef: store.storeToken('profile:123', 'LONG_TOKEN'), tokenExpiresAt: NOW + 30 * DAY });
  m.accounts.upsertAccount({ igId: 'ig1', profileId: metaId, username: 'brand_one' });
  const channel = (id, tokenExpiresAt) => {
    const profileId = m.profiles.upsertExternalProfile({
      platform: 'google', externalId: id, label: id, appId: CLIENT_ID, tokenRef: store.storeToken(`google:${id}`, `at-${id}-0`),
      tokenExpiresAt, refreshRef: store.storeToken(`google-refresh:${id}`, `rt-${id}`), scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    });
    m.accounts.upsertAccount({ igId: `yt-${id}`, platform: 'youtube', externalId: id, profileId, username: id });
    return profileId;
  };
  ids = { a: channel('UCaaa', NOW - 60_000), b: channel('UCbbb', NOW + 50 * 60_000) };
}, 120_000);
afterAll(async () => {
  m.registry.__setProviderForTests('youtube', undefined);
  const { closeDb } = await import('../src/main/db/index.js');
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const runAndWait = async (params) => {
  const done = new Promise((resolve) => m.progress.progressBus.once('sync:done', resolve));
  await m.orch.runSync(params);
  return done;
};

describe('YouTube sync (real provider, fake Google)', () => {
  it('lists YouTube as an enabled, connected multi-profile platform', () => {
    const row = m.platformInfo.listPlatformInfo().find((p) => p.platform === 'youtube');
    expect(row).toMatchObject({ enabled: true, auth: 'google', connected: true, multiProfile: true, profiles: 2, keyPrefix: 'yt-' });
  });

  it('syncs two channels with separate tokens (A refreshed on expiry) next to Instagram', { timeout: 60_000 }, async () => {
    hosts.length = 0;
    const d = await runAndWait({ scope: 'organic' });
    expect(d).toMatchObject({ tokenInvalid: false, invalidAuth: [] });
    expect(m.sync.recentErrors(50).filter((e) => e.platform === 'youtube')).toEqual([]);

    // A's token had expired → one refresh; B used its stored token.
    const refreshes = google.state.tokenRequests.filter((r) => r.grant_type === 'refresh_token');
    expect(refreshes.map((r) => r.refresh_token)).toEqual(['rt-UCaaa']);
    const ytCalls = hosts.filter((h) => h.host === 'www.googleapis.com' || h.host === 'youtubeanalytics.googleapis.com');
    const tokensFor = (id) => new Set(ytCalls.filter((h) => String(h.auth).includes(id)).map((h) => h.auth));
    expect(tokensFor('UCaaa')).toEqual(new Set(['Bearer at-UCaaa-1']));
    expect(tokensFor('UCbbb')).toEqual(new Set(['Bearer at-UCbbb-0']));
    expect(ytCalls.every((h) => h.query.get('access_token') == null)).toBe(true);
    expect(hosts.filter((h) => h.host === 'graph.facebook.com').length).toBeGreaterThan(0);

    expect(m.accounts.getAccount('yt-UCbbb')).toMatchObject({ platform: 'youtube', username: 'ucbbb', name: 'Channel UCbbb', followers: 777, lastSyncedAt: expect.any(Number) });
    expect(m.accounts.getAccount('ig1').lastSyncedAt).toBeGreaterThan(NOW - 1000);

    const posts = m.media.listMedia({ igIds: ['yt-UCaaa'] });
    expect(posts.map((p) => [p.mediaId, p.mediaProductType]).sort()).toEqual([['yt-UCaaa-l1', 'YT_LIVE'], ['yt-UCaaa-s1', 'YT_SHORT'], ['yt-UCaaa-v1', 'YT_VIDEO']]);
    const v1 = m.media.getMedia('yt-UCaaa-v1');
    expect(v1).toMatchObject({ platform: 'youtube', views: 20000, likes: 900, comments: 80, shares: 17, watchTimeMin: 30000, avgViewDurationS: 95, avgViewPct: 41.5, durationS: 723 });
    expect(v1.reach).toBeNull();

    const { q } = await import('../src/main/db/index.js');
    const metrics = q.all("SELECT DISTINCT metric FROM account_insights_daily WHERE ig_id = 'yt-UCaaa'").map((r) => r.metric).sort();
    expect(metrics).toEqual(['avg_view_duration_s', 'comments', 'follower_count', 'likes', 'shares', 'unfollows', 'views', 'watch_time_min']);
    expect(q.get("SELECT COUNT(*) AS c FROM account_demographics WHERE ig_id = 'yt-UCaaa' AND dimension = 'gender_age'").c).toBe(3);

    // Quota ledger: channel + playlist + videos (+ insights batch videos.list) per channel, no search.list.
    const used = m.quota.quotaState(m.quota.quotaKeyFor(CLIENT_ID)).used;
    expect(used).toBeGreaterThanOrEqual(8);
    expect(used).toBeLessThan(20);
    expect(hosts.some((h) => h.path.endsWith('/search'))).toBe(false);
  });

  it('an expired, revoked channel only fails itself; channel B and Meta complete', { timeout: 60_000 }, async () => {
    const warnings = [];
    const onWarn = (w) => warnings.push(w);
    m.progress.progressBus.on('token:warning', onWarn);
    google.state.revoked.add('rt-UCaaa');
    const pa = m.profiles.getProfileById(ids.a);
    m.profiles.updateProfileToken(ids.a, pa.token_ref, Date.now() - 1000);
    const bBefore = m.accounts.getAccount('yt-UCbbb').lastSyncedAt;
    try {
      const d = await runAndWait({ scope: 'organic' });
      expect(d.status).toBe('partial');
      expect(d.tokenInvalid).toBe(false);
      expect(d.invalidAuth).toEqual([`google:${ids.a}`]);
      expect(warnings).toEqual([expect.objectContaining({ platform: 'google', code: 190, profileId: ids.a, accountId: 'yt-UCaaa' })]);
      expect(m.accounts.getAccount('yt-UCbbb').lastSyncedAt).toBeGreaterThanOrEqual(bBefore);
      expect(m.accounts.getAccount('ig1').lastSyncedAt).toBeGreaterThan(NOW - 1000);
      expect(m.sync.recentErrors(50).filter((e) => e.platform === 'youtube').map((e) => e.ig_id ?? e.igId)).toEqual(['yt-UCaaa']);
    } finally {
      m.progress.progressBus.off('token:warning', onWarn);
      google.state.revoked.delete('rt-UCaaa');
    }
  });

  it('a quota-exhausted project is a soft per-channel error; Meta still syncs', { timeout: 60_000 }, async () => {
    const key = m.quota.quotaKeyFor(CLIENT_ID);
    m.quota.markExhausted(key);
    const before = hosts.length;
    const d = await runAndWait({ scope: 'organic' });
    expect(d.tokenInvalid).toBe(false);
    expect(d.invalidAuth.filter((a) => a.startsWith('google') && a !== `google:${ids.a}`)).toEqual([]);
    const ytErrors = m.sync.recentErrors(50).filter((e) => e.platform === 'youtube' && /quota/i.test(e.message));
    expect(ytErrors.length).toBeGreaterThan(0);
    expect(hosts.slice(before).filter((h) => h.host === 'www.googleapis.com')).toEqual([]);
    expect(m.accounts.getAccount('ig1').lastSyncedAt).toBeGreaterThan(NOW - 1000);
  });
});
