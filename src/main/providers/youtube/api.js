import { MetaError, NetworkError } from '../../meta/errors.js';
import { spendUnits, markExhausted, QuotaError, UNIT_COST } from './quota.js';

/**
 * YouTube Data API v3 + YouTube Analytics API v2 HTTP layer.
 *
 * CONFIRMED against Google's docs (fetched 2026-09-30):
 *  - OAuth desktop flow, endpoints, PKCE S256, loopback 127.0.0.1 redirect, optional client_secret (auth.js).
 *  - Refresh tokens expire after 7 days while the consent screen is "Testing"; 6 months unused; 100 per account+client.
 *  - Quota: 10,000 units/day default per project, reset at midnight PT; channels/playlistItems/videos/commentThreads/
 *    comments list = 1 unit; comments.insert = 50; comments.setModerationStatus = 50; invalid requests cost ≥ 1.
 *  - channels.list statistics.subscriberCount is rounded down to 3 significant figures; hiddenSubscriberCount flag.
 *  - contentDetails.relatedPlaylists.uploads = the uploads playlist; playlistItems/videos maxResults 50.
 *  - commentThreads.list: part=snippet,replies, videoId | allThreadsRelatedToChannelId | id, maxResults 1–100,
 *    order=time|relevance, textFormat=plainText|html.
 *  - Analytics reports.query (ids=channel==MINE): dimensions=day supports views, estimatedMinutesWatched,
 *    averageViewDuration, averageViewPercentage, likes, comments, shares, subscribersGained, subscribersLost;
 *    video filter accepts up to 500 ids; demographics (ageGroup,gender) only viewerPercentage; country + views;
 *    creatorContentType dimension values SHORTS | VIDEO_ON_DEMAND | LIVE_STREAM | STORY | UNSPECIFIED.
 *
 * VERIFY (not confirmed / tolerated with fallbacks):
 *  - dimensions=video with filters=video==id1,…: the channel-reports table only lists video as a *top videos*
 *    dimension (sort + maxResults ≤ 200) and video as a filter without the video dimension. We send ≤ 200 ids per call
 *    with sort=-views; on 400 the batch falls back to videos.list statistics (analytics.js).
 *  - dimensions=video,creatorContentType + video filter (Shorts detection); on 400 → duration heuristic (≤ 180 s).
 *  - The uploads playlist is returned newest first (we stop paging at sinceUnix).
 *  - commentThreads.list replies only embed a subset of replies; comments.list?parentId= fetches the rest.
 *  - "Hide" = comments.setModerationStatus moderationStatus=heldForReview (unhide = published), force-ssl scope.
 *  - Max comment length 10,000 characters.
 *  - Analytics per-minute quota (separate from Data API units) — 429/rateLimitExceeded is retried with backoff.
 *  - Analytics day rows are channel-timezone-agnostic 'YYYY-MM-DD' dates and lag 2–3 days (refetchTrailingDays: 7).
 *
 * Errors: 401 → MetaError 190 (source 'google', auth → per-channel invalid auth in the orchestrator); 403
 * quotaExceeded/dailyLimitExceeded → QuotaError (ledger marked exhausted); 403 rateLimitExceeded/userRateLimitExceeded
 * or 429 → retry with backoff; other 403 → MetaError 10 (permission, soft); 400/404 → MetaError 100 (soft); 5xx retried
 * then MetaError 2. Tokens are sent only in the Authorization header and never logged.
 */
export const DATA_API = 'https://www.googleapis.com/youtube/v3';
export const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';
export const PAGE_SIZE = 50;
export const COMMENT_PAGE_SIZE = 100;
export const REQUEST_TIMEOUT_MS = 30_000;
const RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt) => {
  const base = Number(process.env.METADASH_GOOGLE_BACKOFF_MS ?? 1500);
  return (Number.isFinite(base) ? base : 1500) * 2 ** attempt;
};

const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded']);
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

/** Google JSON error envelope → the error the sync layer understands. */
export function googleError(status, body, endpoint) {
  const e = body?.error;
  const reason = e?.errors?.[0]?.reason ?? (typeof e === 'string' ? e : null);
  const message = (typeof e === 'object' && e?.message) || body?.error_description || `HTTP ${status}`;
  if (status === 401) return new MetaError({ code: 190, message, endpoint, status, source: 'google', type: reason });
  if (status === 403 && QUOTA_REASONS.has(reason)) return new QuotaError(undefined, { reason, endpoint });
  if (status === 403) return new MetaError({ code: 10, message, endpoint, status, source: 'google', type: reason });
  if (status === 400 || status === 404) return new MetaError({ code: 100, message, endpoint, status, source: 'google', type: reason });
  return new MetaError({ code: 2, message, endpoint, status, source: 'google', type: reason });
}

const retryable = (status, reason) => status === 429 || status >= 500 || (status === 403 && RATE_REASONS.has(reason));

/**
 * One authenticated client per (access token, quota ledger key). `units` are booked in the ledger before each Data
 * API call (Analytics calls book nothing).
 */
export function createYtClient({ token, quotaKey = null, fetchImpl, now = () => Date.now(), signal } = {}) {
  async function request(url, { method = 'GET', body, units = 0, write = false, endpoint }) {
    if (units) spendUnits(quotaKey, units, { write, now: now() });
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await (fetchImpl ?? globalThis.fetch)(url.toString(), {
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (e) {
        if (e?.name === 'AbortError' && signal?.aborted) throw e;
        throw new NetworkError(e?.message ?? 'network error', endpoint);
      }
      if (res.status === 204) return null;
      let parsed = null;
      try { parsed = await res.json(); } catch { parsed = null; }
      if (res.ok) return parsed;
      const reason = parsed?.error?.errors?.[0]?.reason ?? null;
      if (retryable(res.status, reason) && attempt < RETRIES) { await sleep(backoffMs(attempt)); continue; }
      const err = googleError(res.status, parsed, endpoint);
      if (err instanceof QuotaError) markExhausted(quotaKey, now());
      throw err;
    }
  }
  const dataUrl = (path, params) => {
    const url = new URL(`${DATA_API}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) if (v != null && v !== '') url.searchParams.set(k, String(v));
    return url;
  };
  return {
    quotaKey,
    get: (path, params, { units = UNIT_COST.list } = {}) => request(dataUrl(path, params), { units, endpoint: path }),
    post: (path, params, body, { units = UNIT_COST.insert } = {}) => request(dataUrl(path, params), { method: 'POST', body, units, write: true, endpoint: path }),
    analytics(params) {
      const url = new URL(ANALYTICS_API);
      for (const [k, v] of Object.entries({ ids: 'channel==MINE', ...params })) if (v != null && v !== '') url.searchParams.set(k, String(v));
      return request(url, { endpoint: `reports:${params.dimensions ?? 'none'}` });
    },
  };
}

// ---------- Data API calls ----------

const CHANNEL_PARTS = 'snippet,statistics,contentDetails,status';

/** The channel the token belongs to (channels.list mine=true, 1 unit) or null. */
export async function fetchMyChannel(client) {
  const body = await client.get('/channels', { part: CHANNEL_PARTS, mine: 'true', maxResults: 1 });
  return body?.items?.[0] ?? null;
}

/** One channel by id (1 unit) or null. */
export async function fetchChannel(client, channelId) {
  const body = await client.get('/channels', { part: CHANNEL_PARTS, id: channelId, maxResults: 1 });
  return body?.items?.[0] ?? null;
}

/**
 * Uploads playlist pages (1 unit each), newest first, until a video older than `sinceMs` or `max` ids.
 * @returns {Promise<{videoId:string, publishedAt:string|null}[]>}
 */
export async function listUploads(client, playlistId, { sinceMs = 0, max = 500 } = {}) {
  const out = [];
  let pageToken;
  do {
    const body = await client.get('/playlistItems', { part: 'contentDetails', playlistId, maxResults: PAGE_SIZE, pageToken });
    for (const it of body?.items ?? []) {
      const videoId = it?.contentDetails?.videoId;
      const publishedAt = it?.contentDetails?.videoPublishedAt ?? null;
      if (!videoId) continue;
      if (sinceMs && publishedAt && Date.parse(publishedAt) < sinceMs) return out;
      out.push({ videoId, publishedAt });
      if (out.length >= max) return out;
    }
    pageToken = body?.nextPageToken;
  } while (pageToken);
  return out;
}

/** videos.list for any number of ids, 50 per call (1 unit each). */
export async function fetchVideos(client, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const chunk = ids.slice(i, i + PAGE_SIZE);
    const body = await client.get('/videos', { part: 'snippet,statistics,contentDetails,status,liveStreamingDetails', id: chunk.join(','), maxResults: PAGE_SIZE });
    out.push(...(body?.items ?? []));
  }
  return out;
}

/** commentThreads.list for a video, newest first, up to `maxPages` pages or until threads older than `sinceMs`. */
export async function fetchCommentThreads(client, videoId, { sinceMs = 0, maxPages = 3 } = {}) {
  const out = [];
  let pageToken;
  for (let page = 0; page < maxPages; page += 1) {
    const body = await client.get('/commentThreads', { part: 'snippet,replies', videoId, maxResults: COMMENT_PAGE_SIZE, order: 'time', textFormat: 'plainText', pageToken });
    const items = body?.items ?? [];
    out.push(...items);
    const oldest = items.at(-1)?.snippet?.topLevelComment?.snippet?.updatedAt ?? items.at(-1)?.snippet?.topLevelComment?.snippet?.publishedAt;
    pageToken = body?.nextPageToken;
    if (!pageToken || (sinceMs && oldest && Date.parse(oldest) < sinceMs)) break;
  }
  return out;
}

/** All replies of a top-level comment (comments.list parentId, 1 unit per page). */
export async function fetchReplies(client, parentId, { maxPages = 2 } = {}) {
  const out = [];
  let pageToken;
  for (let page = 0; page < maxPages; page += 1) {
    const body = await client.get('/comments', { part: 'snippet', parentId, maxResults: COMMENT_PAGE_SIZE, textFormat: 'plainText', pageToken });
    out.push(...(body?.items ?? []));
    pageToken = body?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** comments.insert reply to a top-level comment (50 units, youtube.force-ssl). */
export function insertReply(client, parentId, text) {
  return client.post('/comments', { part: 'snippet' }, { snippet: { parentId, textOriginal: text } }, { units: UNIT_COST.insert });
}

/** comments.setModerationStatus (50 units, youtube.force-ssl; owner of the channel/video only). */
export function setModerationStatus(client, ids, status) {
  return client.post('/comments/setModerationStatus', { id: [].concat(ids).join(','), moderationStatus: status }, undefined, { units: UNIT_COST.moderate });
}
