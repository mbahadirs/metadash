import { json, graphError as err } from '../fakeFetch.js';

/**
 * Fake Instagram / Meta Graph API used by the sync parity test (extracted verbatim from sync.integration.test.js).
 * Returns a fakeFetch handler: ({ path, query }) → Response | null.
 * @param {{ now?: number }} [opts]  `now` anchors every timestamp
 */
export function instagramGraph({ now = Date.now() } = {}) {
  const NOW = now;
  const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
  return ({ path: p, query: q }) => {
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
      ], paging: { next: `https://graph.facebook.com/v26.0/ig1/media?after=cursor2&access_token=t` } });
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
    return null;
  };
}
