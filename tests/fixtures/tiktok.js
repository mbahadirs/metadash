/**
 * Fake TikTok APIs for the `tiktok` host group of tests/fixtures/fakeFetch.js (v2.0 chunk C2):
 *   POST open.tiktokapis.com/v2/oauth/token/   authorization_code (checks client, redirect_uri, hex PKCE) + refresh_token (rotates)
 *   POST open.tiktokapis.com/v2/oauth/revoke/
 *   GET  open.tiktokapis.com/v2/user/info/?fields=…
 *   POST open.tiktokapis.com/v2/video/list/?fields=…   { cursor, max_count ≤ 20 } newest first, cursor = create_time ms
 *   POST open.tiktokapis.com/v2/video/query/?fields=…  { filters: { video_ids ≤ 20 } }
 *
 *   const api = tiktokApi({ now });
 *   createFakeFetch({ tiktok: [api] })
 *
 * The returned handler carries its mutable state (`api.state`): tokens, pending auth codes, request counters and
 * one-shot failures (`api.state.failNext.push({ path, status, code, message, oauth? })`).
 */
import crypto from 'node:crypto';
import { json } from './fakeFetch.js';

const DAY = 86_400_000;
export const TT_CLIENT_KEY = 'awtestclientkey01';
export const TT_CLIENT_SECRET = 'tt-secret-0123456789abcdef';
export const TT_OPEN_ID = '-000OPENID_tok_1';

const hex = (v) => crypto.createHash('sha256').update(v, 'ascii').digest('hex');

/** `n` videos, one every 2 days from `now - 1h` backwards; counts shrink with age. */
export function makeVideos(now, n = 45) {
  return Array.from({ length: n }, (_, i) => {
    const id = `7300000000000000${String(i).padStart(3, '0')}`;
    return {
      id,
      create_time: Math.floor((now - 3_600_000 - i * 2 * DAY) / 1000),
      title: i % 3 === 0 ? `Title ${i}` : '',
      video_description: i % 3 === 1 ? '' : `Video ${i} #fyp #demo`,
      duration: 15 + i,
      cover_image_url: `https://p16-sign.tiktokcdn.com/cover-${i}.jpeg`,
      share_url: `https://www.tiktok.com/@tok/video/${id}?utm_source=x`,
      embed_link: `https://www.tiktok.com/player/v1/${id}`,
      view_count: 10_000 - i * 100,
      like_count: 800 - i * 10,
      comment_count: 40 + i,
      share_count: 20 + (i % 5),
    };
  });
}

const parseForm = (body) => Object.fromEntries(new URLSearchParams(typeof body === 'string' ? body : String(body ?? '')));
const parseJson = (body) => { try { return JSON.parse(String(body ?? '{}')); } catch { return {}; } };
const apiError = (status, code, message) => json({ data: {}, error: { code, message, log_id: 'LOG123' } }, status);
const oauthError = (error, description, status = 400) => json({ error, error_description: description, log_id: 'LOG456' }, status);
const pick = (obj, fields) => Object.fromEntries(fields.filter((f) => f in obj).map((f) => [f, obj[f]]));
const header = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  const k = Object.keys(headers).find((x) => x.toLowerCase() === name);
  return k ? headers[k] : undefined;
};

export function tiktokApi({ now = Date.now(), videos, user } = {}) {
  const state = {
    videos: videos ?? makeVideos(now),
    user: user ?? {
      open_id: TT_OPEN_ID, union_id: 'union-1', avatar_url: 'https://p16.tiktokcdn.com/avatar.jpeg', display_name: 'Tok Demo',
      username: 'tok', bio_description: 'Bio', profile_deep_link: 'https://vm.tiktok.com/xyz', is_verified: false,
      follower_count: 12_345, following_count: 12, likes_count: 99_000, video_count: 45,
    },
    scopes: ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'],
    /** code → { challenge, redirectUri } registered by the test (what the authorize page would have seen). */
    codes: new Map(),
    access: new Set(['tt-access-initial']),
    refresh: new Map([['tt-refresh-initial', TT_OPEN_ID]]),
    issued: 0,
    revoked: [],
    counts: { token: 0, refresh: 0, info: 0, list: 0, query: 0 },
    lastFields: {},
    listBodies: [],
    queryBodies: [],
    failNext: [],
  };

  const issue = () => {
    state.issued += 1;
    const access = `tt-access-${state.issued}`;
    const refresh = `tt-refresh-${state.issued}`;
    state.access.add(access);
    state.refresh.set(refresh, state.user.open_id);
    return {
      access_token: access, expires_in: 86_400, open_id: state.user.open_id, refresh_expires_in: 31_536_000,
      refresh_token: refresh, scope: state.scopes.join(','), token_type: 'Bearer',
    };
  };

  const handler = ({ url, path, method, body, headers }) => {
    if (url.host !== 'open.tiktokapis.com') return null;
    const fail = state.failNext.findIndex((f) => !f.path || path.startsWith(f.path));
    if (fail >= 0) {
      const f = state.failNext.splice(fail, 1)[0];
      return f.oauth ? oauthError(f.code, f.message, f.status ?? 400) : apiError(f.status ?? 400, f.code, f.message ?? f.code);
    }

    if (path === '/v2/oauth/token/' && method === 'POST') {
      if (!/application\/x-www-form-urlencoded/.test(String(header(headers, 'content-type')))) return oauthError('invalid_request', 'content type');
      const f = parseForm(body);
      if (f.client_key !== TT_CLIENT_KEY || f.client_secret !== TT_CLIENT_SECRET) return oauthError('invalid_client', 'bad client', 401);
      if (f.grant_type === 'authorization_code') {
        state.counts.token += 1;
        const c = state.codes.get(f.code);
        if (!c) return oauthError('invalid_grant', 'Authorization code is expired.');
        if (c.redirectUri && c.redirectUri !== f.redirect_uri) return oauthError('invalid_request', 'redirect_uri mismatch');
        if (c.challenge && hex(f.code_verifier ?? '') !== c.challenge) return oauthError('invalid_request', 'Code verifier or code challenge is invalid.');
        state.codes.delete(f.code);
        return json(issue());
      }
      if (f.grant_type === 'refresh_token') {
        state.counts.refresh += 1;
        if (!state.refresh.has(f.refresh_token)) return oauthError('invalid_grant', 'Refresh token is invalid or expired.');
        state.refresh.delete(f.refresh_token);
        return json(issue());
      }
      return oauthError('unsupported_grant_type', 'grant');
    }

    if (path === '/v2/oauth/revoke/' && method === 'POST') {
      const f = parseForm(body);
      state.revoked.push(f.token);
      state.access.delete(f.token);
      return json({});
    }

    const token = String(header(headers, 'authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!state.access.has(token)) return apiError(401, 'access_token_invalid', 'The access token is invalid or not found in the request.');
    const fields = String(url.searchParams.get('fields') ?? '').split(',').filter(Boolean);
    state.lastFields[path] = fields;

    if (path === '/v2/user/info/' && method === 'GET') {
      state.counts.info += 1;
      const stats = ['follower_count', 'following_count', 'likes_count', 'video_count'];
      if (fields.some((f) => stats.includes(f)) && !state.scopes.includes('user.info.stats')) {
        return apiError(401, 'scope_not_authorized', 'The user did not authorize the scope required for completing this request.');
      }
      return json({ data: { user: pick(state.user, fields) }, error: { code: 'ok', message: '', log_id: 'L1' } });
    }

    if (path === '/v2/video/list/' && method === 'POST') {
      state.counts.list += 1;
      const b = parseJson(body);
      state.listBodies.push(b);
      if (Number(b.max_count) > 20) return apiError(400, 'invalid_params', 'max_count must be at most 20');
      const max = Number(b.max_count ?? 10);
      const cursor = b.cursor != null ? Number(b.cursor) : Infinity;
      const older = state.videos.filter((v) => v.create_time * 1000 < cursor).sort((a, c) => c.create_time - a.create_time);
      const page = older.slice(0, max);
      const last = page[page.length - 1];
      return json({
        data: { videos: page.map((v) => pick(v, fields)), cursor: last ? last.create_time * 1000 : 0, has_more: older.length > page.length },
        error: { code: 'ok', message: '', log_id: 'L2' },
      });
    }

    if (path === '/v2/video/query/' && method === 'POST') {
      state.counts.query += 1;
      const b = parseJson(body);
      state.queryBodies.push(b);
      const ids = b.filters?.video_ids ?? [];
      if (ids.length > 20) return apiError(400, 'invalid_params', 'video_ids must be at most 20');
      const found = state.videos.filter((v) => ids.includes(v.id));
      return json({ data: { videos: found.map((v) => pick(v, fields)) }, error: { code: 'ok', message: '', log_id: 'L3' } });
    }

    return null;
  };
  return Object.assign(handler, { state });
}
