/**
 * Provider layer (chunk A): registry, capabilities, shared helpers (metricFallback, insights, metaPages),
 * platforms:list info, NOT_IMPLEMENTED setup stubs and the extended interactions() formula.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { listProviders, getProvider, isPlatformEnabled, ALL_PLATFORMS, __setProviderForTests } from '../src/main/providers/index.js';
import { accountKeyFor, platformOfKey, capabilitiesFor, primaryMetricFor } from '../src/main/providers/capabilities.js';
import { fetchWithFallback, candidatesFor, toCanonical } from '../src/main/providers/shared/metricFallback.js';
import { fetchInsightsDaily } from '../src/main/providers/shared/insights.js';
import { discoverMetaPages } from '../src/main/providers/shared/metaPages.js';
import { needsRefresh } from '../src/main/providers/shared/tiers.js';
import { needsRefresh as legacyNeedsRefresh } from '../src/main/sync/jobs/organicAccount.js';
import { listPlatformInfo } from '../src/main/providers/platformInfo.js';
import { getMetricResolution, listDisabledMetrics } from '../src/main/db/queries/sync.js';
import { upsertProfile } from '../src/main/db/queries/profiles.js';
import { upsertAccount } from '../src/main/db/queries/accounts.js';
import { registerFacebookSetupHandlers, FACEBOOK_SETUP_CHANNELS } from '../src/main/ipc/setup.facebook.handlers.js';
import { registerThreadsSetupHandlers, THREADS_SETUP_CHANNELS } from '../src/main/ipc/setup.threads.handlers.js';
import { interactions, erByFollowers } from '../src/main/analytics/engagement.js';
import { MetaError } from '../src/main/meta/errors.js';
import { notImplemented } from '../src/main/ipc/notImplemented.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-providers-'));
beforeAll(() => openDb(path.join(dir, 'data.db')));
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

const invalid = (message) => new MetaError({ code: 100, message });

describe('provider registry', () => {
  it('lists enabled providers in registration order', () => {
    expect(ALL_PLATFORMS).toEqual(['instagram', 'facebook', 'threads', 'youtube', 'tiktok']);
    expect(listProviders().map((p) => p.platform)).toEqual(['instagram', 'facebook', 'threads', 'youtube', 'tiktok']);
    expect(getProvider('instagram')).toMatchObject({ platform: 'instagram', auth: 'meta', concurrency: 2, primaryMetric: 'reach', enabled: true });
    expect(getProvider('facebook')).toMatchObject({ platform: 'facebook', auth: 'meta', concurrency: 2, primaryMetric: 'reach', enabled: true });
    expect(getProvider('threads')).toMatchObject({ platform: 'threads', enabled: true });
    expect(getProvider('youtube')).toMatchObject({ platform: 'youtube', auth: 'google', enabled: true });
    expect(getProvider('tiktok')).toMatchObject({ platform: 'tiktok', auth: 'tiktok', enabled: true });
    expect(getProvider('nope')).toBeNull();
    expect(isPlatformEnabled('instagram')).toBe(true);
  });

  it('the instagram provider implements the required interface', () => {
    const ig = getProvider('instagram');
    for (const fn of ['accountKey', 'discover', 'fetchProfile', 'fetchDailyInsights', 'fetchPosts', 'fetchPostInsights', 'skipInsights', 'fetchDemographics', 'fetchComments']) {
      expect(typeof ig[fn]).toBe('function');
    }
    expect(ig.accountKey(123)).toBe('123');
    expect(ig.skipInsights({ mediaProductType: 'STORY' })).toBe(true);
    expect(ig.skipInsights({ mediaProductType: 'FEED' })).toBe(false);
    expect(ig.dailyWindow).toMatchObject({ windowDays: 30, maxLookbackDays: 90 });
  });

  it('test override can enable a platform and be restored', () => {
    __setProviderForTests('facebook', null);
    expect(listProviders().map((p) => p.platform)).toEqual(['instagram', 'threads', 'youtube', 'tiktok']);
    const fake = { platform: 'threads', enabled: true, auth: 'threads', concurrency: 1 };
    __setProviderForTests('threads', fake);
    expect(getProvider('threads')).toBe(fake);
    __setProviderForTests('facebook', undefined);
    __setProviderForTests('threads', undefined);
    expect(getProvider('facebook')).toMatchObject({ platform: 'facebook', enabled: true });
    expect(getProvider('threads')).not.toBe(fake);
  });
});

describe('capabilities and keys', () => {
  it('builds and parses account keys', () => {
    expect(accountKeyFor('instagram', '1784')).toBe('1784');
    expect(accountKeyFor('facebook', '99')).toBe('fb-99');
    expect(accountKeyFor('threads', '42')).toBe('th-42');
    expect(platformOfKey('fb-99')).toBe('facebook');
    expect(platformOfKey('th-42')).toBe('threads');
    expect(platformOfKey('1784')).toBe('instagram');
  });
  it('exposes capabilities and primary metric per platform', () => {
    expect(capabilitiesFor('threads')).toMatchObject({ reach: false, demographics: true, stories: false });
    expect(capabilitiesFor('facebook')).toMatchObject({ reach: true, saveRate: false, ads: true });
    expect(primaryMetricFor('threads')).toBe('views');
    expect(primaryMetricFor('facebook')).toBe('reach');
  });
});

describe('tiers', () => {
  it('needsRefresh is shared and still exported from organicAccount.js', () => {
    expect(legacyNeedsRefresh).toBe(needsRefresh);
    expect(needsRefresh(10, Date.now(), Date.now(), { recent: 24, month: 168, old: 720 })).toBe(true);
  });
});

describe('metricFallback', () => {
  const MAP = { views: ['page_media_view', 'page_impressions'], reach: ['page_total_media_view_unique', 'page_impressions_unique'], profile_views: ['page_views_total'] };

  it('walks the candidate chain, persists the winners and marks exhausted metrics unsupported', async () => {
    const requested = [];
    const request = vi.fn(async (names) => {
      requested.push([...names]);
      if (names.includes('page_media_view')) throw invalid('(#100) The value must be a valid insights metric: page_media_view');
      if (names.includes('page_views_total')) throw invalid('(#100) page_views_total is not supported');
      return { data: names.map((n) => ({ name: n, value: 1 })) };
    });
    const out = await fetchWithFallback({ platform: 'facebook', scope: 'account', map: MAP, request, delay: async () => {} });
    expect(requested).toEqual([
      ['page_media_view', 'page_total_media_view_unique', 'page_views_total'],
      ['page_impressions', 'page_total_media_view_unique', 'page_views_total'],
      ['page_impressions', 'page_total_media_view_unique'],
    ]);
    expect(out.resolved).toEqual({ views: 'page_impressions', reach: 'page_total_media_view_unique' });
    expect(out.apiToCanonical).toEqual({ page_impressions: 'views', page_total_media_view_unique: 'reach' });
    expect(out.dropped).toEqual([{ metric: 'profile_views', apiName: 'page_views_total', message: '(#100) page_views_total is not supported' }]);
    expect(getMetricResolution('facebook', 'account', 'views')).toMatchObject({ apiName: 'page_impressions', status: 'ok' });
    expect(getMetricResolution('facebook', 'account', 'profile_views')).toMatchObject({ apiName: null, status: 'unsupported' });
    expect(listDisabledMetrics().find((d) => d.platform === 'facebook')).toMatchObject({ metric: 'profile_views', scope: 'account' });
    expect(toCanonical({ page_impressions: 5, other: 1 }, out.apiToCanonical)).toEqual({ views: 5, other: 1 });
  });

  it('later calls start with the resolved name and skip unsupported metrics', async () => {
    expect(candidatesFor('facebook', 'account', 'views', MAP.views)).toEqual(['page_impressions', 'page_media_view']);
    expect(candidatesFor('facebook', 'account', 'profile_views', MAP.profile_views)).toEqual([]);
    const request = vi.fn(async (names) => names);
    const out = await fetchWithFallback({ platform: 'facebook', scope: 'account', map: MAP, request });
    expect(request).toHaveBeenCalledTimes(1);
    expect(out.result).toEqual(['page_impressions', 'page_total_media_view_unique']);
  });

  it('keeps scopes and platforms separate, rethrows non-parameter errors and can skip persistence', async () => {
    expect(candidatesFor('facebook', 'media', 'views', MAP.views)).toEqual(MAP.views);
    expect(candidatesFor('threads', 'account', 'views', ['views'])).toEqual(['views']);
    await expect(fetchWithFallback({ platform: 'threads', scope: 'account', map: { views: ['views'] }, request: async () => { throw new MetaError({ code: 190, message: 'expired' }); } }))
      .rejects.toMatchObject({ code: 190 });
    const out = await fetchWithFallback({ platform: 'threads', scope: 'media', map: { likes: ['likes'] }, request: async () => { throw invalid('likes nope'); }, persist: false });
    expect(out).toMatchObject({ result: null, dropped: [{ metric: 'likes' }] });
    expect(getMetricResolution('threads', 'media', 'likes')).toBeNull();
  });
});

describe('shared insights loop', () => {
  const day = Math.floor(Date.UTC(2026, 8, 1) / 1000);
  it('supports total_value-only metrics per day (Threads style) with custom params', async () => {
    const calls = [];
    const client = {
      get: vi.fn(async (p, params) => {
        calls.push(params);
        if (params.metric_type === 'time_series') return { data: [{ name: 'views', values: [{ end_time: '2026-09-01T07:00:00+0000', value: 9 }] }] };
        return { data: params.metric.split(',').map((m) => ({ name: m, total_value: { value: 2 } })) };
      }),
      delay: async () => {},
    };
    const { series, dropped } = await fetchInsightsDaily(client, '/u/threads_insights', ['views'], { sinceUnix: day, untilUnix: day + 2 * 86_400, totalOnly: ['likes', 'replies'] });
    expect(series.views).toEqual([{ date: '2026-09-01', value: 9 }]);
    expect(series.likes).toEqual([{ date: '2026-09-01', value: 2 }, { date: '2026-09-02', value: 2 }]);
    expect(dropped).toEqual([]);
    expect(calls.filter((c) => c.metric_type === 'total_value').map((c) => c.metric)).toEqual(['likes,replies', 'likes,replies']);
  });
  it('timeSeries:false fetches every metric per day', async () => {
    const client = { get: vi.fn(async (p, params) => ({ data: params.metric.split(',').map((m) => ({ name: m, values: [{ value: 4 }] })) })), delay: async () => {} };
    const { series } = await fetchInsightsDaily(client, '/x/insights', ['a'], { sinceUnix: day, untilUnix: day + 86_400, timeSeries: false, totalParams: {} });
    expect(series.a).toEqual([{ date: '2026-09-01', value: 4 }]);
    expect(client.get).toHaveBeenCalledTimes(1);
  });
});

describe('metaPages traversal', () => {
  it('merges pages from /me/accounts and Business Manager and reports failing edges', async () => {
    const data = {
      '/me/accounts': [{ id: 'p1', name: 'Page 1', fan_count: 10 }],
      '/me/businesses': [{ id: 'b1', name: 'BM' }],
      '/b1/owned_pages': [{ id: 'p1', name: 'Page 1', followers_count: 12 }, { id: 'p2', name: 'Page 2' }],
    };
    const client = {
      getAll: async (p) => { if (!data[p]) throw new MetaError({ code: 200, message: 'nope' }); return data[p]; },
      delay: async () => {},
    };
    const onBusiness = vi.fn(async () => [{ endpoint: 'extra' }]);
    const { pages, businesses, warnings } = await discoverMetaPages({ token: 't', fields: 'id,name', client, onBusiness });
    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(pages[0]).toMatchObject({ page: { fan_count: 10, followers_count: 12 }, sources: ['me/accounts', 'BM · owned_pages'] });
    expect(businesses).toEqual([{ id: 'b1', name: 'BM' }]);
    expect(warnings.map((w) => w.endpoint)).toEqual(['/b1/client_pages', 'extra']);
    expect(onBusiness).toHaveBeenCalledTimes(1);
  });
});

describe('platforms:list info', () => {
  it('reports every platform with connection state and tracked counts', () => {
    const id = upsertProfile({ label: 'Meta', appId: '1', tokenRef: 'token:x' });
    upsertAccount({ igId: '1', profileId: id, username: 'a' });
    upsertAccount({ igId: 'fb-2', platform: 'facebook', externalId: '2', profileId: id, username: 'b' });
    const rows = listPlatformInfo();
    expect(rows.map((r) => r.platform)).toEqual(ALL_PLATFORMS);
    expect(rows[0]).toMatchObject({ label: 'Instagram', enabled: true, auth: 'meta', connected: true, trackedCount: 1, primaryMetric: 'reach' });
    expect(rows[1]).toMatchObject({ enabled: true, connected: true, trackedCount: 1 });
    expect(rows[2]).toMatchObject({ enabled: true, auth: 'threads', connected: false, trackedCount: 0, primaryMetric: 'views' });
    expect(rows[2].capabilities.reach).toBe(false);
  });
});

describe('setup channels', () => {
  it('registers every Facebook/Threads channel; notImplemented() is localized', async () => {
    const handlers = new Map();
    const handle = (channel, fn) => handlers.set(channel, fn);
    registerFacebookSetupHandlers(handle);
    registerThreadsSetupHandlers(handle);
    expect([...handlers.keys()]).toEqual([...FACEBOOK_SETUP_CHANNELS, ...THREADS_SETUP_CHANNELS]);
    expect(THREADS_SETUP_CHANNELS).toContain('setup:threads:exchangeToken');
    const e = notImplemented();
    expect(e.message).toMatch(/not available/);
    expect(e.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('interactions()', () => {
  it('adds reposts and quotes, counting nulls as 0 — Instagram values unchanged', () => {
    const ig = { likes: 10, comments: 2, saved: 3, shares: 1 };
    expect(interactions(ig)).toBe(16);
    expect(interactions({ ...ig, reposts: null, quotes: undefined })).toBe(16);
    expect(interactions({ likes: 5, comments: 2, shares: 1, reposts: 3, quotes: 4, clicks: 100 })).toBe(15);
    expect(erByFollowers({ likes: 5, reposts: 5 }, 100)).toBe(10);
  });
});
