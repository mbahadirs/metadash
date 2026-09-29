/**
 * Threads provider (chunk C): OAuth/token exchange + refresh, refresh window, mappers, since clamp, per-day totals,
 * demographics calls, post insights (replies → comments) and the setup IPC handlers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeFetch, json, graphError } from './fixtures/fakeFetch.js';
import { threadsGraph } from './fixtures/graph/threads.js';

process.env.METADASH_GRAPH_DELAY_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-threads-'));
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const DAY = 86_400_000;
const APP_ID = '5550001';
const SECRET = 'threads-secret-0123456789';

let requests = [];
let routes = [threadsGraph({ now: NOW })];
const fetchImpl = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url ?? input.toString();
  requests.push({ method: init.method ?? 'GET', url: new URL(url) });
  return createFakeFetch({ threads: routes })(url);
};

let m;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  const { openDb } = await import('../src/main/db/index.js');
  openDb(path.join(dir, 'data.db'));
  m = {
    client: await import('../src/main/providers/threads/client.js'),
    auth: await import('../src/main/providers/threads/auth.js'),
    api: await import('../src/main/providers/threads/api.js'),
    mappers: await import('../src/main/providers/threads/mappers.js'),
    conn: await import('../src/main/providers/threads/connection.js'),
    provider: (await import('../src/main/providers/threads/index.js')).default,
    ipc: await import('../src/main/ipc/setup.threads.handlers.js'),
    profiles: await import('../src/main/db/queries/profiles.js'),
    accounts: await import('../src/main/db/queries/accounts.js'),
    sync: await import('../src/main/db/queries/sync.js'),
    store: await import('../src/main/config/store.js'),
    progress: await import('../src/main/sync/progress.js'),
    errors: await import('../src/main/meta/errors.js'),
    registry: await import('../src/main/providers/index.js'),
  };
});
afterAll(async () => { const { closeDb } = await import('../src/main/db/index.js'); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });
beforeEach(() => { requests = []; routes = [threadsGraph({ now: NOW })]; });

const find = (p) => requests.filter((r) => r.url.pathname.replace(/^\/v\d+\.\d+/, '') === p);
const params = (r) => Object.fromEntries(r.url.searchParams);

describe('threads client + registry', () => {
  it('uses its own host constant, limiter and error source', async () => {
    expect(m.client.THREADS_BASE).toBe('https://graph.threads.net/v1.0');
    expect(m.client.threadsClient.name).toBe('threads');
    expect(m.client.threadsLimiter).not.toBe((await import('../src/main/meta/rateLimiter.js')).rateLimiter);
    routes = [() => graphError(190, 'Session has expired')];
    const e = await m.client.threadsClient.get('/me', {}, { token: 't' }).catch((x) => x);
    expect(e).toMatchObject({ code: 190, source: 'threads', isTokenError: true });
    expect(m.errors.toUserError(e).message).toMatch(/Threads/);
  });

  it('is an enabled provider with the Threads contract', () => {
    const p = m.registry.getProvider('threads');
    expect(p).toBe(m.provider);
    expect(p).toMatchObject({ platform: 'threads', enabled: true, auth: 'threads', concurrency: 1, primaryMetric: 'views', labelSuffix: ' (Threads)' });
    expect(p.dailyWindow.minSinceUnix).toBe(1712991600);
    expect(p.accountKey('42')).toBe('th-42');
    expect(p.skipInsights({ mediaType: 'REPOST_FACADE', mediaProductType: 'THREADS' })).toBe(true);
    expect(p.skipInsights({ mediaType: 'TEXT_POST', mediaProductType: 'THREADS' })).toBe(false);
  });
});

describe('auth helpers', () => {
  it('builds the authorization window URL', () => {
    const u = new URL(m.auth.buildAuthUrl({ appId: APP_ID, redirectUri: 'https://localhost/' }));
    expect(u.origin + u.pathname).toBe('https://threads.com/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: APP_ID, redirect_uri: 'https://localhost/', scope: 'threads_basic,threads_manage_insights', response_type: 'code' });
  });

  it('extracts the code from a bare code, code#_ or the full redirect URL', () => {
    expect(m.auth.extractCode(' AQBx#_ ')).toBe('AQBx');
    expect(m.auth.extractCode('https://localhost/?code=AQBy#_')).toBe('AQBy');
    expect(m.auth.extractCode('https://localhost/?error=denied')).toBeNull();
    expect(m.auth.extractCode('')).toBeNull();
  });

  it('refresh rule: >24h since refresh and <20 days to expiry, never after expiry', () => {
    const rule = (refreshedAgoH, expiresInD) => m.auth.shouldAutoRefresh({ refreshed_at: NOW - refreshedAgoH * 3_600_000, token_expires_at: expiresInD == null ? null : NOW + expiresInD * DAY }, NOW);
    expect(rule(25, 19)).toBe(true);
    expect(rule(23, 5)).toBe(false); // too young
    expect(rule(25, 21)).toBe(false); // plenty of time left
    expect(rule(48, -1)).toBe(false); // expired: cannot be refreshed
    expect(rule(25, null)).toBe(true); // unknown expiry
    expect(m.auth.shouldAutoRefresh({ refreshed_at: null, created_at: NOW - 30 * DAY, token_expires_at: NOW + 10 * DAY }, NOW)).toBe(true);
    expect(m.auth.shouldAutoRefresh(null, NOW)).toBe(false);
    expect(m.auth.canRefresh({ refreshed_at: NOW - 3_600_000, token_expires_at: NOW + DAY }, NOW)).toBe(false);
  });
});

describe('mappers', () => {
  it('maps posts and drops reposts', () => {
    expect(m.mappers.mapPost({ id: '1', media_type: 'REPOST_FACADE' })).toBeNull();
    expect(m.mappers.mapPost({ id: '7', media_type: 'IMAGE', media_url: 'https://cdn/i.jpg', text: 'x', permalink: 'p', timestamp: '2026-09-01T10:00:00+0000' }))
      .toEqual({ mediaId: 'th-7', externalId: '7', mediaType: 'IMAGE', mediaProductType: 'THREADS', caption: 'x', permalink: 'p', thumbnailUrl: 'https://cdn/i.jpg', timestamp: '2026-09-01T10:00:00+0000' });
    expect(m.mappers.mapPost({ id: '8', media_type: 'CAROUSEL_ALBUM', children: { data: [{ media_url: 'https://cdn/c.jpg' }] } })).toMatchObject({ caption: '', thumbnailUrl: 'https://cdn/c.jpg' });
    expect(m.mappers.mapPost({ id: '9', media_type: 'TEXT_POST' }).thumbnailUrl).toBeNull();
  });

  it('reads lifetime, total_value and link_total_values rows', () => {
    expect(m.mappers.insightValues({ data: [
      { name: 'views', values: [{ value: 5 }] },
      { name: 'likes', total_value: { value: 3 } },
      { name: 'clicks', link_total_values: [{ value: 2 }, { value: 4 }] },
      { name: 'empty', values: [] },
    ] })).toEqual({ views: 5, likes: 3, clicks: 6 });
  });

  it('maps profile and demographics', () => {
    expect(m.mappers.mapProfile({ id: '1', username: 'u', threads_profile_picture_url: 'pic', threads_biography: 'b' }, 150)).toEqual({ username: 'u', name: null, profilePicUrl: 'pic', biography: 'b', followers: 150 });
    expect(m.mappers.mapProfile({ id: '1', username: 'u' })).not.toHaveProperty('followers');
    expect(m.mappers.mapDemographics({ data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ results: [{ dimension_values: ['TR'], value: 9 }, { dimension_values: [], value: 1 }] }] } }] }))
      .toEqual([{ bucket: 'TR', value: 9 }]);
  });
});

describe('api', () => {
  it('fetchThreads pages, skips REPOST_FACADE and passes since/limit', async () => {
    const posts = await m.api.fetchThreads('42', 'TOK', { sinceUnix: 1_780_000_000 });
    expect(posts.map((p) => p.mediaId)).toEqual(['th-9001', 'th-9003']);
    const first = params(find('/42/threads')[0]);
    expect(first).toMatchObject({ since: '1780000000', limit: '50', access_token: 'TOK' });
    expect(first.fields).toContain('media_type');
  });

  it('post insights map replies → comments; a rejected metric is dropped, an unrelated 100 is rethrown', async () => {
    const { values, dropped } = await m.api.fetchPostInsights('9001', 'TOK');
    expect(values).toEqual({ views: 900, likes: 30, comments: 6, reposts: 4, quotes: 2, shares: 5 });
    expect(dropped).toEqual([]);
    expect(params(find('/9001/insights')[0]).metric).toBe('views,likes,replies,reposts,quotes,shares');

    routes = [({ path: p, query: q }) => (p === '/9001/insights' && q.get('metric').includes('shares') ? graphError(100, '(#100) metric[5] must be one of the following values: views, likes, replies, reposts, quotes. shares is not valid') : null), threadsGraph({ now: NOW })];
    const r2 = await m.api.fetchPostInsights('9001', 'TOK');
    expect(r2.values).not.toHaveProperty('shares');
    expect(r2.dropped).toEqual([expect.objectContaining({ metric: 'shares' })]);

    routes = [() => graphError(100, 'Unsupported get request. Object with ID does not exist')];
    await expect(m.api.fetchPostInsights('9001', 'TOK')).rejects.toMatchObject({ code: 100 });
  });

  it('identifies the rejected metric in Meta error messages', () => {
    const names = ['views', 'likes', 'shares'];
    expect(m.api.rejectedMetric('(#100) metric[2] must be one of the following values: views, likes', names)).toBe('shares');
    expect(m.api.rejectedMetric('(#100) The value must be one of the following values: views, likes', names)).toBe('shares');
    expect(m.api.rejectedMetric('(#100) likes is not supported', names)).toBe('likes');
    expect(m.api.rejectedMetric('Object with ID "x" does not exist', names)).toBeNull();
  });

  it('skips metrics already marked unsupported in metric_resolution', async () => {
    m.sync.markUnsupported('threads', 'media', 'shares', 'gone');
    await m.api.fetchPostInsights('9001', 'TOK');
    expect(params(find('/9001/insights')[0]).metric).toBe('views,likes,replies,reposts,quotes');
    m.sync.enableMetric('shares', { platform: 'threads', scope: 'media' });
  });

  it('daily insights: views series + per-day totals, since clamped and UTC-aligned', async () => {
    const until = 1712991600 + 2 * 86_400 + 3600;
    const { series, dropped } = await m.api.fetchDailyInsights('42', 'TOK', { sinceUnix: 1_600_000_000, untilUnix: until });
    expect(dropped).toEqual([]);
    const calls = find('/42/threads_insights').map(params);
    expect(calls[0]).toMatchObject({ metric: 'views', since: '1712991600', until: String(until) });
    const totals = calls.slice(1);
    expect(totals.map((c) => c.metric)).toEqual(Array(3).fill('likes,replies,reposts,quotes,clicks'));
    expect(totals.map((c) => Number(c.since))).toEqual([1712991600, 1712991600 + 86_400, 1712991600 + 2 * 86_400]);
    expect(Number(totals[2].until)).toBe(until);
    expect(series.views).toHaveLength(2);
    expect(series.likes).toHaveLength(3);
    expect(series.link_clicks[0]).toEqual({ date: '2024-04-13', value: 5 });
    expect(series.replies[0].value).toBe(3);

    requests = [];
    const aligned = await m.api.fetchDailyInsights('42', 'TOK', { sinceUnix: Date.UTC(2026, 8, 18, 15) / 1000, untilUnix: NOW / 1000 });
    const since = find('/42/threads_insights').map(params).slice(1).map((c) => Number(c.since));
    expect(since).toEqual([Date.UTC(2026, 8, 18) / 1000, Date.UTC(2026, 8, 19) / 1000, Date.UTC(2026, 8, 20) / 1000]);
    expect(aligned.series.likes.map((p) => p.date)).toEqual(['2026-09-18', '2026-09-19', '2026-09-20']);

    requests = [];
    expect(await m.api.fetchDailyInsights('42', 'TOK', { sinceUnix: 1_600_000_000, untilUnix: 1_700_000_000 })).toEqual({ series: {}, dropped: [] });
    expect(requests).toHaveLength(0);
  });

  it('daily insights drop a rejected total metric for the rest of the window', async () => {
    routes = [({ path: p, query: q }) => (p === '/42/threads_insights' && q.get('metric').includes('clicks') ? graphError(100, '(#100) clicks is not supported') : null), threadsGraph({ now: NOW })];
    const { series, dropped } = await m.api.fetchDailyInsights('42', 'TOK', { sinceUnix: NOW / 1000 - 2 * 86_400, untilUnix: NOW / 1000 });
    expect(dropped).toEqual([{ metric: 'link_clicks', message: expect.stringContaining('clicks') }]);
    expect(series.link_clicks).toBeUndefined();
    const metrics = find('/42/threads_insights').map((r) => params(r).metric);
    expect(metrics.filter((x) => x === 'likes,replies,reposts,quotes').length).toBe(3);
  });

  it('demographics: one call per breakdown, tolerant of refusals', async () => {
    const out = await m.api.fetchDemographics('42', 'TOK');
    const calls = find('/42/threads_insights').map(params);
    expect(calls.map((c) => [c.metric, c.breakdown])).toEqual([['follower_demographics', 'age'], ['follower_demographics', 'gender'], ['follower_demographics', 'country'], ['follower_demographics', 'city']]);
    expect(calls.every((c) => !c.since && !c.until)).toBe(true);
    expect(out.dimensions).toEqual({ age: [{ bucket: '25-34', value: 120 }], gender: [{ bucket: 'F', value: 120 }], country: [{ bucket: 'TR', value: 120 }], city: [{ bucket: 'Istanbul, Istanbul', value: 120 }] });

    routes = [threadsGraph({ now: NOW, demographicsError: true })];
    const refused = await m.api.fetchDemographics('42', 'TOK');
    expect(refused.dimensions).toEqual({});
    expect(refused.skipped).toHaveLength(4);

    routes = [threadsGraph({ now: NOW, tokenError: true })];
    await expect(m.api.fetchDemographics('42', 'TOK')).rejects.toMatchObject({ code: 190, source: 'threads' });
  });

  it('provider.fetchDemographics skips profiles under 100 followers', async () => {
    m.accounts.upsertAccount({ igId: 'th-small', platform: 'threads', externalId: 'small', username: 's' });
    m.accounts.insertSnapshot({ igId: 'th-small', date: '2026-09-20', followers: 40 });
    const ctx = { tokenFor: () => 'TOK' };
    expect(await m.provider.fetchDemographics(ctx, { igId: 'th-small', externalId: 'small' })).toEqual({ dimensions: {}, dropped: [] });
    expect(requests).toHaveLength(0);
  });

  it('provider.fetchProfile reads /me and followers_count', async () => {
    const profile = await m.provider.fetchProfile({ tokenFor: () => 'TOK' }, { igId: 'th-42', externalId: '42' });
    expect(profile).toEqual({ username: 'thready', name: 'Thready', profilePicUrl: 'https://cdn/p.jpg', biography: 'bio', followers: 250 });
    expect(params(find('/42/threads_insights')[0])).toMatchObject({ metric: 'followers_count' });
    expect(params(find('/42/threads_insights')[0]).since).toBeUndefined();
  });
});

describe('connection + setup IPC', () => {
  const handlers = new Map();
  const call = (ch, p) => handlers.get(ch)(p);
  beforeAll(() => m.ipc.registerThreadsSetupHandlers((ch, fn) => handlers.set(ch, fn)));

  it('registers every contract channel', () => {
    expect([...handlers.keys()]).toEqual(m.ipc.THREADS_SETUP_CHANNELS);
  });

  it('validates and saves the Threads app', () => {
    expect(call('setup:threads:getState')).toMatchObject({ hasApp: false, hasToken: false, tracked: false });
    expect(() => call('setup:threads:authUrl', {})).toThrow(/Threads App ID/);
    expect(() => call('setup:threads:saveApp', { appId: 'abc', appSecret: SECRET })).toThrow(/digits/);
    expect(() => call('setup:threads:saveApp', { appId: APP_ID, appSecret: 'short' })).toThrow(/Secret/);
    expect(call('setup:threads:saveApp', { appId: ` ${APP_ID} `, appSecret: SECRET })).toEqual({ appId: APP_ID });
    expect(call('setup:threads:getState')).toMatchObject({ hasApp: true, appId: APP_ID });
    expect(() => call('setup:threads:authUrl', { redirectUri: 'http://localhost/' })).toThrow(/https/);
    const url = new URL(call('setup:threads:authUrl', { redirectUri: 'https://example.com/cb' }));
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/cb');
    expect(url.searchParams.get('client_id')).toBe(APP_ID);
  });

  it('exchanges an authorization code: POST code exchange → th_exchange_token → /me, stores profile + account', async () => {
    await expect(call('setup:threads:exchangeToken', {})).rejects.toThrow(/token or an authorization code/);
    await expect(call('setup:threads:exchangeToken', { code: 'bad' })).rejects.toThrow(/authorization code is invalid/);
    requests = [];
    const res = await call('setup:threads:exchangeToken', { code: 'https://example.com/cb?code=AQCODE#_' });
    expect(res.username).toBe('thready');
    expect(res.expiresAt).toBeGreaterThan(Date.now() + 59 * DAY);

    const [codeCall] = find('/oauth/access_token');
    expect(codeCall.method).toBe('POST');
    expect(codeCall.url.host).toBe('graph.threads.net');
    expect(params(codeCall)).toEqual({ client_id: APP_ID, client_secret: SECRET, code: 'AQCODE', grant_type: 'authorization_code', redirect_uri: 'https://example.com/cb' });
    const [ex] = find('/access_token');
    expect(ex.url.pathname).toBe('/access_token'); // unversioned
    expect(params(ex)).toEqual({ grant_type: 'th_exchange_token', client_secret: SECRET, access_token: 'TH_SHORT' });
    expect(params(find('/me')[0])).toMatchObject({ access_token: 'TH_LONG' });

    const profile = m.profiles.getActiveProfile('threads');
    expect(profile).toMatchObject({ platform: 'threads', app_id: APP_ID, token_ref: `token:threads:${APP_ID}`, refreshed_at: expect.any(Number) });
    expect(m.store.readToken(profile.token_ref)).toBe('TH_LONG');
    expect(m.profiles.getActiveProfile('meta')).toBeNull();
    expect(m.accounts.getAccount('th-42')).toMatchObject({ platform: 'threads', externalId: '42', username: 'thready', isTracked: true, profileId: profile.id });
    expect(call('setup:threads:getState')).toMatchObject({ hasApp: true, hasToken: true, username: 'thready', tracked: true, expiresAt: profile.token_expires_at });
  });

  it('exchanges a pasted short-lived token and updates the same profile', async () => {
    const before = m.profiles.getActiveProfile('threads');
    await expect(call('setup:threads:exchangeToken', { shortToken: 'EXPIRED_SHORT_TOKEN_XXXXXXXX' })).rejects.toThrow(/Threads token is invalid/);
    requests = [];
    await call('setup:threads:exchangeToken', { shortToken: 'THSHORTTOKEN_0123456789abcdef' });
    expect(params(find('/access_token')[0]).access_token).toBe('THSHORTTOKEN_0123456789abcdef');
    expect(find('/oauth/access_token')).toHaveLength(0);
    expect(m.profiles.getActiveProfile('threads').id).toBe(before.id);
  });

  it('keeps an already long-lived token when th_exchange_token refuses it but /me accepts it', async () => {
    routes = [({ path: p }) => (p === '/access_token' ? graphError(100, 'Invalid token type') : null), threadsGraph({ now: NOW })];
    const res = await call('setup:threads:exchangeToken', { shortToken: 'THLONGLIVED_0123456789abcdef' });
    expect(res.username).toBe('thready');
    expect(m.store.readToken(m.profiles.getActiveProfile('threads').token_ref)).toBe('THLONGLIVED_0123456789abcdef');
  });

  it('manual refresh enforces the 24h minimum; refresh calls th_refresh_token', async () => {
    await expect(call('setup:threads:refresh')).rejects.toThrow(/24 hours/);
    const p = m.profiles.getActiveProfile('threads');
    m.profiles.updateProfileToken(p.id, p.token_ref, Date.now() + 10 * DAY, Date.now() - 2 * DAY);
    requests = [];
    const { expiresAt } = await call('setup:threads:refresh');
    expect(expiresAt).toBeGreaterThan(Date.now() + 59 * DAY);
    const [r] = find('/refresh_access_token');
    expect(r.url.pathname).toBe('/refresh_access_token');
    expect(params(r)).toEqual({ grant_type: 'th_refresh_token', access_token: 'THLONGLIVED_0123456789abcdef' });
    expect(m.store.readToken(m.profiles.getActiveProfile('threads').token_ref)).toBe('TH_REFRESHED');
  });

  it('maintenance refreshes inside the window, skips otherwise and warns on failure', async () => {
    const p = () => m.profiles.getActiveProfile('threads');
    requests = [];
    expect(await m.provider.maintenance()).toEqual({ refreshed: false }); // just refreshed
    expect(requests).toHaveLength(0);

    m.profiles.updateProfileToken(p().id, p().token_ref, Date.now() + 30 * DAY, Date.now() - 3 * DAY);
    expect(await m.provider.maintenance()).toEqual({ refreshed: false }); // >20 days left
    expect(requests).toHaveLength(0);

    m.profiles.updateProfileToken(p().id, p().token_ref, Date.now() + 5 * DAY, Date.now() - 3 * DAY);
    const ok = await m.provider.maintenance();
    expect(ok).toMatchObject({ refreshed: true });
    expect(find('/refresh_access_token')).toHaveLength(1);
    expect(p().refreshed_at).toBeGreaterThan(Date.now() - 60_000);

    m.profiles.updateProfileToken(p().id, p().token_ref, Date.now() + 5 * DAY, Date.now() - 3 * DAY);
    routes = [({ path: q }) => (q === '/refresh_access_token' ? graphError(190, 'Session has expired') : null)];
    const warned = new Promise((resolve) => m.progress.progressBus.once('token:warning', resolve));
    const bad = await m.provider.maintenance();
    expect(bad.refreshed).toBe(false);
    expect(await warned).toMatchObject({ platform: 'threads', code: 190, message: expect.stringContaining('could not be refreshed') });

    m.profiles.updateProfileToken(p().id, p().token_ref, Date.now() - DAY, Date.now() - 3 * DAY);
    const expired = new Promise((resolve) => m.progress.progressBus.once('token:warning', resolve));
    expect(await m.provider.maintenance()).toMatchObject({ expired: true });
    expect(await expired).toMatchObject({ platform: 'threads' });
  });

  it('saveTracked toggles the Threads account only; disconnect deactivates and untracks', async () => {
    m.accounts.upsertAccount({ igId: 'ig-x', username: 'ig' });
    expect(call('setup:threads:saveTracked', { tracked: false })).toEqual({ tracked: false });
    expect(m.accounts.getAccount('th-42').isTracked).toBe(false);
    expect(m.accounts.getAccount('ig-x').isTracked).toBe(true);
    expect(call('setup:threads:saveTracked', { tracked: true })).toEqual({ tracked: true });
    expect(m.accounts.getAccount('th-42').isTracked).toBe(true);

    const ref = m.profiles.getActiveProfile('threads').token_ref;
    expect(call('setup:threads:disconnect')).toBe(true);
    expect(m.profiles.getActiveProfile('threads')).toBeNull();
    expect(m.store.readToken(ref)).toBeNull();
    expect(m.accounts.getAccount('th-42').isTracked).toBe(false);
    expect(call('setup:threads:getState')).toMatchObject({ hasToken: false, hasApp: true });
    expect(() => call('setup:threads:saveTracked', { tracked: true })).toThrow(/not connected/);
    await expect(call('setup:threads:refresh')).rejects.toThrow(/not connected/);
    expect(await m.provider.maintenance()).toEqual({ refreshed: false });
  });
});
