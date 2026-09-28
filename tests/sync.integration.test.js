/**
 * End-to-end sync against a fake Graph API: exercises the real orchestrator, jobs, metric adaptor,
 * error handling (unsupported metric, total_value-only metric, paging) and DB writes — no demo profile.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.METADASH_GRAPH_DELAY_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-sync-'));
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const calls = [];

function graph(url) {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/v\d+\.\d+/, '');
  const q = u.searchParams;
  calls.push(p + (q.get('metric') ? `?metric=${q.get('metric')}` : ''));
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-app-usage': JSON.stringify({ call_count: 12, total_time: 5, total_cputime: 3 }) } });
  const err = (code, message) => json({ error: { code, message, type: 'OAuthException' } }, 400);

  if (p === '/oauth/access_token') return json({ access_token: 'LONG_TOKEN', token_type: 'bearer', expires_in: 5184000 });
  if (p === '/debug_token') return json({ data: { is_valid: true, app_id: '123', user_id: '9', expires_at: Math.floor(NOW / 1000) + 5184000, scopes: ['instagram_basic', 'instagram_manage_insights', 'pages_show_list', 'pages_read_engagement', 'ads_read'] } });
  if (p === '/me/accounts') return json({ data: [{ id: 'p1', name: 'Page 1', instagram_business_account: { id: 'ig1', username: 'brand_one', name: 'Brand One', followers_count: 12000, follows_count: 300, media_count: 40 } }, { id: 'p2', name: 'Page w/o IG' }] });
  if (p === '/me/businesses') return json({ data: [{ id: 'biz1', name: 'Ajans BM' }] });
  if (p === '/biz1/owned_pages') return json({ data: [{ id: 'p1', name: 'Page 1', instagram_business_account: { id: 'ig1', username: 'brand_one' } }, { id: 'p3', name: 'BM Page', instagram_business_account: { id: 'ig3', username: 'bm_brand', followers_count: 500 } }] });
  if (p === '/biz1/client_pages') return err(200, '(#200) Requires business_management permission');
  if (p === '/biz1/owned_instagram_accounts') return json({ data: [{ id: 'ig9', username: 'standalone_ig', followers_count: 42 }] });
  if (p === '/biz1/client_instagram_accounts') return json({ data: [] });
  if (p === '/ig1') return json({ id: 'ig1', username: 'brand_one', name: 'Brand One', followers_count: 12050, follows_count: 300, media_count: 41, biography: 'bio' });
  if (p === '/ig1/media') {
    if (q.get('after') === 'cursor2') return json({ data: [{ id: 'm3', caption: 'old #c', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', permalink: 'https://instagram.com/p/m3', timestamp: iso(10 * 86_400_000), like_count: 5, comments_count: 1 }] });
    return json({ data: [
      { id: 'm1', caption: 'Hello #a @x 🎉', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://instagram.com/p/m1', timestamp: iso(3 * 3_600_000), like_count: 10, comments_count: 2, thumbnail_url: 'https://cdn/x.jpg' },
      { id: 'm2', caption: 'Second #b', media_type: 'IMAGE', media_product_type: 'FEED', permalink: 'https://instagram.com/p/m2', timestamp: iso(3 * 86_400_000), like_count: 20, comments_count: 4 },
    ], paging: { next: `https://graph.facebook.com/v21.0/ig1/media?after=cursor2&access_token=t` } });
  }
  if (/^\/m\d\/insights$/.test(p)) {
    const metrics = q.get('metric').split(',');
    if (metrics.includes('shares') && p === '/m2/insights') return err(100, '(#100) The following metrics are not supported for this media product type: shares');
    return json({ data: metrics.map((m) => ({ name: m, values: [{ value: m === 'reach' ? 1000 : m === 'views' ? 1800 : 50 }] })) });
  }
  if (p === '/ig1/insights') {
    const metrics = q.get('metric').split(',');
    if (metrics.includes('follower_count')) return json({ data: [{ name: 'follower_count', values: [{ end_time: iso(86_400_000), value: 12 }] }] });
    if (metrics.includes('audience_city') || metrics.includes('audience_gender_age') || metrics.includes('audience_country')) {
      const m = metrics[0];
      if (m === 'audience_country') return err(100, 'metric audience_country is not supported');
      return json({ data: [{ name: m, total_value: { breakdowns: [{ results: [{ dimension_values: [m === 'audience_city' ? 'Istanbul' : 'F.25-34'], value: 500 }] }] } }] });
    }
    if (q.get('metric_type') === 'time_series') {
      if (metrics.includes('profile_views')) return err(100, '(#100) The metric profile_views must be requested with metric_type=total_value');
      if (metrics.includes('accounts_engaged')) return err(100, '(#100) accounts_engaged requires metric_type=total_value');
      return json({ data: metrics.map((m) => ({ name: m, values: [{ end_time: iso(2 * 86_400_000), value: 400 }, { end_time: iso(86_400_000), value: 420 }] })) });
    }
    return json({ data: metrics.map((m) => ({ name: m, total_value: { value: m === 'profile_views' ? 33 : 77 } })) });
  }
  if (p === '/ig1/stories') return json({ data: [{ id: 's1', media_type: 'IMAGE', timestamp: iso(2 * 3_600_000) }] });
  if (p === '/s1/insights') return json({ data: [{ name: 'reach', values: [{ value: 300 }] }, { name: 'views', values: [{ value: 320 }] }, { name: 'replies', values: [{ value: 4 }] }, { name: 'navigation', total_value: { breakdowns: [{ results: [{ dimension_values: ['tap_forward'], value: 200 }, { dimension_values: ['tap_exit'], value: 30 }] }] } }] });
  if (p === '/me/adaccounts') return json({ data: [{ id: 'act_1', account_id: '1', name: 'Ads 1', currency: 'TRY', account_status: 1 }] });
  if (p === '/act_1/insights') {
    const level = q.get('level');
    const bd = q.get('breakdowns');
    const row = { date_start: iso(86_400_000).slice(0, 10), date_stop: iso(86_400_000).slice(0, 10), spend: '100.5', impressions: '5000', reach: '3000', clicks: '80', ctr: '1.6', cpc: '1.25', cpm: '20.1', actions: [{ action_type: 'link_click', value: '80' }, { action_type: 'purchase', value: '3' }, { action_type: 'post_engagement', value: '150' }, { action_type: 'page_engagement', value: '170' }], cost_per_action_type: [{ action_type: 'purchase', value: '33.5' }] };
    if (bd) return json({ data: [{ ...row, [bd]: bd === 'age' ? '25-34' : bd === 'gender' ? 'female' : 'instagram' }] });
    return json({ data: [{ ...row, campaign_id: 'c1', campaign_name: 'Camp', adset_id: 'as1', adset_name: 'Set', ad_id: 'ad1', ad_name: 'Ad' }].map((r) => (level === 'account' ? r : r)) });
  }
  if (p === '/act_1/ads') return json({ data: [{ id: 'ad1', name: 'Ad', creative: { effective_instagram_media_id: 'm1' } }] });
  if (p === '/ig1' || p.startsWith('/ig1?')) return json({});
  return err(803, `unhandled ${p}`);
}

let mod;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (input) => graph(typeof input === 'string' ? input : input.toString())));
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
