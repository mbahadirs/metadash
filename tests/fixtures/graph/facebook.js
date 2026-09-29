import { json, graphError as err } from '../fakeFetch.js';

export const PAGE_TOKEN = 'PAGE_TOKEN_P1';
const REACTIONS = { like: 30, love: 8, haha: 2 }; // sum 40

/**
 * Fake Facebook Pages Graph API. Put it BEFORE instagramGraph: it only answers `/me/accounts` when the request asks for
 * Page `tasks` (Facebook discovery) and leaves everything Instagram-specific to the Instagram handler.
 *
 * Pages: p1 (ANALYZE, linked to ig1, page token PAGE_TOKEN_P1), p2 (no ANALYZE, no page token returned).
 * Page endpoints demand the page token (a user token gets a (#190)-free permission error, so a wrong token shows up as a
 * failed assertion). Insights: page_views_total and page_daily_unfollows_unique are rejected with Meta's unnamed
 * "valid insights metric" error; page_media_view works (so `views` resolves to it).
 * @param {{ now?: number, unsupported?: string[], postPermissionError?: boolean }} [opts]
 */
export function facebookGraph({ now = Date.now(), unsupported = ['page_views_total', 'page_daily_unfollows_unique'], postPermissionError = false } = {}) {
  const iso = (msAgo) => new Date(now - msAgo).toISOString().replace('.000Z', '+0000');
  const needPage = (q) => (q.get('access_token') === PAGE_TOKEN ? null : err(10, '(#10) This endpoint requires a Page access token'));
  const invalidMetric = () => err(100, '(#100) The value must be a valid insights metric');

  const posts = [
    { id: 'p1_101', message: 'Photo post #fb', created_time: iso(3 * 3_600_000), permalink_url: 'https://facebook.com/p1/posts/101', full_picture: 'https://cdn/p1_101.jpg', status_type: 'added_photos', attachments: { data: [{ media_type: 'photo', type: 'photo' }] }, shares: { count: 4 }, reactions: { data: [], summary: { total_count: 39 } }, comments: { data: [], summary: { total_count: 6 } } },
    { id: 'p1_102', message: 'Video', created_time: iso(2 * 86_400_000), permalink_url: 'https://facebook.com/p1/posts/102', status_type: 'added_video', attachments: { data: [{ media_type: 'video', type: 'video_inline' }] }, reactions: { data: [], summary: { total_count: 10 } }, comments: { data: [], summary: { total_count: 1 } } },
  ];
  const olderPosts = [
    { id: 'p1_103', message: 'Album', created_time: iso(4 * 86_400_000), attachments: { data: [{ media_type: 'album', type: 'album' }] }, reactions: { summary: { total_count: 3 } }, comments: { summary: { total_count: 0 } } },
    { id: 'p1_104', message: 'Read this', created_time: iso(5 * 86_400_000), status_type: 'shared_story', attachments: { data: [{ media_type: 'link', type: 'share' }] }, shares: { count: 1 } },
    { id: 'p1_105', message: 'Just text', created_time: iso(6 * 86_400_000), status_type: 'mobile_status_update' },
  ];
  const postCounts = Object.fromEntries([...posts, ...olderPosts].map((p) => [p.id, p]));

  return ({ path: p, query: q }) => {
    const fields = q.get('fields') ?? '';
    if (p === '/me/accounts' && fields.includes('tasks')) {
      return json({ data: [
        { id: 'p1', name: 'Page 1', username: 'pageone', link: 'https://facebook.com/pageone', picture: { data: { url: 'https://cdn/p1.jpg' } }, followers_count: 5000, fan_count: 4800, tasks: ['ANALYZE', 'ADVERTISE', 'CREATE_CONTENT', 'MODERATE', 'MANAGE'], instagram_business_account: { id: 'ig1' } },
        { id: 'p2', name: 'Page w/o IG', fan_count: 80, tasks: ['CREATE_CONTENT', 'MODERATE'] },
      ] });
    }
    if (p === '/p1' && fields.includes('access_token')) return json({ id: 'p1', name: 'Page 1', access_token: PAGE_TOKEN });
    if (p === '/p2' && fields.includes('access_token')) return json({ id: 'p2', name: 'Page w/o IG' });
    if (p === '/p1') return needPage(q) ?? json({ id: 'p1', name: 'Page 1', username: 'pageone', link: 'https://facebook.com/pageone', picture: { data: { url: 'https://cdn/p1.jpg' } }, followers_count: 5100, fan_count: 4800, about: 'About page one', website: 'https://pageone.example' });
    if (p === '/p1/posts') {
      const denied = needPage(q);
      if (denied) return denied;
      if (q.get('after') === 'cur2') return json({ data: olderPosts });
      return json({ data: posts, paging: { next: `https://graph.facebook.com/v26.0/p1/posts?after=cur2&access_token=${PAGE_TOKEN}` } });
    }
    if (p === '/p1/insights') {
      const denied = needPage(q);
      if (denied) return denied;
      const metrics = q.get('metric').split(',');
      if (q.get('period') !== 'day') return err(100, '(#100) period must be day');
      if (metrics.some((m) => unsupported.includes(m))) return invalidMetric();
      return json({ data: metrics.map((m) => ({ name: m, period: 'day', values: [
        { value: m === 'page_follows' ? 5090 : 100, end_time: iso(2 * 86_400_000) },
        { value: m === 'page_follows' ? 5100 : 120, end_time: iso(86_400_000) },
      ] })) });
    }
    if (/^\/p1_\d+$/.test(p)) {
      const denied = needPage(q);
      if (denied) return denied;
      const base = postCounts[p.slice(1)];
      const out = { id: base.id, shares: base.shares, reactions: base.reactions, comments: base.comments };
      const m = /insights\.metric\(([^)]*)\)/.exec(fields);
      if (!m) return json(out);
      if (postPermissionError) return err(10, '(#10) Requires read_insights');
      const metrics = m[1].split(',');
      if (metrics.some((x) => unsupported.includes(x))) return invalidMetric();
      const value = (name) => (name === 'post_reactions_by_type_total' ? REACTIONS : name === 'post_media_view' ? 900 : name === 'post_total_media_view_unique' ? 700 : 15);
      return json({ ...out, insights: { data: metrics.map((name) => ({ name, period: 'lifetime', values: [{ value: value(name) }] })) } });
    }
    return null;
  };
}
