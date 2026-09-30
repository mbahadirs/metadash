/**
 * Fake Google APIs (OAuth token/revoke, YouTube Data API v3, YouTube Analytics v2) for the `google` host group of
 * tests/fixtures/fakeFetch.js:
 *
 *   const g = googleApis({ now, channels: [demoChannel('UCaaa'), demoChannel('UCbbb')] });
 *   createFakeFetch({ google: [g] })
 *
 * Tokens encode their channel: access `at-<channelId>-<n>`, refresh `rt-<channelId>`, authorization code
 * `code-<channelId>`. `g.state` is mutable from tests:
 *   revoked: Set of refresh tokens answering invalid_grant; quotaExceeded: bool (403 quotaExceeded on Data API);
 *   analyticsForbidden: bool (403 forbidden on reports); contentTypeUnsupported: bool (400 on video,creatorContentType);
 *   revokedTokens: tokens posted to /revoke; inserted: comments.insert bodies; moderated: setModerationStatus calls;
 *   tokenRequests: parsed token-endpoint bodies; issued: access tokens issued per channel; grantedScope: override.
 */
import { json } from './fakeFetch.js';

const DAY = 86_400_000;

export function googleError(status, reason, message = reason) {
  return json({ error: { code: status, message, errors: [{ reason, domain: 'youtube', message }], status: 'ERR' } }, status);
}

/** A channel with three uploads: a 45 s Short, a 12 min video and a past live stream. */
export function demoChannel(id, { now = Date.now(), title = `Channel ${id}`, subscribers = 12_300, hidden = false, videos } = {}) {
  const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
  return {
    id,
    title,
    handle: `@${id.toLowerCase()}`,
    subscribers,
    hidden,
    publishedAt: iso(900),
    videos: videos ?? [
      { id: `${id}-s1`, title: 'Short one', publishedAt: iso(2), duration: 'PT45S', views: 5000, likes: 400, comments: 12, contentType: 'SHORTS' },
      { id: `${id}-v1`, title: 'Long video', publishedAt: iso(10), duration: 'PT12M3S', views: 20000, likes: 900, comments: 80, contentType: 'VIDEO_ON_DEMAND' },
      { id: `${id}-l1`, title: 'Live stream', publishedAt: iso(20), duration: 'PT1H2M', views: 3000, likes: 100, comments: 40, live: true, contentType: 'LIVE_STREAM' },
    ],
    comments: {},
  };
}

const bodyParams = (body) => new URLSearchParams(typeof body === 'string' ? body : body?.toString?.() ?? '');
const bearer = (headers) => String(headers?.Authorization ?? headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
const channelOfToken = (token) => /^at-(.+)-\d+$/.exec(token)?.[1] ?? null;

function table(names, rows) {
  return { kind: 'youtubeAnalytics#resultTable', columnHeaders: names.map((name) => ({ name, columnType: 'METRIC', dataType: 'INTEGER' })), rows };
}

function eachDate(start, end) {
  const out = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function googleApis({ now = Date.now(), channels = [], clientId = 'test-client.apps.googleusercontent.com' } = {}) {
  const state = {
    revoked: new Set(), quotaExceeded: false, analyticsForbidden: false, contentTypeUnsupported: false,
    revokedTokens: [], inserted: [], moderated: [], tokenRequests: [], issued: {}, grantedScope: null,
  };
  const byId = new Map(channels.map((c) => [c.id, c]));
  const issue = (chId) => { state.issued[chId] = (state.issued[chId] ?? 0) + 1; return `at-${chId}-${state.issued[chId]}`; };
  const BASE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';

  function oauth({ path, body }) {
    if (path === '/revoke') { state.revokedTokens.push(bodyParams(body).get('token')); return json({}); }
    if (path !== '/token') return null;
    const p = bodyParams(body);
    state.tokenRequests.push(Object.fromEntries(p));
    if (p.get('client_id') !== clientId) return json({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }, 401);
    if (p.get('grant_type') === 'authorization_code') {
      const chId = /^code-(.+)$/.exec(p.get('code') ?? '')?.[1];
      if (!chId || !byId.has(chId) || !p.get('code_verifier')) return json({ error: 'invalid_grant', error_description: 'Bad Request' }, 400);
      return json({ access_token: issue(chId), refresh_token: `rt-${chId}`, expires_in: 3599, token_type: 'Bearer', scope: state.grantedScope ?? BASE_SCOPE });
    }
    if (p.get('grant_type') === 'refresh_token') {
      const rt = p.get('refresh_token') ?? '';
      const chId = /^rt-(.+)$/.exec(rt)?.[1];
      if (!chId || state.revoked.has(rt)) return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
      return json({ access_token: issue(chId), expires_in: 3599, token_type: 'Bearer', scope: BASE_SCOPE });
    }
    return json({ error: 'unsupported_grant_type' }, 400);
  }

  function channelJson(c) {
    return {
      kind: 'youtube#channel', id: c.id,
      snippet: { title: c.title, description: `About ${c.title}`, customUrl: c.handle, publishedAt: c.publishedAt, thumbnails: { default: { url: `https://yt3.example/${c.id}/88` }, medium: { url: `https://yt3.example/${c.id}/240` } } },
      statistics: { viewCount: '100000', subscriberCount: String(c.subscribers), hiddenSubscriberCount: !!c.hidden, videoCount: String(c.videos.length) },
      contentDetails: { relatedPlaylists: { likes: '', uploads: `UU${c.id.slice(2)}` } },
      status: { privacyStatus: 'public' },
    };
  }

  function dataApi({ path, query, method, body, headers }) {
    const ch = byId.get(channelOfToken(bearer(headers)));
    if (!ch) return googleError(401, 'authError', 'Invalid Credentials');
    if (state.quotaExceeded) return googleError(403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.');
    const p = path.replace(/^\/youtube\/v3/, '');
    if (p === '/channels') {
      if (query.get('mine') !== 'true' && query.get('id') !== ch.id) return json({ kind: 'youtube#channelListResponse', items: [] });
      return json({ kind: 'youtube#channelListResponse', items: [channelJson(ch)] });
    }
    if (p === '/playlistItems') {
      if (query.get('playlistId') !== `UU${ch.id.slice(2)}`) return googleError(404, 'playlistNotFound');
      const size = Number(query.get('maxResults') ?? 5);
      const start = Number(query.get('pageToken') ?? 0);
      const sorted = [...ch.videos].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
      const page = sorted.slice(start, start + size);
      return json({
        items: page.map((v) => ({ contentDetails: { videoId: v.id, videoPublishedAt: v.publishedAt } })),
        ...(start + size < sorted.length ? { nextPageToken: String(start + size) } : {}),
      });
    }
    if (p === '/videos') {
      const ids = (query.get('id') ?? '').split(',');
      const items = ch.videos.filter((v) => ids.includes(v.id)).map((v) => ({
        id: v.id,
        snippet: { title: v.title, description: `Description of ${v.title}`, publishedAt: v.publishedAt, thumbnails: { medium: { url: `https://i.ytimg.example/${v.id}/mq.jpg` } }, liveBroadcastContent: 'none' },
        statistics: { viewCount: String(v.views), likeCount: String(v.likes), commentCount: String(v.comments) },
        contentDetails: { duration: v.duration },
        status: { privacyStatus: v.privacy ?? 'public' },
        ...(v.live ? { liveStreamingDetails: { actualStartTime: v.publishedAt, actualEndTime: v.publishedAt } } : {}),
      }));
      return json({ items });
    }
    if (p === '/commentThreads') return json({ items: ch.comments[query.get('videoId')] ?? [] });
    if (p === '/comments' && method === 'GET') return json({ items: [] });
    if (p === '/comments' && method === 'POST') {
      const parsed = JSON.parse(body);
      state.inserted.push(parsed);
      return json({ id: `reply-${state.inserted.length}`, snippet: { ...parsed.snippet, publishedAt: new Date(now).toISOString(), authorChannelId: { value: ch.id } } });
    }
    if (p === '/comments/setModerationStatus' && method === 'POST') {
      state.moderated.push({ id: query.get('id'), status: query.get('moderationStatus') });
      return new Response(null, { status: 204 });
    }
    return null;
  }

  function analytics({ query, headers }) {
    const ch = byId.get(channelOfToken(bearer(headers)));
    if (!ch) return googleError(401, 'authError', 'Invalid Credentials');
    if (state.analyticsForbidden) return googleError(403, 'forbidden', 'Forbidden');
    const dims = query.get('dimensions') ?? '';
    const metrics = (query.get('metrics') ?? '').split(',');
    if (dims === 'day') {
      const rows = eachDate(query.get('startDate'), query.get('endDate')).map((d, i) => [d, ...metrics.map((m) => ({
        views: 1000 + i, estimatedMinutesWatched: 3000 + i, averageViewDuration: 180, subscribersGained: 12, subscribersLost: 3, likes: 50, comments: 7, shares: 4,
      }[m] ?? 0))]);
      return json(table(['day', ...metrics], rows));
    }
    const filterIds = (/video==(.+)$/.exec(query.get('filters') ?? '')?.[1] ?? '').split(',').filter(Boolean);
    if (dims === 'video,creatorContentType') {
      if (state.contentTypeUnsupported) return googleError(400, 'badRequest', 'The query is not supported.');
      return json(table(['video', 'creatorContentType', ...metrics], ch.videos.filter((v) => filterIds.includes(v.id)).map((v) => [v.id, v.contentType, v.views])));
    }
    if (dims === 'video') {
      const rows = ch.videos.filter((v) => filterIds.includes(v.id)).map((v) => [v.id, ...metrics.map((m) => ({
        views: v.views - 100, estimatedMinutesWatched: Math.round(v.views * 1.5), averageViewDuration: 95, averageViewPercentage: 41.5, likes: v.likes - 5, comments: v.comments, shares: 17,
      }[m] ?? 0))]);
      return json(table(['video', ...metrics], rows));
    }
    if (dims === 'ageGroup,gender') {
      return json(table(['ageGroup', 'gender', 'viewerPercentage'], [['age18-24', 'female', 20.5], ['age25-34', 'male', 45.25], ['age25-34', 'user_specified', 1.0]]));
    }
    if (dims === 'country') return json(table(['country', 'views'], [['TR', 9000], ['DE', 1200]]));
    return googleError(400, 'badRequest', `unsupported dims ${dims}`);
  }

  const handler = (req) => {
    const host = req.url.host;
    if (host === 'oauth2.googleapis.com') return oauth(req);
    if (host === 'www.googleapis.com') return dataApi(req);
    if (host === 'youtubeanalytics.googleapis.com') return analytics(req);
    return null;
  };
  return Object.assign(handler, { state, channels: byId });
}
