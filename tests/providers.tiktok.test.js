/**
 * TikTok provider (v2.0 chunk C2, experimental): Login Kit (desktop, hex-S256 PKCE, loopback + paste-code), token
 * refresh (24 h access / rotating refresh), Display API paging and batching, error-envelope mapping, derived daily
 * series from snapshots, demo seed, setup IPC.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeFetch } from './fixtures/fakeFetch.js';
import { tiktokApi, TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_OPEN_ID } from './fixtures/tiktok.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-tiktok-'));
const NOW = Date.now();
const DAY = 86_400_000;
const realFetch = globalThis.fetch;

let fake;
let api;
const reset = () => {
  api = tiktokApi({ now: NOW });
  fake = createFakeFetch({ tiktok: [api] });
};

let m;
beforeAll(async () => {
  reset();
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = String(typeof input === 'string' ? input : input.url ?? input);
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    return fake(input, init);
  }));
  const { openDb } = await import('../src/main/db/index.js');
  openDb(path.join(dir, 'data.db'));
  m = {
    auth: await import('../src/main/providers/tiktok/auth.js'),
    api: await import('../src/main/providers/tiktok/api.js'),
    mappers: await import('../src/main/providers/tiktok/mappers.js'),
    conn: await import('../src/main/providers/tiktok/connection.js'),
    provider: (await import('../src/main/providers/tiktok/index.js')).default,
    profiles: await import('../src/main/db/queries/profiles.js'),
    accounts: await import('../src/main/db/queries/accounts.js'),
    store: await import('../src/main/config/store.js'),
    db: await import('../src/main/db/index.js'),
    openUrl: await import('../src/main/oauth/openUrl.js'),
    orch: await import('../src/main/sync/orchestrator.js'),
    job: await import('../src/main/sync/jobs/platformAccount.js'),
    progress: await import('../src/main/sync/progress.js'),
    handlers: await import('../src/main/ipc/setup.tiktok.handlers.js'),
  };
  m.api.configureTikTokApi({ backoffMs: 0, delayMs: 0 });
});
afterAll(async () => {
  m.openUrl.setAuthUrlOpener(null);
  vi.unstubAllGlobals();
  m.db.closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const hex = (v) => crypto.createHash('sha256').update(v, 'ascii').digest('hex');

describe('Login Kit helpers', () => {
  it('uses a hex-encoded SHA-256 code challenge (TikTok desktop PKCE, not base64url)', () => {
    // RFC 7636 appendix B verifier; TikTok wants hex(SHA256(verifier)).
    const v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(m.auth.hexChallenge(v)).toBe(hex(v));
    expect(m.auth.hexChallenge(v)).toMatch(/^[0-9a-f]{64}$/);
    const p = m.auth.createTikTokPkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(p.challenge).toBe(hex(p.verifier));
    expect(p.method).toBe('S256');
  });

  it('builds the v2 authorize URL with comma-separated scopes and PKCE', () => {
    const url = new URL(m.auth.buildAuthUrl({ clientKey: 'ck', redirectUri: 'http://127.0.0.1:5555/callback/', state: 'st', challenge: 'ab'.repeat(32) }));
    expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    const p = Object.fromEntries(url.searchParams);
    expect(p).toMatchObject({
      client_key: 'ck', response_type: 'code', redirect_uri: 'http://127.0.0.1:5555/callback/', state: 'st',
      code_challenge: 'ab'.repeat(32), code_challenge_method: 'S256',
    });
    expect(p.scope.split(',')).toEqual(['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list']);
  });

  it('extracts code and state from a bare code or a pasted redirect URL (URL-decoded)', () => {
    expect(m.auth.extractCode('  abc123  ')).toEqual({ code: 'abc123', state: null });
    expect(m.auth.extractCode('https://x.github.io/metadash/oauth/callback.html?code=a%2Ab*c&scopes=user.info.basic&state=S1')).toEqual({ code: 'a*b*c', state: 'S1' });
    expect(m.auth.extractCode('https://x/?error=access_denied&state=S')).toBeNull();
    expect(m.auth.extractCode('')).toBeNull();
  });
});

describe('Display API error envelope', () => {
  it('maps access_token_invalid to a token error (190, source tiktok)', async () => {
    await expect(m.api.fetchUserInfo('nope', ['open_id'])).rejects.toMatchObject({ code: 190, source: 'tiktok', vendorCode: 'access_token_invalid', logId: 'LOG123', isTokenError: true });
  });

  it('maps scope errors to permission errors naming the scope', async () => {
    api.state.failNext.push({ path: '/v2/video/list/', status: 401, code: 'scope_not_authorized', message: 'no scope' });
    const e = await m.api.listVideosPage('tt-access-initial', {}).catch((x) => x);
    expect(e.isPermissionError).toBe(true);
    expect(e.message).toContain('video.list');
    api.state.failNext.push({ path: '/v2/user/info/', status: 400, code: 'scope_permission_missed', message: 'fields' });
    await expect(m.api.fetchUserInfo('tt-access-initial', ['follower_count'])).rejects.toMatchObject({ isPermissionError: true });
  });

  it('retries rate_limit_exceeded with backoff, then gives up with a retryable error', async () => {
    api.state.failNext.push({ path: '/v2/user/info/', status: 429, code: 'rate_limit_exceeded' });
    const u = await m.api.fetchUserInfo('tt-access-initial', ['open_id', 'display_name']);
    expect(u.display_name).toBe('Tok Demo');
    for (let i = 0; i < 5; i += 1) api.state.failNext.push({ path: '/v2/user/info/', status: 429, code: 'rate_limit_exceeded' });
    await expect(m.api.fetchUserInfo('tt-access-initial', ['open_id'])).rejects.toMatchObject({ vendorCode: 'rate_limit_exceeded', isRetryable: true });
    api.state.failNext.length = 0;
  });

  it('maps invalid_params to 100 and unknown errors keep the vendor code', async () => {
    api.state.failNext.push({ path: '/v2/video/query/', status: 400, code: 'invalid_params', message: 'bad' });
    await expect(m.api.queryVideos('tt-access-initial', ['1'])).rejects.toMatchObject({ code: 100, isInvalidParam: true });
    api.state.failNext.push({ path: '/v2/video/query/', status: 403, code: 'spam_risk_too_many_posts', message: 'x' });
    await expect(m.api.queryVideos('tt-access-initial', ['1'])).rejects.toMatchObject({ vendorCode: 'spam_risk_too_many_posts', status: 403 });
  });
});

describe('client + paste-code connect', () => {
  it('validates and stores the client key/secret (secret encrypted)', () => {
    expect(() => m.conn.saveTikTokClient({ clientKey: 'x', clientSecret: TT_CLIENT_SECRET })).toThrow();
    expect(() => m.conn.saveTikTokClient({ clientKey: TT_CLIENT_KEY, clientSecret: 'short' })).toThrow();
    expect(() => m.conn.saveTikTokClient({ clientKey: TT_CLIENT_KEY, clientSecret: TT_CLIENT_SECRET, redirectUri: 'http://evil/' })).toThrow();
    expect(m.conn.saveTikTokClient({ clientKey: TT_CLIENT_KEY, clientSecret: TT_CLIENT_SECRET })).toEqual({ clientKey: TT_CLIENT_KEY });
    const s = m.conn.tiktokState();
    expect(s).toMatchObject({ hasClient: true, clientKey: TT_CLIENT_KEY, sandbox: false, accounts: [] });
    expect(s.redirectUri).toMatch(/^https:\/\/.+\/oauth\/callback\.html$/);
    expect(JSON.stringify(m.db.q.all("SELECT value FROM settings WHERE key LIKE 'token:%'"))).not.toContain(TT_CLIENT_SECRET);
  });

  it('authUrl → exchangeCode (full pasted URL) creates the profile and the tt- account', async () => {
    const { url, state } = m.conn.tiktokAuthUrl();
    const u = new URL(url);
    const redirectUri = u.searchParams.get('redirect_uri');
    expect(redirectUri).toBe(m.conn.tiktokState().redirectUri);
    api.state.codes.set('CODE*1', { challenge: u.searchParams.get('code_challenge'), redirectUri });
    // Unknown / mismatched state is refused before any network call.
    await expect(m.conn.exchangeTikTokCode({ code: 'CODE*1', state: 'other' })).rejects.toThrow();
    expect(api.state.counts.token).toBe(0);
    const pasted = `${redirectUri}?code=CODE%2A1&scopes=user.info.basic&state=${state}`;
    const res = await m.conn.exchangeTikTokCode({ code: pasted, state });
    expect(res).toEqual({ accountId: `tt-${TT_OPEN_ID}`, username: 'tok' });
    const [profile] = m.profiles.activeProfiles('tiktok');
    expect(profile).toMatchObject({ platform: 'tiktok', external_id: TT_OPEN_ID, app_id: TT_CLIENT_KEY });
    expect(m.store.readToken(profile.token_ref)).toBe('tt-access-1');
    expect(m.store.readToken(profile.refresh_ref)).toBe('tt-refresh-1');
    expect(m.profiles.profileScopes(profile)).toContain('video.list');
    expect(profile.token_expires_at).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    const acc = m.accounts.getAccount(`tt-${TT_OPEN_ID}`);
    expect(acc).toMatchObject({ platform: 'tiktok', externalId: TT_OPEN_ID, profileId: profile.id, username: 'tok', isTracked: true });
    // The state is single use.
    await expect(m.conn.exchangeTikTokCode({ code: 'CODE*1', state })).rejects.toThrow();
    const s = m.conn.tiktokState();
    expect(s.accounts).toHaveLength(1);
    expect(s.accounts[0]).toMatchObject({ accountId: `tt-${TT_OPEN_ID}`, profileId: profile.id, username: 'tok', displayName: 'Tok Demo', tracked: true, tokenOk: true });
    expect(s.accounts[0].refreshExpiresAt).toBeGreaterThan(Date.now() + 300 * DAY);
  });

  it('a wrong code surfaces a localized error', async () => {
    const { state } = m.conn.tiktokAuthUrl();
    await expect(m.conn.exchangeTikTokCode({ code: 'WRONG', state })).rejects.toMatchObject({ vendorCode: 'invalid_grant' });
  });
});

describe('loopback connect', () => {
  it('opens the authorize URL, receives the code on 127.0.0.1 and connects', async () => {
    const original = api.state.user;
    api.state.user = { ...original, open_id: 'OPEN_2', username: 'tok2', display_name: 'Tok Two' };
    m.openUrl.setAuthUrlOpener(async (authUrl) => {
      const u = new URL(authUrl);
      const redirectUri = u.searchParams.get('redirect_uri');
      expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback\/$/);
      api.state.codes.set('LOOP1', { challenge: u.searchParams.get('code_challenge'), redirectUri });
      const cb = new URL(redirectUri);
      cb.searchParams.set('code', 'LOOP1');
      cb.searchParams.set('state', u.searchParams.get('state'));
      setTimeout(() => { realFetch(cb).then((r) => r.text()).catch(() => {}); }, 10);
    });
    const res = await m.conn.connectTikTokLoopback({ timeoutMs: 5000 });
    api.state.user = original;
    expect(res).toEqual({ accountId: 'tt-OPEN_2', username: 'tok2' });
    expect(m.profiles.activeProfiles('tiktok')).toHaveLength(2);
  });

  it('can be cancelled', async () => {
    m.openUrl.setAuthUrlOpener(async () => { setTimeout(() => m.conn.cancelTikTokConnect(), 10); });
    await expect(m.conn.connectTikTokLoopback({ timeoutMs: 5000 })).rejects.toMatchObject({ code: 'cancelled' });
    m.openUrl.setAuthUrlOpener(null);
  });
});

describe('token refresh (24 h access tokens)', () => {
  it('refreshes through ctx.tokenForAccount when the access token is about to expire and stores the rotated refresh token', async () => {
    const profile = m.profiles.activeProfiles('tiktok').find((p) => p.external_id === TT_OPEN_ID);
    m.db.q.run('UPDATE profiles SET token_expires_at = ? WHERE id = ?', Date.now() + 60_000, profile.id);
    const before = m.store.readToken(profile.refresh_ref);
    const resolve = m.orch.createAccountTokenResolver({ tokenFor: () => { throw new Error('single'); } });
    const account = m.accounts.getAccount(`tt-${TT_OPEN_ID}`);
    const token = await resolve(account);
    expect(token).toMatch(/^tt-access-\d+$/);
    expect(api.state.counts.refresh).toBe(1);
    const after = m.profiles.getProfileById(profile.id);
    expect(m.store.readToken(after.token_ref)).toBe(token);
    expect(m.store.readToken(after.refresh_ref)).not.toBe(before);
    expect(after.token_expires_at).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it('an invalid refresh token becomes an auth error (190, source tiktok)', async () => {
    const profile = m.profiles.activeProfiles('tiktok').find((p) => p.external_id === TT_OPEN_ID);
    api.state.failNext.push({ path: '/v2/oauth/token/', oauth: true, code: 'invalid_grant', message: 'Refresh token is invalid or expired.' });
    await expect(m.provider.refreshToken(profile)).rejects.toMatchObject({ code: 190, source: 'tiktok', isTokenError: true });
  });

  it('maintenance warns when a refresh token is expired or about to expire', async () => {
    const profile = m.profiles.activeProfiles('tiktok').find((p) => p.external_id === 'OPEN_2');
    const warnings = [];
    const on = (w) => warnings.push(w);
    m.progress.progressBus.on('token:warning', on);
    m.conn.setRefreshExpiry('OPEN_2', Date.now() + 3 * DAY);
    await m.provider.maintenance();
    m.progress.progressBus.off('token:warning', on);
    expect(warnings).toEqual([expect.objectContaining({ platform: 'tiktok', profileId: profile.id, accountId: 'tt-OPEN_2' })]);
    m.conn.setRefreshExpiry('OPEN_2', Date.now() + 300 * DAY);
  });
});

describe('Display API mapping', () => {
  const account = () => m.accounts.getAccount(`tt-${TT_OPEN_ID}`);
  const ctx = () => ({ tokenForAccount: async () => [...api.state.access].pop(), settings: {}, report: () => {}, log: () => {} });

  it('fetchProfile requests only the fields of granted scopes and maps stats', async () => {
    const p = await m.provider.fetchProfile(ctx(), account());
    expect(p).toMatchObject({ username: 'tok', name: 'Tok Demo', followers: 12_345, follows: 12, mediaCount: 45, biography: 'Bio' });
    expect(api.state.lastFields['/v2/user/info/']).toEqual(expect.arrayContaining(['open_id', 'display_name', 'username', 'follower_count', 'video_count']));
    const profile = m.profiles.getProfileById(account().profileId);
    m.db.q.run('UPDATE profiles SET scopes = ? WHERE id = ?', JSON.stringify(['user.info.basic', 'video.list']), profile.id);
    const p2 = await m.provider.fetchProfile(ctx(), account());
    expect(api.state.lastFields['/v2/user/info/']).not.toContain('follower_count');
    expect(api.state.lastFields['/v2/user/info/']).not.toContain('username');
    expect(p2.followers).toBeUndefined();
    expect(p2.username).toBe('Tok Demo');
    m.db.q.run('UPDATE profiles SET scopes = ? WHERE id = ?', profile.scopes, profile.id);
  });

  it('maps a video to a Post', () => {
    const v = api.state.videos[0];
    const post = m.mappers.mapVideo(v);
    expect(post).toMatchObject({
      mediaId: `tt-${v.id}`, externalId: v.id, mediaType: 'VIDEO', mediaProductType: 'TIKTOK', caption: v.video_description,
      permalink: v.share_url, thumbnailUrl: v.cover_image_url, timestamp: new Date(v.create_time * 1000).toISOString(),
      inline: { views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count },
    });
    expect(m.mappers.mapVideo(api.state.videos[1]).caption).toBe(api.state.videos[1].title || '');
  });

  it('pages video/list with max_count 20 and stops at since', async () => {
    api.state.counts.list = 0;
    api.state.listBodies.length = 0;
    const sinceUnix = Math.floor((NOW - 50 * DAY) / 1000);
    const posts = await m.provider.fetchPosts(ctx(), account(), { sinceUnix });
    const expected = api.state.videos.filter((v) => v.create_time >= sinceUnix).length;
    expect(posts).toHaveLength(expected);
    expect(api.state.counts.list).toBe(2); // 20 + 20 (the second page crosses since)
    expect(api.state.listBodies[0]).toEqual({ max_count: 20 });
    expect(api.state.listBodies[1].cursor).toBe(api.state.videos[19].create_time * 1000);
    expect(posts.every((p) => new Date(p.timestamp).getTime() / 1000 >= sinceUnix)).toBe(true);
    const all = await m.provider.fetchPosts(ctx(), account(), { sinceUnix: 0 });
    expect(all).toHaveLength(45);
  });

  it('fetchPostInsightsBatch queries in groups of 20 and keys values by mediaId', async () => {
    api.state.counts.query = 0;
    api.state.queryBodies.length = 0;
    const posts = api.state.videos.map((v) => ({ mediaId: `tt-${v.id}`, externalId: v.id, mediaType: 'VIDEO', mediaProductType: 'TIKTOK' }));
    const { values, dropped } = await m.provider.fetchPostInsightsBatch(ctx(), account(), posts, {});
    expect(dropped).toEqual([]);
    expect(api.state.counts.query).toBe(3);
    expect(api.state.queryBodies.map((b) => b.filters.video_ids.length)).toEqual([20, 20, 5]);
    const v = api.state.videos[7];
    expect(values[`tt-${v.id}`]).toEqual({ views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count });
  });
});

describe('sync job + derived daily series', () => {
  it('syncs a TikTok account through the generic job and derives follower_count / views from snapshots', async () => {
    const key = `tt-${TT_OPEN_ID}`;
    const yesterday = new Date(NOW - DAY);
    m.accounts.insertSnapshot({ igId: key, date: fmt(yesterday), followers: 12_000, follows: 10, mediaCount: 44, capturedAt: NOW - DAY });
    const logs = [];
    const ctx = {
      tokenForAccount: async () => [...api.state.access].pop(), settings: { mediaLookbackDays: 30 }, report: () => {}, log: (e) => logs.push(e), signal: null,
    };
    await m.job.syncPlatformAccount(ctx, m.provider, m.accounts.getAccount(key));
    expect(logs).toEqual([]);
    const media = m.db.q.all('SELECT media_id, media_product_type FROM media WHERE ig_id = ?', key);
    expect(media.length).toBeGreaterThan(10);
    expect(media.every((r) => r.media_product_type === 'TIKTOK')).toBe(true);
    const latest = m.db.q.get('SELECT views, likes FROM media_latest WHERE media_id = ?', `tt-${api.state.videos[0].id}`);
    expect(latest).toMatchObject({ views: api.state.videos[0].view_count, likes: api.state.videos[0].like_count });
    const today = fmt(new Date());
    const daily = Object.fromEntries(m.db.q.all('SELECT metric, value FROM account_insights_daily WHERE ig_id = ? AND date = ?', key, today).map((r) => [r.metric, r.value]));
    expect(daily.follower_count).toBe(345);
    expect(daily.views).toBe(api.state.videos[0].view_count); // only the <48 h old video counts on its first capture
  });
});

describe('demo seed', () => {
  it('seeds demo TikTok accounts with their own profiles and derived series; extendDay adds a day', () => {
    const r = mulberry(7);
    const out = m.provider.demo.seed({ now: new Date(NOW), rng: r });
    expect(out.accounts.length).toBeGreaterThanOrEqual(2);
    const key = out.accounts[0];
    const acc = m.accounts.getAccount(key);
    expect(acc.platform).toBe('tiktok');
    const profile = m.profiles.getProfileById(acc.profileId);
    expect(profile.token_ref).toMatch(/^demo:tiktok:/);
    expect(m.db.q.get("SELECT COUNT(*) AS c FROM account_insights_daily WHERE ig_id = ? AND metric = 'views'", key).c).toBeGreaterThan(30);
    expect(m.db.q.get("SELECT COUNT(*) AS c FROM account_insights_daily WHERE ig_id = ? AND metric = 'follower_count'", key).c).toBeGreaterThan(30);
    expect(m.db.q.get("SELECT COUNT(*) AS c FROM media WHERE ig_id = ? AND media_product_type = 'TIKTOK'", key).c).toBeGreaterThan(10);
    const state = m.conn.tiktokState();
    expect(state.accounts.find((a) => a.accountId === key)).toMatchObject({ tokenOk: true });
    const date = fmt(new Date());
    const before = m.db.q.get("SELECT value FROM account_insights_daily WHERE ig_id = ? AND metric = 'views' AND date = ?", key, date)?.value ?? 0;
    m.provider.demo.extendDay(key, r, date);
    expect(m.db.q.get("SELECT value FROM account_insights_daily WHERE ig_id = ? AND metric = 'views' AND date = ?", key, date)?.value).toBeGreaterThan(before);
  });
});

describe('account KPIs', () => {
  it('likes/comments/shares sum the period\'s posts (no daily series in the Display API)', async () => {
    expect(m.provider.computeKpi('likes', { agg: { likes: 120 }, prevAgg: { likes: 100 } })).toEqual({ value: 120, prev: 100, changePct: 20 });
    expect(m.provider.computeKpi('shares', { agg: {}, prevAgg: {} })).toMatchObject({ value: 0, prev: 0 });
    expect(m.provider.computeKpi('views', { agg: { views: 1 }, prevAgg: {} })).toBeUndefined();
    const { accountAnalytics } = await import('../src/main/analytics/account.js');
    const key = m.db.q.get("SELECT ig_id FROM accounts WHERE platform = 'tiktok' AND ig_id IN (SELECT ig_id FROM media) LIMIT 1").ig_id;
    const to = fmt(new Date());
    const from = fmt(new Date(Date.now() - 27 * 86_400_000));
    const a = accountAnalytics({ igId: key, from, to });
    const posts = m.db.q.get('SELECT SUM(l.likes) AS s FROM media m JOIN media_latest l ON l.media_id = m.media_id WHERE m.ig_id = ? AND m.is_deleted = 0 AND m.posted_at BETWEEN ? AND ?', key, Date.parse(`${from}T00:00:00`), Date.parse(`${to}T23:59:59.999`)).s ?? 0;
    expect(a.kpis.likes.value).toBe(posts);
  });
});

describe('setup IPC + disconnect', () => {
  const handlers = new Map();
  beforeAll(() => { m.handlers.registerTikTokSetupHandlers((ch, fn) => handlers.set(ch, fn)); });

  it('registers every contract channel', () => {
    expect([...handlers.keys()].sort()).toEqual([...m.handlers.TIKTOK_SETUP_CHANNELS].sort());
  });

  it('getState / saveTracked', async () => {
    const s = await handlers.get('setup:tiktok:getState')();
    expect(s.hasClient).toBe(true);
    const ids = s.accounts.map((a) => a.accountId);
    const res = await handlers.get('setup:tiktok:saveTracked')({ accountIds: [ids[0], 'ig-not-tiktok'] });
    expect(res).toEqual({ accountIds: [ids[0]] });
    const after = await handlers.get('setup:tiktok:getState')();
    expect(after.accounts.filter((a) => a.tracked).map((a) => a.accountId)).toEqual([ids[0]]);
  });

  it('disconnect keeps history by default and wipes the tokens; deleteData removes the account data', async () => {
    const p1 = m.profiles.activeProfiles('tiktok').find((p) => p.external_id === 'OPEN_2');
    const tokenRef = p1.token_ref;
    await handlers.get('setup:tiktok:disconnect')({ profileId: p1.id, deleteData: false });
    expect(m.profiles.getProfileById(p1.id).is_active).toBe(0);
    expect(m.store.readToken(tokenRef)).toBeNull();
    expect(api.state.revoked.length).toBe(1);
    expect(m.accounts.getAccount('tt-OPEN_2')).toMatchObject({ isTracked: false });

    const key = `tt-${TT_OPEN_ID}`;
    const p2 = m.profiles.activeProfiles('tiktok').find((p) => p.external_id === TT_OPEN_ID);
    expect(m.db.q.get('SELECT COUNT(*) AS c FROM media WHERE ig_id = ?', key).c).toBeGreaterThan(0);
    await handlers.get('setup:tiktok:disconnect')({ profileId: p2.id, deleteData: true });
    expect(m.accounts.getAccount(key)).toBeFalsy();
    for (const t of ['media', 'account_snapshots', 'account_insights_daily']) expect(m.db.q.get(`SELECT COUNT(*) AS c FROM ${t} WHERE ig_id = ?`, key).c).toBe(0);
    expect(m.db.q.get("SELECT COUNT(*) AS c FROM media_insight_snapshots WHERE media_id LIKE 'tt-7300%'").c).toBe(0);
  });

  it('refuses unknown profiles', async () => {
    await expect(handlers.get('setup:tiktok:disconnect')({ profileId: 9999, deleteData: false })).rejects.toThrow();
  });
});

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
