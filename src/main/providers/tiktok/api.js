import { MetaError, NetworkError } from '../../meta/errors.js';

/**
 * TikTok Display API v2 (open.tiktokapis.com) — experimental provider, v2.0 chunk C2.
 *
 * Checked against developers.tiktok.com on 2026-09-30:
 * CONFIRMED
 *  - GET  /v2/user/info/?fields=…  Bearer token. Fields by scope: user.info.basic → open_id, union_id, avatar_url(_100/_large),
 *    display_name; user.info.profile → bio_description, profile_deep_link, is_verified, username; user.info.stats →
 *    follower_count, following_count, likes_count, video_count. Response { data: { user }, error: { code, message, log_id } }.
 *  - POST /v2/video/list/?fields=…  JSON { cursor?, max_count ≤ 20 (default 10) } → { data: { videos, cursor, has_more } };
 *    public videos newest first; cursor = UTC Unix ms (videos posted before it). Scope video.list.
 *  - POST /v2/video/query/?fields=… JSON { filters: { video_ids ≤ 20 } }. Scope video.list.
 *  - Video fields: id, create_time (Unix s), title, video_description (≤150 chars), duration (s), cover_image_url (TTL 6 h),
 *    share_url, embed_link, view_count, like_count, comment_count, share_count.
 *  - Errors: access_token_invalid 401, scope_not_authorized 401, scope_permission_missed 400, invalid_params 400,
 *    rate_limit_exceeded 429, internal_error 500; each with message + log_id.
 *  - Rate limit: 600 requests / minute per endpoint (user/info, video/list, video/query), sliding 1-minute window → 429.
 *  - Token lifetimes (auth.js): access 24 h (expires_in 86400), refresh 365 days, refresh token may rotate.
 *  - No per-day analytics, reach, watch time, demographics or comment access in the Display API: daily follower_count
 *    and views are derived from our own snapshots (analytics/derived.js, capabilities.dailySeries 'derived').
 * VERIFY
 *  - Whether sandbox apps return real counts for target users (docs: "restricted environment", ≤10 target users).
 *  - Photo-mode posts: video/list documents videos only; photo posts are assumed absent or typed as VIDEO.
 *  - Whether view_count of the owner's own videos equals the public play count (assumed).
 *  - Whether 5xx responses always carry the error envelope (handled either way).
 */
export const TIKTOK_API = 'https://open.tiktokapis.com';
export const LIST_MAX = 20;
export const QUERY_MAX = 20;
export const RATE_LIMIT_PER_MIN = 600;

export const USER_FIELDS_BY_SCOPE = Object.freeze({
  'user.info.basic': Object.freeze(['open_id', 'union_id', 'avatar_url', 'display_name']),
  'user.info.profile': Object.freeze(['bio_description', 'profile_deep_link', 'is_verified', 'username']),
  'user.info.stats': Object.freeze(['follower_count', 'following_count', 'likes_count', 'video_count']),
});
export const VIDEO_FIELDS = Object.freeze([
  'id', 'create_time', 'title', 'video_description', 'duration', 'cover_image_url', 'share_url', 'embed_link',
  'view_count', 'like_count', 'comment_count', 'share_count',
]);
export const INSIGHT_FIELDS = Object.freeze(['id', 'view_count', 'like_count', 'comment_count', 'share_count']);

/** Scope an endpoint needs (named in permission errors). */
const ENDPOINT_SCOPE = { '/v2/user/info/': 'user.info.stats', '/v2/video/list/': 'video.list', '/v2/video/query/': 'video.list' };

/**
 * Vendor error → MetaError code, so the generic job/orchestrator logic applies unchanged:
 * 190 token error (reconnect this account only), 10 permission (soft, logged), 4 rate limit (retryable), 100 invalid param (soft).
 */
const CODE_MAP = {
  access_token_invalid: 190,
  scope_not_authorized: 10,
  scope_permission_missed: 10,
  rate_limit_exceeded: 4,
  invalid_params: 100,
};

const opts = { backoffMs: 2_000, delayMs: Number(process.env.METADASH_TIKTOK_DELAY_MS ?? 120), attempts: 3, timeoutMs: 30_000 };

/** Tests: { backoffMs: 0, delayMs: 0 }. */
export function configureTikTokApi(next = {}) {
  Object.assign(opts, next);
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Pause between calls (≈500/min at 120 ms, below the 600/min per-endpoint limit); concurrency is 1. */
export const tiktokClient = Object.freeze({ delay: () => sleep(opts.delayMs) });

export function tiktokError({ status = null, code, message, logId = null, endpoint = null }) {
  const vendor = String(code ?? `http_${status}`);
  const scope = ENDPOINT_SCOPE[endpoint];
  const mapped = CODE_MAP[vendor] ?? (status === 401 ? 190 : status === 429 ? 4 : status ?? 1);
  const detail = mapped === 10 && scope ? `${message ?? vendor} (scope: ${scope})` : message ?? vendor;
  const err = new MetaError({ code: mapped, message: `TikTok ${vendor}: ${detail}`, endpoint, status, source: 'tiktok', type: vendor });
  return Object.assign(err, { vendorCode: vendor, logId });
}

async function readBody(res) {
  try { return await res.json(); } catch { return null; }
}

/**
 * One Display API call with retry: 429 and 5xx back off (2 s, 4 s, …) up to `attempts`; other errors throw at once.
 * @returns {Promise<object>} the `data` object
 */
export async function request(path, { token, method = 'GET', fields, body } = {}) {
  const url = new URL(path, TIKTOK_API);
  if (fields?.length) url.searchParams.set('fields', fields.join(','));
  let last = null;
  for (let attempt = 0; attempt < opts.attempts; attempt += 1) {
    if (attempt) await sleep(opts.backoffMs * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (e) {
      throw new NetworkError(e?.message ?? 'network error', path);
    }
    const json = await readBody(res);
    const vendor = json?.error?.code;
    if (res.ok && (!vendor || vendor === 'ok')) return json?.data ?? {};
    last = tiktokError({ status: res.status, code: vendor, message: json?.error?.message, logId: json?.error?.log_id ?? null, endpoint: path });
    const retry = res.status === 429 || res.status >= 500 || vendor === 'rate_limit_exceeded' || vendor === 'internal_error';
    if (!retry) throw last;
  }
  throw last;
}

/** GET /v2/user/info/ → the user object (only requested fields). */
export async function fetchUserInfo(token, fields) {
  const data = await request('/v2/user/info/', { token, fields });
  return data.user ?? {};
}

/** One page of POST /v2/video/list/. */
export async function listVideosPage(token, { cursor, maxCount = LIST_MAX, fields = VIDEO_FIELDS } = {}) {
  const body = { max_count: Math.min(maxCount, LIST_MAX), ...(cursor != null ? { cursor } : {}) };
  const data = await request('/v2/video/list/', { token, method: 'POST', fields, body });
  return { videos: data.videos ?? [], cursor: data.cursor ?? null, hasMore: !!data.has_more };
}

/** Pages video/list (newest first) until a video older than sinceUnix, has_more=false or `max` videos. */
export async function listVideosSince(token, { sinceUnix = 0, max = 2000 } = {}) {
  const out = [];
  let cursor;
  for (;;) {
    const page = await listVideosPage(token, { cursor });
    let crossed = false;
    for (const v of page.videos) {
      if (Number(v.create_time) < sinceUnix) { crossed = true; continue; }
      out.push(v);
    }
    if (crossed || !page.hasMore || out.length >= max || page.cursor == null || page.cursor === cursor) break;
    cursor = page.cursor;
    await tiktokClient.delay();
  }
  return out.slice(0, max);
}

/** POST /v2/video/query/ in groups of 20 ids. */
export async function queryVideos(token, ids, { fields = INSIGHT_FIELDS } = {}) {
  const out = [];
  for (let i = 0; i < ids.length; i += QUERY_MAX) {
    if (i) await tiktokClient.delay();
    const data = await request('/v2/video/query/', { token, method: 'POST', fields, body: { filters: { video_ids: ids.slice(i, i + QUERY_MAX) } } });
    out.push(...(data.videos ?? []));
  }
  return out;
}

/** user/info fields allowed by the granted scopes (unknown scopes → basic + profile + stats, i.e. everything MetaDash requests). */
export function userFieldsFor(scopes) {
  const granted = scopes?.length ? scopes : Object.keys(USER_FIELDS_BY_SCOPE);
  return Object.entries(USER_FIELDS_BY_SCOPE).filter(([s]) => s === 'user.info.basic' || granted.includes(s)).flatMap(([, f]) => f);
}
