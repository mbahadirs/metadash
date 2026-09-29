/**
 * Facebook Pages provider (chunk B): mappers, metric fallback chain + metric_resolution persistence, page-token
 * handling (prepare / missing token skip), discovery, setup IPC handlers, scopes readiness and ad → post linking.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeFetch, json } from './fixtures/fakeFetch.js';
import { facebookGraph, PAGE_TOKEN } from './fixtures/graph/facebook.js';
import { instagramGraph } from './fixtures/graph/instagram.js';

process.env.METADASH_GRAPH_DELAY_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-fb-'));
const NOW = Date.now();
let routes = [];
const fake = createFakeFetch({ meta: [(r) => routes.reduce((res, h) => res ?? h(r), null)] });

let m;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (input) => fake(input)));
  const { openDb } = await import('../src/main/db/index.js');
  openDb(path.join(dir, 'data.db'));
  m = {
    fb: (await import('../src/main/providers/facebook/index.js')).default,
    mappers: await import('../src/main/providers/facebook/mappers.js'),
    api: await import('../src/main/providers/facebook/api.js'),
    metrics: await import('../src/main/providers/facebook/metrics.js'),
    registry: await import('../src/main/providers/index.js'),
    sync: await import('../src/main/db/queries/sync.js'),
    accounts: await import('../src/main/db/queries/accounts.js'),
    profiles: await import('../src/main/db/queries/profiles.js'),
    tags: await import('../src/main/db/queries/tags.js'),
    store: await import('../src/main/config/store.js'),
    auth: await import('../src/main/meta/auth.js'),
    ads: await import('../src/main/meta/ads.js'),
    errors: await import('../src/main/meta/errors.js'),
    ipc: await import('../src/main/ipc/setup.facebook.handlers.js'),
  };
});
afterAll(async () => { const { closeDb } = await import('../src/main/db/index.js'); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });
beforeEach(() => { routes = [facebookGraph({ now: NOW }), instagramGraph({ now: NOW })]; fake.calls.length = 0; });

const makeCtx = () => ({ tokenFor: () => 'LONG_TOKEN', token: 'LONG_TOKEN', pageTokens: new Map(), log: vi.fn(), settings: {} });
const page1 = { igId: 'fb-p1', platform: 'facebook', externalId: 'p1', name: 'Page 1', username: 'pageone' };

describe('facebook mappers', () => {
  it('maps attachments / status_type to media types', () => {
    const t = m.mappers.mapMediaType;
    expect(t({ attachments: { data: [{ media_type: 'photo', type: 'photo' }] } })).toBe('IMAGE');
    expect(t({ attachments: { data: [{ media_type: 'video', type: 'video_inline' }] } })).toBe('VIDEO');
    expect(t({ attachments: { data: [{ type: 'video_autoplay' }] } })).toBe('VIDEO');
    expect(t({ attachments: { data: [{ media_type: 'album', type: 'album' }] } })).toBe('CAROUSEL_ALBUM');
    expect(t({ attachments: { data: [{ media_type: 'link', type: 'share' }] } })).toBe('LINK');
    expect(t({ status_type: 'mobile_status_update' })).toBe('TEXT');
    expect(t({ status_type: 'added_photos' })).toBe('IMAGE');
    expect(t({})).toBe('TEXT');
  });

  it('maps a post with inline counts and normalized time', () => {
    const post = m.mappers.mapPost({ id: 'p1_9', message: 'hi', created_time: '2026-09-01T10:00:00+0000', permalink_url: 'u', full_picture: 'f', reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } } });
    expect(post).toEqual({ mediaId: 'p1_9', externalId: 'p1_9', mediaType: 'TEXT', mediaProductType: 'FB_POST', caption: 'hi', permalink: 'u', thumbnailUrl: 'f', timestamp: '2026-09-01T10:00:00.000Z', inline: { likes: 7, comments: 2, shares: 0 } });
  });

  it('maps discovered pages (ANALYZE task, linked IG, picture, fan_count fallback)', () => {
    const c = m.mappers.mapDiscoveredPage({ id: '55', page: { name: 'N', picture: { data: { url: 'pic' } }, fan_count: 9, tasks: ['MODERATE'], instagram_business_account: { id: '77' } }, sources: ['me/accounts'] });
    expect(c).toMatchObject({ accountId: 'fb-55', pageId: '55', externalId: '55', name: 'N', username: 'N', pictureUrl: 'pic', followers: 9, linkedIgId: '77', canAnalyze: false });
    expect(m.mappers.canAnalyze(['ANALYZE'])).toBe(true);
    expect(m.mappers.canAnalyze(undefined)).toBe(true); // BM edges carry no tasks
  });

  it('sums reactions into likes and parses insights rows', () => {
    expect(m.mappers.sumReactions({ like: 3, love: 2, wow: 1 })).toBe(6);
    expect(m.mappers.sumReactions(5)).toBe(5);
    expect(m.mappers.sumReactions(null)).toBeNull();
    const vals = m.mappers.parsePostInsightRows([
      { name: 'post_reactions_by_type_total', values: [{ value: { like: 4, haha: 1 } }] },
      { name: 'post_media_view', values: [{ value: 90 }] },
      { name: 'other', values: [{ value: 1 }] },
    ], { post_reactions_by_type_total: 'likes', post_media_view: 'views' });
    expect(vals).toEqual({ likes: 5, views: 90 });
    const series = m.mappers.parseDailyRows([{ name: 'page_media_view', values: [{ value: 3, end_time: '2026-09-02T07:00:00+0000' }] }], { page_media_view: 'views' });
    expect(series).toEqual({ views: [{ date: '2026-09-02', value: 3 }] });
  });

  it('the provider is registered and implements the interface', () => {
    const fb = m.registry.getProvider('facebook');
    expect(fb).toBe(m.fb);
    expect(fb).toMatchObject({ platform: 'facebook', auth: 'meta', concurrency: 2, primaryMetric: 'reach', labelSuffix: ' (FB)', enabled: true });
    expect(fb.accountKey('123')).toBe('fb-123');
    for (const fn of ['discover', 'prepare', 'fetchProfile', 'fetchPosts', 'fetchPostInsights', 'fetchDailyInsights']) expect(typeof fb[fn]).toBe('function');
    expect(fb.dailyWindow.windowDays * 3).toBeLessThanOrEqual(90);
  });
});

describe('isolatingRequest', () => {
  const MetaErr = (message) => new m.errors.MetaError({ code: 100, message });
  it('pins an unnamed invalid-metric error on the right metric and caches single results', async () => {
    const seen = [];
    const fetchMany = async (names) => {
      seen.push(names.join(','));
      if (names.includes('met_b')) throw MetaErr('(#100) The value must be a valid insights metric');
      return names.map((name) => ({ name }));
    };
    const req = m.api.isolatingRequest(fetchMany);
    await expect(req(['met_a', 'met_b', 'met_c'])).rejects.toThrow(/\[metric: met_b\]/);
    expect(seen).toEqual(['met_a,met_b,met_c', 'met_a', 'met_b', 'met_c']);
    const rows = await req(['met_a', 'met_b2', 'met_c']); // fallback candidate for met_b; the others come from cache
    expect(rows.map((r) => r.name)).toEqual(['met_a', 'met_b2', 'met_c']);
    expect(seen.slice(4)).toEqual(['met_b2']);
  });

  it('passes named errors through untouched and rethrows other errors', async () => {
    const named = m.api.isolatingRequest(async () => { throw MetaErr('(#100) metric "b" is not supported'); });
    await expect(named(['a', 'b'])).rejects.toThrow('(#100) metric "b" is not supported');
    const other = m.api.isolatingRequest(async () => { throw new m.errors.MetaError({ code: 10, message: 'perm' }); });
    await expect(other(['a'])).rejects.toMatchObject({ code: 10 });
  });
});

describe('facebook provider against the fake Graph API', () => {
  it('discovers pages via shared metaPages (opt-in data, linked IG, canAnalyze)', async () => {
    const { items, warnings } = await m.fb.discover(makeCtx());
    expect(items.map((i) => i.accountId).sort()).toEqual(['fb-p1', 'fb-p2', 'fb-p3']);
    expect(items.find((i) => i.pageId === 'p1')).toMatchObject({ name: 'Page 1', username: 'pageone', followers: 5000, linkedIgId: 'ig1', canAnalyze: true, pictureUrl: 'https://cdn/p1.jpg' });
    expect(items.find((i) => i.pageId === 'p2')).toMatchObject({ linkedIgId: null, canAnalyze: false, followers: 80 });
    expect(items.find((i) => i.pageId === 'p3')).toMatchObject({ linkedIgId: 'ig3', canAnalyze: true });
    expect(warnings.map((w) => w.endpoint)).toEqual(['/biz1/client_pages']);
  });

  it('prepare caches the page token; a page without a token is skipped with a permission-class error', async () => {
    const ctx = makeCtx();
    await m.fb.prepare(ctx, page1);
    expect(ctx.pageTokens.get('p1')).toBe(PAGE_TOKEN);
    await m.fb.prepare(ctx, page1);
    expect(fake.calls.filter((c) => c === '/p1')).toHaveLength(1);
    const err = await m.fb.prepare(ctx, { igId: 'fb-p2', externalId: 'p2', username: 'Page w/o IG' }).catch((e) => e);
    expect(err).toBeInstanceOf(m.errors.MetaError);
    expect(err.isTokenError).toBe(false);
    expect(err.code).toBe(10);
    expect(err.message).toContain('Page w/o IG');
    await expect(m.fb.fetchProfile(ctx, { externalId: 'p2', username: 'x' })).rejects.toMatchObject({ code: 10 });
  });

  it('fetches profile, posts (paged, mapped) and post insights with the page token', async () => {
    const ctx = makeCtx();
    await m.fb.prepare(ctx, page1);
    expect(await m.fb.fetchProfile(ctx, page1)).toMatchObject({ username: 'pageone', name: 'Page 1', followers: 5100, biography: 'About page one', website: 'https://pageone.example', profilePicUrl: 'https://cdn/p1.jpg' });
    const posts = await m.fb.fetchPosts(ctx, page1, { sinceUnix: Math.floor(NOW / 1000) - 30 * 86_400 });
    expect(posts.map((p) => [p.mediaId, p.mediaType])).toEqual([['p1_101', 'IMAGE'], ['p1_102', 'VIDEO'], ['p1_103', 'CAROUSEL_ALBUM'], ['p1_104', 'LINK'], ['p1_105', 'TEXT']]);
    expect(posts[0]).toMatchObject({ mediaProductType: 'FB_POST', caption: 'Photo post #fb', inline: { likes: 39, comments: 6, shares: 4 } });
    const { values, dropped } = await m.fb.fetchPostInsights(ctx, { mediaId: 'p1_101', externalId: 'p1_101' }, { account: page1 });
    expect(values).toEqual({ likes: 40, comments: 6, shares: 4, views: 900, reach: 700, clicks: 15 });
    expect(dropped).toEqual([]);
    expect(m.sync.getMetricResolution('facebook', 'media', 'views')).toMatchObject({ apiName: 'post_media_view', status: 'ok' });
  });

  it('post insights without insights permission still return counts and warn once', async () => {
    routes = [facebookGraph({ now: NOW, postPermissionError: true })];
    const ctx = makeCtx();
    await m.fb.prepare(ctx, page1);
    const a = await m.fb.fetchPostInsights(ctx, { externalId: 'p1_101' }, { account: page1 });
    await m.fb.fetchPostInsights(ctx, { externalId: 'p1_102' }, { account: page1 });
    expect(a.values).toEqual({ likes: 39, comments: 6, shares: 4 });
    expect(ctx.log).toHaveBeenCalledTimes(1);
    expect(ctx.log.mock.calls[0][0]).toMatchObject({ igId: 'fb-p1', platform: 'facebook', code: 10 });
  });

  it('daily insights fall back per metric, persist resolutions and later request only resolved names', async () => {
    // page_media_view rejected by name → views falls back to page_impressions; two unnamed rejections are isolated.
    const named = ({ path: p, query: q }) => (p === '/p1/insights' && q.get('metric').split(',').includes('page_media_view')
      ? json({ error: { code: 100, message: '(#100) The metric page_media_view is not supported', type: 'OAuthException' } }, 400) : null);
    routes = [named, facebookGraph({ now: NOW })];
    const ctx = makeCtx();
    await m.fb.prepare(ctx, page1);
    const since = Math.floor(NOW / 1000) - 5 * 86_400;
    const { series, dropped } = await m.fb.fetchDailyInsights(ctx, page1, { sinceUnix: since, untilUnix: Math.floor(NOW / 1000) });
    expect(Object.keys(series).sort()).toEqual(['follower_count', 'followers_total', 'post_engagements', 'reach', 'views']);
    expect(series.followers_total.at(-1).value).toBe(5100);
    expect(dropped.map((d) => d.metric).sort()).toEqual(['profile_views', 'unfollows']);
    const res = Object.fromEntries(m.sync.listMetricResolution('facebook').filter((r) => r.scope === 'account').map((r) => [r.canonical, [r.status, r.apiName]]));
    expect(res).toMatchObject({ views: ['ok', 'page_impressions'], reach: ['ok', 'page_total_media_view_unique'], profile_views: ['unsupported', null], unfollows: ['unsupported', null] });

    fake.calls.length = 0;
    await m.fb.fetchDailyInsights(ctx, page1, { sinceUnix: since, untilUnix: Math.floor(NOW / 1000) });
    const insightCalls = fake.calls.filter((c) => c.startsWith('/p1/insights'));
    expect(insightCalls).toHaveLength(1);
    expect(insightCalls[0]).not.toMatch(/page_views_total|page_daily_unfollows_unique|page_media_view/);
    expect(insightCalls[0]).toContain('page_impressions');
    for (const key of ['views', 'profile_views', 'unfollows']) m.sync.enableMetric(key, { platform: 'facebook', scope: 'account' });
  });

  it('a daily-insights permission error is logged once (ANALYZE hint) and yields no data', async () => {
    routes = [({ path: p }) => (p === '/p1/insights' ? json({ error: { code: 10, message: '(#10) Not enough permission', type: 'OAuthException' } }, 400) : null), facebookGraph({ now: NOW })];
    const ctx = makeCtx();
    await m.fb.prepare(ctx, page1);
    const w = { sinceUnix: Math.floor(NOW / 1000) - 86_400, untilUnix: Math.floor(NOW / 1000) };
    expect(await m.fb.fetchDailyInsights(ctx, page1, w)).toEqual({ series: {}, dropped: [] });
    expect(await m.fb.fetchDailyInsights(ctx, page1, w)).toEqual({ series: {}, dropped: [] });
    expect(ctx.log).toHaveBeenCalledTimes(1);
    expect(ctx.log.mock.calls[0][0].message).toMatch(/ANALYZE/);
  });
});

describe('scopes', () => {
  it('read_insights is optional; platformReadiness reports facebook separately', async () => {
    expect(m.auth.OPTIONAL_SCOPES).toContain('read_insights');
    expect(m.auth.REQUIRED_SCOPES).not.toContain('read_insights');
    const h = await m.auth.debugToken('LONG_TOKEN'); // IG fixture grants no read_insights
    expect(h.platformReadiness).toEqual({ instagram: true, facebook: false });
    expect(m.auth.missingScopesFor('facebook', h.scopes)).toEqual(['read_insights']);
    expect(m.auth.platformReadiness(['pages_show_list', 'pages_read_engagement', 'read_insights'])).toMatchObject({ facebook: true, instagram: false });
  });
});

describe('setup:facebook IPC', () => {
  const handlers = new Map();
  beforeAll(() => m.ipc.registerFacebookSetupHandlers((ch, fn) => handlers.set(ch, fn)));

  it('keeps the channel list', () => {
    expect([...handlers.keys()]).toEqual(m.ipc.FACEBOOK_SETUP_CHANNELS);
  });

  it('discovers pages as untracked accounts and reports missing scopes', async () => {
    const id = m.profiles.upsertProfile({ label: 'Meta', appId: '123', tokenRef: m.store.storeToken('profile:123', 'LONG_TOKEN'), tokenExpiresAt: NOW + 86_400_000 });
    m.accounts.upsertAccount({ igId: 'ig1', profileId: id, username: 'brand_one', clientName: 'Acme' });
    m.tags.setAccountTags('ig1', [m.tags.findOrCreateTag('retail').id]);
    const out = await handlers.get('setup:facebook:discover')();
    expect(out.missingScopes).toEqual(['read_insights']);
    expect(out.items.find((i) => i.accountId === 'fb-p1')).toMatchObject({ pageId: 'p1', linkedIgId: 'ig1', canAnalyze: true, tracked: false, known: false });
    expect(m.accounts.getAccount('fb-p1')).toMatchObject({ platform: 'facebook', externalId: 'p1', linkedAccountId: 'ig1', isTracked: false, followers: 5000 });
    expect(m.accounts.listAccounts({ platforms: ['facebook'] })).toEqual([]); // opt-in
    const again = await handlers.get('setup:facebook:discover')();
    expect(again.items.find((i) => i.accountId === 'fb-p1').known).toBe(true);
  });

  it('saves tracked pages (platform-scoped) and inherits client/tags from the linked IG account', () => {
    expect(handlers.get('setup:facebook:saveTracked')({ accountIds: ['fb-p1', 'fb-p2'], meta: { 'fb-p2': { clientName: 'Other', tags: ['local'] } } })).toEqual({ tracked: 2 });
    expect(m.accounts.getAccount('fb-p1')).toMatchObject({ isTracked: true, clientName: 'Acme' });
    expect(m.accounts.getAccount('fb-p1').tagIds).toEqual(m.accounts.getAccount('ig1').tagIds);
    expect(m.accounts.getAccount('fb-p2')).toMatchObject({ isTracked: true, clientName: 'Other' });
    expect(m.accounts.getAccount('ig1').isTracked).toBe(true); // Instagram untouched
    handlers.get('setup:facebook:saveTracked')({ accountIds: ['fb-p1'] });
    expect(m.accounts.getAccount('fb-p2').isTracked).toBe(false);
    expect(() => handlers.get('setup:facebook:saveTracked')({ accountIds: ['ig1'] })).toThrow();
    expect(() => handlers.get('setup:facebook:saveTracked')({ accountIds: ['fb-nope'] })).toThrow();
    expect(() => handlers.get('setup:facebook:saveTracked')({})).toThrow();
  });
});

describe('ads → Facebook post links', () => {
  it('links effective_object_story_id when there is no Instagram media id', async () => {
    routes = [({ path: p }) => (p === '/act_9/ads' ? json({ data: [
      { id: 'a1', name: 'IG ad', creative: { effective_instagram_media_id: 'm1', instagram_permalink_url: 'ig', effective_object_story_id: 'p1_101' } },
      { id: 'a2', name: 'FB ad', creative: { effective_object_story_id: 'p1_102' } },
      { id: 'a3', name: 'no creative' },
    ] }) : null)];
    const links = await m.ads.fetchAdMediaLinks('act_9', 'LONG_TOKEN');
    expect(links).toEqual([
      { actId: 'act_9', adId: 'a1', adName: 'IG ad', mediaId: 'm1', permalink: 'ig' },
      { actId: 'act_9', adId: 'a2', adName: 'FB ad', mediaId: 'p1_102', permalink: null },
    ]);
  });
});
