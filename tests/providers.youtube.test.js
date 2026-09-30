/**
 * YouTube provider (v2.0 C1): mappers, OAuth (PKCE + real loopback), token refresh, quota ledger, soft quota errors,
 * insights batch, demographics, inbox adapter, disconnect + delete, setup state, KPIs, report section, demo seed.
 * Google is faked by tests/fixtures/google.js; only 127.0.0.1 (the loopback receiver) goes to the real fetch.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeFetch } from './fixtures/fakeFetch.js';
import { googleApis, demoChannel } from './fixtures/google.js';

process.env.METADASH_GOOGLE_BACKOFF_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-youtube-'));
const NOW = Date.now();
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const realFetch = globalThis.fetch;
const google = googleApis({ now: NOW, clientId: CLIENT_ID, channels: [demoChannel('UCaaa', { now: NOW }), demoChannel('UCbbb', { now: NOW, hidden: true })] });
const fake = createFakeFetch({ google: [google] });

let m;
beforeAll(async () => {
  vi.stubGlobal('fetch', async (input, init) => {
    const url = typeof input === 'string' ? input : input.url ?? input.toString();
    return url.startsWith('http://127.0.0.1') ? realFetch(input, init) : fake(input, init);
  });
  const { openDb } = await import('../src/main/db/index.js');
  openDb(path.join(dir, 'data.db'));
  m = {
    store: await import('../src/main/config/store.js'),
    profiles: await import('../src/main/db/queries/profiles.js'),
    accounts: await import('../src/main/db/queries/accounts.js'),
    media: await import('../src/main/db/queries/media.js'),
    settings: await import('../src/main/db/queries/settings.js'),
    mappers: await import('../src/main/providers/youtube/mappers.js'),
    auth: await import('../src/main/providers/youtube/auth.js'),
    api: await import('../src/main/providers/youtube/api.js'),
    quota: await import('../src/main/providers/youtube/quota.js'),
    conn: await import('../src/main/providers/youtube/connection.js'),
    kpis: await import('../src/main/providers/youtube/kpis.js'),
    reports: await import('../src/main/providers/youtube/reportSections.js'),
    provider: (await import('../src/main/providers/youtube/index.js')),
    progress: await import('../src/main/sync/progress.js'),
    errors: await import('../src/main/meta/errors.js'),
  };
}, 120_000);
afterAll(async () => {
  m.conn.__resetYouTubeConnectionForTests();
  const { closeDb } = await import('../src/main/db/index.js');
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const yt = () => m.provider.default;

/** Connects a channel through the real loopback: the "browser" follows the authorize URL's redirect. */
async function connect(channelId, { reply = false, state: forcedState } = {}) {
  let authUrl = null;
  let callbackStatus = null;
  const open = async (url) => {
    authUrl = new URL(url);
    const redirect = new URL(authUrl.searchParams.get('redirect_uri'));
    redirect.searchParams.set('code', `code-${channelId}`);
    redirect.searchParams.set('state', forcedState ?? authUrl.searchParams.get('state'));
    setTimeout(async () => { callbackStatus = (await realFetch(redirect)).status; }, 5);
  };
  const result = await m.conn.connectChannel({ reply }, { open, timeoutMs: 5000 });
  return { result, authUrl, callbackStatus: () => callbackStatus };
}

describe('mappers', () => {
  it('parses ISO-8601 durations', () => {
    const { parseIsoDuration } = m.mappers;
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT12M3S')).toBe(723);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('P1DT1S')).toBe(86_401);
    expect(parseIsoDuration('P0D')).toBe(0);
    expect(parseIsoDuration('PT')).toBeNull();
    expect(parseIsoDuration('garbage')).toBeNull();
    expect(parseIsoDuration(undefined)).toBeNull();
  });

  it('classifies Shorts, videos and live streams', () => {
    const { productTypeOf } = m.mappers;
    expect(productTypeOf({ durationS: 3600, live: true })).toBe('YT_LIVE');
    expect(productTypeOf({ durationS: 60, contentType: 'LIVE_STREAM' })).toBe('YT_LIVE');
    expect(productTypeOf({ durationS: 170, contentType: 'SHORTS' })).toBe('YT_SHORT');
    expect(productTypeOf({ durationS: 50, contentType: 'VIDEO_ON_DEMAND' })).toBe('YT_VIDEO'); // Analytics wins over the heuristic
    expect(productTypeOf({ durationS: 180 })).toBe('YT_SHORT'); // heuristic: ≤ 3 min
    expect(productTypeOf({ durationS: 181 })).toBe('YT_VIDEO');
    expect(productTypeOf({ durationS: 0 })).toBe('YT_VIDEO');
    expect(productTypeOf({ durationS: 30, contentType: 'UNSPECIFIED' })).toBe('YT_SHORT');
  });

  it('maps channels (hidden subscriber counts are unknown) and videos', () => {
    const ch = m.mappers.mapChannel({ id: 'UCx', snippet: { title: 'X', customUrl: 'xchan', thumbnails: { medium: { url: 'u' } } }, statistics: { subscriberCount: '1230', videoCount: '4', hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: 'UUx' } } });
    expect(ch).toMatchObject({ channelId: 'UCx', username: 'xchan', handle: '@xchan', name: 'X', followers: 1230, mediaCount: 4, uploadsPlaylistId: 'UUx', website: 'https://www.youtube.com/@xchan', profilePicUrl: 'u' });
    expect(m.mappers.mapChannel({ id: 'UCy', snippet: { title: 'Y' }, statistics: { subscriberCount: '0', hiddenSubscriberCount: true } }).followers).toBeNull();
    const post = m.mappers.mapVideo({ id: 'v1', snippet: { title: 'T', description: 'D', publishedAt: '2026-01-01T00:00:00Z', thumbnails: { medium: { url: 'th' } } }, contentDetails: { duration: 'PT2M' }, statistics: { viewCount: '10', likeCount: '2', commentCount: '1' } });
    expect(post).toEqual({ mediaId: 'yt-v1', externalId: 'v1', mediaType: 'VIDEO', mediaProductType: 'YT_SHORT', caption: 'T\nD', permalink: 'https://youtu.be/v1', thumbnailUrl: 'th', timestamp: '2026-01-01T00:00:00Z', durationS: 120, inline: { views: 10, likes: 2, comments: 1 } });
  });

  it('maps comment threads with owner detection', () => {
    const thread = {
      snippet: { videoId: 'v1', totalReplyCount: 1, topLevelComment: { id: 'c1', snippet: { authorDisplayName: 'Fan', authorChannelId: { value: 'UCfan' }, textOriginal: 'Nice!', likeCount: 3, publishedAt: '2026-02-01T10:00:00Z' } } },
      replies: { comments: [{ id: 'c1.r1', snippet: { authorDisplayName: 'Me', authorChannelId: { value: 'UCme' }, textOriginal: 'Thanks', publishedAt: '2026-02-01T11:00:00Z' } }] },
    };
    const [top, reply] = m.mappers.mapThread(thread, { mediaId: 'yt-v1', accountId: 'yt-UCme', channelId: 'UCme' });
    expect(top).toMatchObject({ commentId: 'ytc-c1', externalId: 'c1', parentId: null, authorId: 'UCfan', username: 'Fan', text: 'Nice!', likeCount: 3, isFromOwner: false, platform: 'youtube', mediaId: 'yt-v1', accountId: 'yt-UCme', isHidden: false });
    expect(top.permalink).toBe('https://www.youtube.com/watch?v=v1&lc=c1');
    expect(reply).toMatchObject({ commentId: 'ytc-c1.r1', parentId: 'ytc-c1', isFromOwner: true, createdAt: Date.parse('2026-02-01T11:00:00Z') });
  });

  it('maps demographics to gender_age percent and country count buckets', () => {
    const d = m.mappers.mapDemographics([{ ageGroup: 'age25-34', gender: 'female', viewerPercentage: 30.5 }, { ageGroup: 'age65-', gender: 'male', viewerPercentage: 2 }], [{ country: 'TR', views: 90 }]);
    expect(d).toEqual({ gender_age: [{ bucket: 'F.25-34', value: 30.5 }, { bucket: 'M.65-', value: 2 }], country: [{ bucket: 'TR', value: 90 }] });
    expect(m.mappers.mapDemographics([], [])).toEqual({});
  });
});

describe('quota ledger', () => {
  it('uses the Pacific-time day and rolls over at PT midnight', () => {
    const { ptDay, nextResetAt } = m.quota;
    // 2026-07-10 06:59 UTC = 23:59 PDT on the 9th; 07:00 UTC = 00:00 PDT on the 10th.
    expect(ptDay(Date.parse('2026-07-10T06:59:00Z'))).toBe('2026-07-09');
    expect(ptDay(Date.parse('2026-07-10T07:00:00Z'))).toBe('2026-07-10');
    // Winter (PST, UTC-8)
    expect(ptDay(Date.parse('2026-01-10T07:30:00Z'))).toBe('2026-01-09');
    expect(nextResetAt(Date.parse('2026-07-10T06:59:00Z'))).toBe(Date.parse('2026-07-10T07:00:00Z'));
    expect(nextResetAt(Date.parse('2026-01-10T12:00:00Z'))).toBe(Date.parse('2026-01-11T08:00:00Z'));
    // DST start (2026-03-08): day is 23 h long
    expect(nextResetAt(Date.parse('2026-03-08T12:00:00Z'))).toBe(Date.parse('2026-03-09T07:00:00Z'));
  });

  it('stops reads at 90% (keeping the reply reserve), allows writes to the limit, keys by client', () => {
    const key = m.quota.quotaKeyFor('ledger-test.apps.googleusercontent.com');
    expect(key).toMatch(/^youtube:[0-9a-f]{12}$/);
    expect(key).not.toContain('ledger-test');
    const t = Date.parse('2026-05-05T18:00:00Z');
    expect(m.quota.spendUnits(key, 8999, { now: t })).toBe(8999);
    expect(m.quota.spendUnits(key, 1, { now: t })).toBe(9000);
    expect(() => m.quota.spendUnits(key, 1, { now: t })).toThrow(m.quota.QuotaError);
    expect(m.quota.spendUnits(key, 50, { write: true, now: t })).toBe(9050);
    expect(() => m.quota.spendUnits(key, 1000, { write: true, now: t })).toThrow(/quota/i);
    // next PT day starts fresh
    expect(m.quota.spendUnits(key, 1, { now: t + 86_400_000 })).toBe(1);
    expect(m.quota.quotaState(key, t)).toMatchObject({ used: 9050, limit: 10_000, resetsAt: m.quota.nextResetAt(t) });
    expect(m.quota.estimateSyncUnits(120, { inboxVideos: 5 })).toBe(1 + 3 * 2 + 5);
  });

  it('turns 403 quotaExceeded into a soft QuotaError and marks the day exhausted', async () => {
    const key = m.quota.quotaKeyFor('exhaust.apps.googleusercontent.com');
    const client = m.api.createYtClient({ token: 'at-UCaaa-1', quotaKey: key });
    google.state.quotaExceeded = true;
    try {
      await expect(m.api.fetchMyChannel(client)).rejects.toBeInstanceOf(m.quota.QuotaError);
    } finally {
      google.state.quotaExceeded = false;
    }
    expect(m.quota.quotaState(key).used).toBe(10_000);
    // Next read is refused locally, without calling Google.
    const before = fake.requests.length;
    await expect(m.api.fetchMyChannel(client)).rejects.toMatchObject({ code: 'YT_QUOTA' });
    expect(fake.requests.length).toBe(before);
  });

  it('maps HTTP errors: 401 → auth (190), 403 → permission (10), 404 → invalid (100)', () => {
    const e401 = m.api.googleError(401, { error: { message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }, '/channels');
    expect(e401).toMatchObject({ code: 190, source: 'google' });
    expect(e401.isTokenError).toBe(true);
    expect(m.api.googleError(403, { error: { message: 'x', errors: [{ reason: 'forbidden' }] } }, '/x').isPermissionError).toBe(true);
    expect(m.api.googleError(404, { error: { message: 'x', errors: [{ reason: 'videoNotFound' }] } }, '/x').isInvalidParam).toBe(true);
    expect(m.api.googleError(403, { error: { errors: [{ reason: 'dailyLimitExceeded' }] } }, '/x')).toBeInstanceOf(m.quota.QuotaError);
  });
});

describe('OAuth (PKCE + loopback) and setup', () => {
  it('builds a desktop consent URL with PKCE and offline access', () => {
    const url = new URL(m.auth.buildAuthUrl({ clientId: CLIENT_ID, redirectUri: 'http://127.0.0.1:5555/oauth/callback', challenge: 'CH', state: 'ST', reply: true }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT_ID, redirect_uri: 'http://127.0.0.1:5555/oauth/callback', response_type: 'code', code_challenge: 'CH', code_challenge_method: 'S256',
      state: 'ST', access_type: 'offline', prompt: 'consent',
    });
    expect(url.searchParams.get('scope').split(' ')).toEqual([m.auth.SCOPES.readonly, m.auth.SCOPES.analytics, m.auth.SCOPES.forceSsl]);
    expect(new URL(m.auth.buildAuthUrl({ clientId: CLIENT_ID, redirectUri: 'x', challenge: 'c', state: 's' })).searchParams.get('scope')).not.toContain('force-ssl');
  });

  it('validates and stores the OAuth client (secret encrypted)', () => {
    expect(() => m.conn.saveClient({ clientId: 'nope', clientSecret: 'GOCSPX-abcdefghijkl' })).toThrow();
    expect(() => m.conn.saveClient({ clientId: CLIENT_ID, clientSecret: 'short' })).toThrow();
    expect(m.conn.saveClient({ clientId: ` ${CLIENT_ID} `, clientSecret: 'GOCSPX-abcdefghijkl' })).toEqual({ clientId: CLIENT_ID });
    expect(m.settings.getSetting('youtube.clientId')).toBe(CLIENT_ID);
    expect(JSON.stringify(m.settings.getAllSettings())).not.toContain('GOCSPX-abcdefghijkl');
    expect(m.conn.youtubeState()).toMatchObject({ hasClient: true, clientId: CLIENT_ID, channels: [], quota: { used: expect.any(Number), limit: 10_000 } });
  });

  it('connects a channel through the real loopback receiver with PKCE', async () => {
    google.state.tokenRequests.length = 0;
    const { result, authUrl, callbackStatus } = await connect('UCaaa');
    expect(result).toEqual({ accountId: 'yt-UCaaa', title: 'Channel UCaaa' });
    expect(authUrl.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    const req = google.state.tokenRequests.at(-1);
    expect(req).toMatchObject({ grant_type: 'authorization_code', code: 'code-UCaaa', client_id: CLIENT_ID, client_secret: 'GOCSPX-abcdefghijkl', redirect_uri: authUrl.searchParams.get('redirect_uri') });
    const { codeChallenge } = await import('../src/main/oauth/pkce.js');
    expect(codeChallenge(req.code_verifier)).toBe(authUrl.searchParams.get('code_challenge'));
    await vi.waitFor(() => expect(callbackStatus()).toBe(200));

    const profile = m.profiles.listProfiles('google', { activeOnly: true }).find((p) => p.external_id === 'UCaaa');
    expect(profile).toMatchObject({ app_id: CLIENT_ID, platform: 'google' });
    expect(m.store.readToken(profile.token_ref)).toBe('at-UCaaa-1');
    expect(m.store.readToken(profile.refresh_ref)).toBe('rt-UCaaa');
    expect(m.profiles.profileScopes(profile)).toEqual([m.auth.SCOPES.readonly, m.auth.SCOPES.analytics]);
    expect(m.accounts.getAccount('yt-UCaaa')).toMatchObject({ platform: 'youtube', externalId: 'UCaaa', profileId: profile.id, username: 'ucaaa', isTracked: true });

    const st = m.conn.youtubeState();
    expect(st.channels).toEqual([expect.objectContaining({ accountId: 'yt-UCaaa', profileId: profile.id, title: 'Channel UCaaa', handle: '@ucaaa', tracked: true, tokenOk: true, canReply: false })]);
  });

  it('rejects a callback with the wrong state (400 page) and leaves nothing behind', async () => {
    const before = m.profiles.listProfiles('google').length;
    let status = null;
    const open = async (url) => {
      const redirect = new URL(new URL(url).searchParams.get('redirect_uri'));
      redirect.searchParams.set('code', 'code-UCbbb');
      redirect.searchParams.set('state', 'forged');
      status = (await realFetch(redirect)).status;
    };
    await expect(m.conn.connectChannel({}, { open, timeoutMs: 5000 })).rejects.toMatchObject({ code: 'state_mismatch' });
    expect(status).toBe(400);
    expect(m.profiles.listProfiles('google').length).toBe(before);
  });

  it('can be cancelled while waiting for the browser', async () => {
    const p = m.conn.connectChannel({}, { open: async () => { setTimeout(() => m.conn.cancelConnect(), 10); }, timeoutMs: 5000 });
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('"Enable replying" re-consents with force-ssl and records the scope', async () => {
    google.state.grantedScope = `${m.auth.SCOPES.readonly} ${m.auth.SCOPES.analytics} ${m.auth.SCOPES.forceSsl}`;
    try {
      const { authUrl } = await connect('UCaaa', { reply: true });
      expect(authUrl.searchParams.get('scope')).toContain('youtube.force-ssl');
    } finally {
      google.state.grantedScope = null;
    }
    expect(m.profiles.listProfiles('google', { activeOnly: true }).filter((p) => p.external_id === 'UCaaa')).toHaveLength(1);
    expect(m.conn.youtubeState().channels.find((c) => c.accountId === 'yt-UCaaa').canReply).toBe(true);
  });

  it('tracks a subset of channels without touching other platforms', async () => {
    await connect('UCbbb');
    m.accounts.upsertAccount({ igId: 'ig-keep', username: 'keep' });
    expect(m.conn.saveTracked({ accountIds: ['yt-UCbbb', 'yt-unknown'] })).toEqual({ accountIds: ['yt-UCbbb'] });
    expect(m.accounts.getAccount('yt-UCaaa').isTracked).toBe(false);
    expect(m.accounts.getAccount('ig-keep').isTracked).toBe(true);
    expect(() => m.conn.saveTracked({ accountIds: 'yt-UCbbb' })).toThrow();
    m.conn.saveTracked({ accountIds: ['yt-UCaaa', 'yt-UCbbb'] });
  });
});

describe('token refresh', () => {
  it('refreshes an expiring access token and stores it', async () => {
    const profile = m.profiles.listProfiles('google', { activeOnly: true }).find((p) => p.external_id === 'UCbbb');
    const r = await yt().refreshToken(profile);
    expect(r.token).toMatch(/^at-UCbbb-\d+$/);
    expect(r.expiresAt).toBeGreaterThan(Date.now() + 3_000_000);
    const again = m.profiles.getProfileById(profile.id);
    expect(m.store.readToken(again.token_ref)).toBe(r.token);
    expect(again.token_expires_at).toBe(r.expiresAt);
    expect(google.state.tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-UCbbb', client_id: CLIENT_ID });
  });

  it('turns invalid_grant into an auth error (MetaError 190, source google)', async () => {
    const profile = m.profiles.listProfiles('google', { activeOnly: true }).find((p) => p.external_id === 'UCbbb');
    google.state.revoked.add('rt-UCbbb');
    try {
      const err = await yt().refreshToken(profile).catch((e) => e);
      expect(err).toBeInstanceOf(m.errors.MetaError);
      expect(err).toMatchObject({ code: 190, source: 'google' });
    } finally {
      google.state.revoked.delete('rt-UCbbb');
    }
  });

  it('goes through ctx.tokenForAccount (orchestrator resolver) when the token is about to expire', async () => {
    const { createAccountTokenResolver } = await import('../src/main/sync/orchestrator.js');
    const { __setProviderForTests } = await import('../src/main/providers/index.js');
    __setProviderForTests('youtube', { ...yt(), enabled: true });
    try {
      const profile = m.profiles.listProfiles('google', { activeOnly: true }).find((p) => p.external_id === 'UCaaa');
      m.profiles.updateProfileToken(profile.id, profile.token_ref, Date.now() + 60_000);
      const resolve = createAccountTokenResolver({ tokenFor: () => { throw new Error('single'); } });
      const token = await resolve(m.accounts.getAccount('yt-UCaaa'));
      expect(token).toMatch(/^at-UCaaa-\d+$/);
      expect(m.profiles.getProfileById(profile.id).token_expires_at).toBeGreaterThan(Date.now() + 3_000_000);
    } finally {
      __setProviderForTests('youtube', undefined);
    }
  });
});

const ctxFor = (log = vi.fn()) => ({
  settings: {}, log, signal: undefined,
  tokenForAccount: async (a) => m.store.readToken(m.profiles.getProfileById(a.profileId).token_ref),
});

describe('sync hooks', () => {
  beforeEach(() => {
    m.provider.__resetYouTubeProviderForTests();
    google.state.analyticsForbidden = false;
    google.state.contentTypeUnsupported = false;
  });

  it('fetches profile and posts with Analytics content types', async () => {
    const account = m.accounts.getAccount('yt-UCaaa');
    const ctx = ctxFor();
    expect(await yt().fetchProfile(ctx, account)).toMatchObject({ username: 'ucaaa', name: 'Channel UCaaa', followers: 12_300, mediaCount: 3 });
    const posts = await yt().fetchPosts(ctx, account, { sinceUnix: Math.floor((NOW - 15 * 86_400_000) / 1000) });
    expect(posts.map((p) => [p.mediaId, p.mediaProductType, p.durationS])).toEqual([['yt-UCaaa-s1', 'YT_SHORT', 45], ['yt-UCaaa-v1', 'YT_VIDEO', 723]]); // live is older than since
    const all = await yt().fetchPosts(ctx, account, {});
    expect(all.find((p) => p.externalId === 'UCaaa-l1').mediaProductType).toBe('YT_LIVE');
  });

  it('falls back to the duration heuristic when creatorContentType is refused', async () => {
    google.state.contentTypeUnsupported = true;
    const hidden = m.accounts.getAccount('yt-UCbbb');
    const posts = await yt().fetchPosts(ctxFor(), hidden, {});
    expect(posts.map((p) => p.mediaProductType).sort()).toEqual(['YT_LIVE', 'YT_SHORT', 'YT_VIDEO']);
    expect((await yt().fetchProfile(ctxFor(), hidden)).followers).toBeNull(); // hidden subscriber count
  });

  it('batches post insights: realtime counts win, watch metrics from Analytics', async () => {
    const account = m.accounts.getAccount('yt-UCaaa');
    const posts = [{ mediaId: 'yt-UCaaa-v1', externalId: 'UCaaa-v1' }, { mediaId: 'yt-UCaaa-s1', externalId: 'UCaaa-s1' }];
    const { values } = await yt().fetchPostInsightsBatch(ctxFor(), account, posts);
    expect(values['yt-UCaaa-v1']).toEqual({ views: 20000, likes: 900, comments: 80, shares: 17, watch_time_min: 30000, avg_view_duration_s: 95, avg_view_pct: 41.5 });
    google.state.analyticsForbidden = true;
    const log = vi.fn();
    const fallback = await yt().fetchPostInsightsBatch(ctxFor(log), account, posts);
    expect(fallback.values['yt-UCaaa-s1']).toEqual({ views: 5000, likes: 400, comments: 12 });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'youtubeAnalytics:video', code: 10 }));
  });

  it('maps daily channel series and demographics', async () => {
    const account = m.accounts.getAccount('yt-UCaaa');
    const since = Math.floor(Date.parse('2026-03-01T00:00:00Z') / 1000);
    const { series, dropped } = await yt().fetchDailyInsights(ctxFor(), account, { sinceUnix: since, untilUnix: since + 2 * 86_400 });
    expect(dropped).toEqual([]);
    expect(Object.keys(series).sort()).toEqual(['avg_view_duration_s', 'comments', 'follower_count', 'likes', 'shares', 'unfollows', 'views', 'watch_time_min']);
    expect(series.views).toEqual([{ date: '2026-03-01', value: 1000 }, { date: '2026-03-02', value: 1001 }, { date: '2026-03-03', value: 1002 }]);
    expect(series.follower_count[0]).toEqual({ date: '2026-03-01', value: 12 });
    const demo = await yt().fetchDemographics(ctxFor(), account);
    expect(demo.dimensions).toEqual({
      gender_age: [{ bucket: 'F.18-24', value: 20.5 }, { bucket: 'M.25-34', value: 45.25 }, { bucket: 'U.25-34', value: 1 }],
      country: [{ bucket: 'TR', value: 9000 }, { bucket: 'DE', value: 1200 }],
    });
    google.state.analyticsForbidden = true;
    expect(await yt().fetchDemographics(ctxFor(), account)).toEqual({ dimensions: {}, dropped: [] });
  });
});

describe('inbox adapter', () => {
  it('fetches threads, replies with force-ssl and hides via moderation status', async () => {
    const ch = google.channels.get('UCaaa');
    ch.comments['UCaaa-v1'] = [{
      snippet: { videoId: 'UCaaa-v1', totalReplyCount: 0, topLevelComment: { id: 'cm1', snippet: { authorDisplayName: 'Viewer', authorChannelId: { value: 'UCviewer' }, textOriginal: 'Question?', publishedAt: new Date(NOW - 3_600_000).toISOString() } } },
    }];
    const account = m.accounts.getAccount('yt-UCaaa'); // has force-ssl (enable replying test)
    const comments = await yt().inbox.fetch(ctxFor(), account, { mediaId: 'yt-UCaaa-v1', externalId: 'UCaaa-v1' }, {});
    expect(comments).toEqual([expect.objectContaining({ commentId: 'ytc-cm1', externalId: 'cm1', isFromOwner: false, text: 'Question?', accountId: 'yt-UCaaa' })]);
    const res = await yt().inbox.reply(ctxFor(), account, comments[0], '  Thanks!  ');
    expect(res).toMatchObject({ remoteId: 'reply-1', commentId: 'ytc-reply-1', createdAt: NOW });
    expect(google.state.inserted.at(-1)).toEqual({ snippet: { parentId: 'cm1', textOriginal: 'Thanks!' } });
    await yt().inbox.hide(ctxFor(), account, comments[0], true);
    expect(google.state.moderated.at(-1)).toEqual({ id: 'cm1', status: 'heldForReview' });
    await expect(yt().inbox.reply(ctxFor(), account, comments[0], 'x'.repeat(10_001))).rejects.toMatchObject({ code: 100 });
  });

  it('refuses replies without the force-ssl scope (permission error, no API call)', async () => {
    const account = m.accounts.getAccount('yt-UCbbb');
    const before = google.state.inserted.length;
    await expect(yt().inbox.reply(ctxFor(), account, { commentId: 'ytc-x', externalId: 'x', parentId: null }, 'hi')).rejects.toMatchObject({ code: 'SCOPE_MISSING', isPermissionError: true });
    expect(google.state.inserted.length).toBe(before);
  });
});

describe('KPIs and report section', () => {
  it('computes a views-weighted average view duration and net subscribers', () => {
    const key = 'yt-UCaaa';
    const put = m.accounts.upsertInsightDaily;
    put(key, '2026-04-01', 'views', 100); put(key, '2026-04-01', 'avg_view_duration_s', 60);
    put(key, '2026-04-02', 'views', 300); put(key, '2026-04-02', 'avg_view_duration_s', 120);
    put(key, '2026-04-01', 'follower_count', 10); put(key, '2026-04-02', 'unfollows', 4);
    const c = { igId: key, from: '2026-04-01', to: '2026-04-02', prev: { from: '2026-03-30', to: '2026-03-31' } };
    expect(m.kpis.computeKpi('avgViewDuration', c)).toEqual({ value: 105, prev: null, changePct: null });
    expect(m.kpis.computeKpi('newFollowers', c)).toMatchObject({ value: 6 });
    expect(m.kpis.computeKpi('newFollowers', { ...c, from: '2020-01-01', to: '2020-01-02' })).toBeUndefined();
    expect(m.kpis.computeKpi('views', c)).toBeUndefined();
  });

  it('renders the watch-time / formats section (escaped, localized)', async () => {
    const t = NOW - 86_400_000;
    m.media.upsertMedia({ mediaId: 'yt-rep1', igId: 'yt-UCaaa', mediaType: 'VIDEO', mediaProductType: 'YT_SHORT', caption: '<b>x</b>', postedAt: t, postedHour: 1, postedWeekday: 1 });
    m.media.upsertLatest('yt-rep1', { views: 1000, watch_time_min: 600, avg_view_duration_s: 36 }, 1);
    const { fmtDate } = await import('../src/main/analytics/util.js');
    const day = fmtDate(new Date(t));
    const section = m.reports.youtubeReportSections[0];
    const html = section.html({ lang: 'tr', analysis: { platform: 'youtube', kpis: { watchTime: { value: 120 }, avgViewDuration: { value: 95 }, views: { value: 5000 } } }, igId: 'yt-UCaaa', from: day, to: day });
    expect(html).toContain('YouTube izlenme süresi');
    expect(html).toContain('1:35');
    expect(html).toContain('Shorts');
    expect(html).not.toContain('<b>x</b>');
    const [sheet] = section.sheets({ lang: 'en', analysis: { account: { username: 'ch' } }, igId: 'yt-UCaaa', from: day, to: day });
    expect(sheet.rows).toEqual([expect.objectContaining({ type: 'YT_SHORT', posts: 1, views: 1000, watchHours: 10, avgViewDurationS: 36, format: 'Shorts' })]);
  });
});

describe('maintenance (30-day policy) and disconnect', () => {
  it('warns once per channel whose data was not refreshed for 30 days', async () => {
    const events = [];
    const on = (e) => events.push(e);
    m.progress.progressBus.on('token:warning', on);
    try {
      m.accounts.markSynced('yt-UCbbb', Date.now() - 31 * 86_400_000);
      m.accounts.markSynced('yt-UCaaa', Date.now());
      expect((await m.conn.youtubeMaintenance()).stale).toEqual(['yt-UCbbb']);
      await m.conn.youtubeMaintenance();
      expect(events.filter((e) => e.code === 'YT_STALE')).toEqual([expect.objectContaining({ platform: 'google', accountId: 'yt-UCbbb' })]);
    } finally {
      m.progress.progressBus.off('token:warning', on);
    }
  });

  it('disconnect without deleteData revokes and untracks, keeping history', async () => {
    const profile = m.profiles.listProfiles('google', { activeOnly: true }).find((p) => p.external_id === 'UCbbb');
    await m.conn.disconnectChannel({ profileId: profile.id, deleteData: false });
    expect(google.state.revokedTokens).toContain('rt-UCbbb');
    expect(m.profiles.getProfileById(profile.id).is_active).toBe(0);
    expect(m.store.readToken(profile.token_ref)).toBeNull();
    expect(m.accounts.getAccount('yt-UCbbb')).toMatchObject({ isTracked: false });
  });

  it('disconnect with deleteData removes the channel and everything stored for it', async () => {
    const key = 'yt-UCaaa';
    m.media.upsertMedia({ mediaId: 'yt-del1', igId: key, mediaType: 'VIDEO', mediaProductType: 'YT_VIDEO', postedAt: NOW, postedHour: 1, postedWeekday: 1 });
    m.media.insertSnapshotMetric('yt-del1', NOW, 1, 'views', 5);
    m.media.upsertComment({ commentId: 'ytc-del', mediaId: 'yt-del1', username: 'u', text: 't', createdAt: NOW });
    m.accounts.insertSnapshot({ igId: key, date: '2026-04-01', followers: 1 });
    m.accounts.upsertDemographic(key, NOW, 'country', 'TR', 1);
    const profile = m.profiles.listProfiles('google', { activeOnly: true }).find((p) => p.external_id === 'UCaaa');
    await m.conn.disconnectChannel({ profileId: profile.id, deleteData: true });
    expect(m.accounts.getAccount(key)).toBeNull();
    const { q } = await import('../src/main/db/index.js');
    for (const [t, col] of [['media', 'ig_id'], ['account_insights_daily', 'ig_id'], ['account_snapshots', 'ig_id'], ['account_demographics', 'ig_id']]) {
      expect(q.get(`SELECT COUNT(*) AS c FROM ${t} WHERE ${col} = ?`, key).c, t).toBe(0);
    }
    expect(q.get("SELECT COUNT(*) AS c FROM comments WHERE comment_id = 'ytc-del'").c).toBe(0);
    expect(q.get("SELECT COUNT(*) AS c FROM media_insight_snapshots WHERE media_id = 'yt-del1'").c).toBe(0);
    expect(m.accounts.getAccount('ig-keep')).not.toBeNull();
    expect(m.conn.youtubeState().channels).toEqual([]);
    await expect(m.conn.disconnectChannel({ profileId: 999_999 })).rejects.toThrow();
  });
});

describe('demo seed', () => {
  it('seeds two channels with their own demo profiles, videos and daily series', async () => {
    const { rng } = await import('../src/main/seed/random.js');
    const { youtubeDemo, DEMO_CHANNELS } = await import('../src/main/providers/youtube/demo.js');
    const out = youtubeDemo.seed({ now: new Date(NOW), rng: rng(42) });
    expect(out.accounts).toEqual(DEMO_CHANNELS.map((c) => `yt-${c[1]}`));
    const key = out.accounts[0];
    const acc = m.accounts.getAccount(key);
    expect(acc).toMatchObject({ platform: 'youtube', isTracked: true });
    expect(m.profiles.getProfileById(acc.profileId).token_ref).toBe(`demo:google:${DEMO_CHANNELS[0][1]}`);
    const vids = m.media.listMedia({ igIds: [key] });
    expect(vids.length).toBeGreaterThan(20);
    expect(new Set(vids.map((v) => v.mediaProductType))).toEqual(new Set(['YT_SHORT', 'YT_VIDEO', 'YT_LIVE']));
    expect(vids.every((v) => v.durationS > 0 && v.watchTimeMin != null)).toBe(true);
    const today = new Date(NOW).toISOString().slice(0, 10);
    youtubeDemo.extendDay(key, rng(1), today);
    const { q } = await import('../src/main/db/index.js');
    expect(q.get("SELECT value FROM account_insights_daily WHERE ig_id = ? AND date = ? AND metric = 'watch_time_min'", key, today).value).toBeGreaterThan(0);
    expect(m.conn.youtubeState().channels.find((c) => c.accountId === key)).toMatchObject({ tokenOk: true, canReply: true });
  });
});
