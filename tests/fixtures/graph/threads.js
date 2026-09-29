import { json, graphError as err } from '../fakeFetch.js';

/**
 * Fake Threads Graph API (graph.threads.net). Returns a fakeFetch handler: ({ path, query }) → Response | null.
 * @param {{ now?: number, userId?: string, followers?: number, tokenError?: boolean, demographicsError?: boolean }} [opts]
 *   tokenError: every data call answers Graph error 190 (OAuth endpoints still work).
 */
export function threadsGraph({ now = Date.now(), userId = '42', followers = 250, tokenError = false, demographicsError = false } = {}) {
  const iso = (msAgo) => new Date(now - msAgo).toISOString().replace('.000Z', '+0000');
  const day = (msAgo) => new Date(now - msAgo).toISOString().slice(0, 10) + 'T07:00:00+0000';
  const threads = [
    { id: '9001', media_product_type: 'THREADS', media_type: 'TEXT_POST', text: 'Hello #threads', permalink: 'https://www.threads.com/@thready/post/a', timestamp: iso(3 * 3_600_000), shortcode: 'a', is_quote_post: false },
    { id: '9002', media_product_type: 'THREADS', media_type: 'REPOST_FACADE', permalink: 'https://www.threads.com/@x/post/r', timestamp: iso(5 * 3_600_000) },
  ];
  const page2 = [
    { id: '9003', media_product_type: 'THREADS', media_type: 'IMAGE', text: 'Pic', media_url: 'https://cdn/t.jpg', permalink: 'https://www.threads.com/@thready/post/c', timestamp: iso(2 * 86_400_000) },
  ];
  const TOTALS = { likes: 11, replies: 3, reposts: 2, quotes: 1, followers_count: followers };
  return ({ path: p, query: q }) => {
    if (p === '/oauth/access_token') {
      if (q.get('code') === 'bad') return err(100, 'Invalid verification code format.');
      return json({ access_token: 'TH_SHORT', user_id: Number(userId) });
    }
    if (p === '/access_token' && q.get('grant_type') === 'th_exchange_token') {
      if (q.get('access_token') === 'EXPIRED_SHORT_TOKEN_XXXXXXXX') return err(190, 'Error validating access token: Session has expired');
      return json({ access_token: 'TH_LONG', token_type: 'bearer', expires_in: 5_184_000 });
    }
    if (p === '/refresh_access_token' && q.get('grant_type') === 'th_refresh_token') return json({ access_token: 'TH_REFRESHED', token_type: 'bearer', expires_in: 5_184_000 });
    if (tokenError) return err(190, 'Error validating access token: Session has expired', 401);
    if (p === '/me') return json({ id: userId, username: 'thready', name: 'Thready', threads_profile_picture_url: 'https://cdn/p.jpg', threads_biography: 'bio' });
    if (p === `/${userId}/threads`) {
      if (q.get('after') === 'c2') return json({ data: page2 });
      return json({ data: threads, paging: { next: `https://graph.threads.net/v1.0/${userId}/threads?after=c2` } });
    }
    if (p === `/${userId}/threads_insights`) {
      const metrics = q.get('metric').split(',');
      if (metrics[0] === 'follower_demographics') {
        if (demographicsError) return err(100, 'Not enough followers for demographics');
        const b = q.get('breakdown');
        const bucket = { age: '25-34', gender: 'F', country: 'TR', city: 'Istanbul, Istanbul' }[b];
        return json({ data: [{ name: 'follower_demographics', period: 'lifetime', total_value: { breakdowns: [{ dimension_keys: [b], results: [{ dimension_values: [bucket], value: 120 }] }] } }] });
      }
      if (metrics.includes('views')) {
        return json({ data: [{ name: 'views', period: 'day', values: [{ value: 40, end_time: day(2 * 86_400_000) }, { value: 55, end_time: day(86_400_000) }] }] });
      }
      return json({ data: metrics.map((m) => (m === 'clicks'
        ? { name: 'clicks', period: 'day', link_total_values: [{ value: 4, link_url: 'https://a' }, { value: 1, link_url: 'https://b' }] }
        : { name: m, period: 'day', total_value: { value: TOTALS[m] ?? 0 } })) });
    }
    const media = /^\/(\d+)\/insights$/.exec(p);
    if (media) {
      const metrics = q.get('metric').split(',');
      const vals = { views: 900, likes: 30, replies: 6, reposts: 4, quotes: 2, shares: 5 };
      return json({ data: metrics.map((m) => ({ name: m, period: 'lifetime', values: [{ value: vals[m] ?? 0 }] })) });
    }
    return null;
  };
}
