/**
 * Stateful fake of the publishing APIs for tests (install with vi.stubGlobal('fetch', world.fetch)):
 *   graph.facebook.com / graph-video.facebook.com   IG containers (/media, status sequence, /media_publish, permalink,
 *     /content_publishing_limit, /comments, /media listing), FB Pages (/photos multipart, /feed attached_media, /videos,
 *     /video_reels phases, is_published, POST /{id} reschedule, DELETE), Page token, /me/accounts tasks, /debug_token
 *   rupload.facebook.com                            resumable uploads (headers recorded)
 *   graph.threads.net                               /threads containers, /threads_publish, permalink, publishing limit
 *   *.s3.test / s3.test                             S3-compatible PUT/GET/DELETE (objects kept in memory)
 * Every request is recorded in `world.calls` as { method, host, path, query, form, headers }.
 * `world.override(fn)` installs a hook: fn(req) → Response | object (JSON 200) | undefined (fall through).
 */
export const PAGE_TOKEN = 'PAGE_TOKEN';
export const IG_ID = '17840000';
export const PAGE_ID = '555';
export const TH_ID = '777';

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function graphError(code, message = 'error', { status = 400, subcode, fbtrace = 'TRACE1' } = {}) {
  return json({ error: { code, message, type: 'OAuthException', ...(subcode ? { error_subcode: subcode } : {}), fbtrace_id: fbtrace } }, status);
}

function formOf(body) {
  if (body == null) return {};
  if (typeof body === 'string') return Object.fromEntries(new URLSearchParams(body));
  if (typeof FormData !== 'undefined' && body instanceof FormData) return Object.fromEntries(body.entries());
  return { __binary: body };
}

function headersOf(h) {
  if (!h) return {};
  if (typeof h.entries === 'function' && !(h instanceof Array) && typeof h.get === 'function') return Object.fromEntries([...h.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}

/**
 * @param {{ containerStatuses?: string[], threadStatuses?: string[], quotaUsed?: number, quotaTotal?: number,
 *   isPublished?: boolean, scopes?: string[], pageTasks?: string[] }} [opts]
 */
export function createPublishWorld(opts = {}) {
  const state = { seq: 0, containers: new Map(), igMedia: [], threads: [], fbPosts: [], deleted: [], s3: new Map(), uploads: [] };
  const calls = [];
  let hooks = [];
  const next = (p) => `${p}${++state.seq}`;
  const statusOf = (c) => (c.statuses.length > 1 ? c.statuses.shift() : c.statuses[0]);

  function meta(req) {
    const { method, path, query, form } = req;
    const parts = path.split('/').filter(Boolean);
    if (path === '/debug_token') return json({ data: { is_valid: true, app_id: '1', user_id: 'u1', scopes: opts.scopes ?? ['instagram_basic', 'instagram_content_publish', 'pages_manage_posts'] } });
    if (path === '/me/accounts') return json({ data: [{ id: PAGE_ID, tasks: opts.pageTasks ?? ['CREATE_CONTENT', 'ANALYZE'] }] });
    // Instagram
    if (method === 'POST' && parts[1] === 'media' && parts.length === 2) {
      const id = next('c');
      state.containers.set(id, { id, owner: parts[0], params: form, statuses: [...(opts.containerStatuses ?? ['FINISHED'])] });
      return json(form.upload_type === 'resumable' ? { id, uri: `https://rupload.facebook.com/ig-api-upload/v26.0/${id}` } : { id });
    }
    if (method === 'POST' && parts[1] === 'media_publish') {
      const c = state.containers.get(form.creation_id);
      if (!c) return graphError(100, 'invalid creation_id');
      c.statuses = ['PUBLISHED'];
      const id = next('m');
      state.igMedia.unshift({ id, caption: c.params.caption ?? '', timestamp: new Date(opts.now?.() ?? Date.now()).toISOString(), permalink: `https://www.instagram.com/p/${id}/`, container: c.id });
      return json({ id });
    }
    if (method === 'GET' && parts[1] === 'content_publishing_limit') return json({ data: [{ quota_usage: opts.quotaUsed ?? 1, config: { quota_total: opts.quotaTotal ?? 100, quota_duration: 86400 } }] });
    if (method === 'GET' && parts[1] === 'media' && parts.length === 2) return json({ data: state.igMedia.slice(0, Number(query.get('limit') ?? 10)) });
    if (method === 'POST' && parts[1] === 'comments') return json({ id: next('cm') });
    // Facebook
    if (method === 'GET' && parts.length === 1 && query.get('fields') === 'id,name,access_token') return json({ id: parts[0], name: 'Brand Page', access_token: PAGE_TOKEN });
    if (method === 'POST' && parts[1] === 'photos') { const id = next('ph'); state.fbPosts.push({ kind: 'photo', id, form }); return json({ id, post_id: `${parts[0]}_${id}` }); }
    if (method === 'POST' && parts[1] === 'feed') { const id = `${parts[0]}_${next('')}`; state.fbPosts.push({ kind: 'feed', id, form, message: form.message, created_time: new Date(opts.now?.() ?? Date.now()).toISOString() }); return json({ id }); }
    if (method === 'POST' && parts[1] === 'videos') { const id = next('v'); state.fbPosts.push({ kind: 'video', id, form, host: req.host }); return json({ id }); }
    if (method === 'POST' && parts[1] === 'video_reels') {
      if (form.upload_phase === 'start') { const id = next('rv'); return json({ video_id: id, upload_url: `https://rupload.facebook.com/video-upload/v26.0/${id}` }); }
      state.fbPosts.push({ kind: 'reel', id: form.video_id, form });
      return json({ success: true });
    }
    if (method === 'GET' && parts[1] === 'posts') return json({ data: state.fbPosts.filter((p) => p.kind === 'feed').map((p) => ({ id: p.id, message: p.message, created_time: p.created_time, permalink_url: `https://www.facebook.com/${p.id}` })) });
    if (method === 'DELETE' && parts.length === 1) { state.deleted.push(parts[0]); return json({ success: true }); }
    if (method === 'POST' && parts.length === 1 && form.scheduled_publish_time) return json({ success: true });
    // container / object reads
    if (method === 'GET' && parts.length === 1) {
      const c = state.containers.get(parts[0]);
      if (c) return json({ status_code: statusOf(c), status: 'Finished: Media has been uploaded and it is ready to be published.' });
      const fields = query.get('fields') ?? '';
      if (fields.includes('is_published') || fields.includes('published')) return json({ id: parts[0], is_published: opts.isPublished ?? true, published: opts.isPublished ?? true, permalink_url: `/${parts[0]}`, post_id: `${PAGE_ID}_p${parts[0]}` });
      if (fields.includes('permalink')) return json({ id: parts[0], permalink: `https://www.instagram.com/p/${parts[0]}/` });
      if (fields === 'images') return json({ images: [{ width: 320, source: 'https://cdn.fb.test/small.jpg' }, { width: 1080, source: 'https://cdn.fb.test/big.jpg' }] });
    }
    return undefined;
  }

  function threads(req) {
    const { method, path, form, query } = req;
    const parts = path.split('/').filter(Boolean);
    if (method === 'POST' && parts[1] === 'threads') {
      const id = next('tc');
      state.containers.set(id, { id, params: form, statuses: [...(opts.threadStatuses ?? ['FINISHED'])] });
      return json({ id });
    }
    if (method === 'POST' && parts[1] === 'threads_publish') {
      const c = state.containers.get(form.creation_id);
      if (!c) return graphError(100, 'invalid creation_id');
      c.statuses = ['PUBLISHED'];
      const id = next('t');
      state.threads.unshift({ id, text: c.params.text ?? '', timestamp: new Date(opts.now?.() ?? Date.now()).toISOString(), permalink: `https://www.threads.net/@brand/post/${id}`, params: c.params });
      return json({ id });
    }
    if (method === 'GET' && parts[1] === 'threads_publishing_limit') return json({ data: [{ quota_usage: opts.quotaUsed ?? 2, config: { quota_total: 250, quota_duration: 86400 } }] });
    if (method === 'GET' && parts[1] === 'threads') return json({ data: state.threads.slice(0, Number(query.get('limit') ?? 10)) });
    if (method === 'GET' && parts.length === 1) {
      const c = state.containers.get(parts[0]);
      if (c) return json({ status: statusOf(c), error_message: null });
      return json({ id: parts[0], permalink: `https://www.threads.net/@brand/post/${parts[0]}` });
    }
    return undefined;
  }

  function s3(req) {
    const key = req.path;
    if (req.method === 'PUT') { state.s3.set(key, { type: req.headers['content-type'] }); return new Response('', { status: 200 }); }
    if (req.method === 'DELETE') { state.s3.delete(key); return new Response(null, { status: 204 }); }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const obj = state.s3.get(key);
      return obj ? new Response(req.method === 'HEAD' ? null : 'x', { status: 200, headers: { 'content-type': obj.type ?? 'image/jpeg' } }) : new Response('', { status: 404 });
    }
    return undefined;
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const req = {
      method, url, host: url.host, path: url.pathname.replace(/^\/v\d+\.\d+/, ''), query: url.searchParams,
      form: { ...Object.fromEntries(url.searchParams), ...formOf(init.body) }, headers: headersOf(init.headers), body: init.body,
    };
    calls.push(req);
    for (const h of hooks) {
      const r = await h(req);
      if (r instanceof Response) return r;
      if (r !== undefined && r !== null) return json(r);
    }
    let res;
    if (url.host === 'graph.facebook.com' || url.host === 'graph-video.facebook.com') res = meta(req);
    else if (url.host === 'rupload.facebook.com') { state.uploads.push(req); res = json({ success: true }); }
    else if (url.host === 'graph.threads.net' || url.host === 'graph.threads.com') res = threads(req);
    else if (url.host.endsWith('s3.test')) res = s3(req);
    return res ?? graphError(803, `unhandled ${method} ${url.host}${req.path}`);
  }

  return {
    fetch: fetchImpl,
    calls,
    state,
    override(fn) { hooks = [...hooks, fn]; return () => { hooks = hooks.filter((h) => h !== fn); }; },
    reset() { hooks = []; calls.length = 0; },
    /** Calls whose path matches (string = exact path, RegExp = test). */
    find(method, pathMatch) {
      return calls.filter((c) => c.method === method && (typeof pathMatch === 'string' ? c.path === pathMatch : pathMatch.test(c.path)));
    },
  };
}

// ---- DB setup shared by the publishing tests ---------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb, closeDb } from '../../../src/main/db/index.js';
import { upsertAccount } from '../../../src/main/db/queries/accounts.js';
import { upsertProfile } from '../../../src/main/db/queries/profiles.js';
import { insertAsset, createPost } from '../../../src/main/db/queries/planner.js';
import { storeToken } from '../../../src/main/config/store.js';
import { setMediaRoot } from '../../../src/main/planner/assets.js';

export const USER_TOKEN = 'USER_TOKEN';
export const THREADS_TOKEN = 'TH_TOKEN';
export const ACCOUNTS = Object.freeze({ ig: IG_ID, fb: `fb-${PAGE_ID}`, th: `th-${TH_ID}` });

/** Opens a temp DB with an IG account (linked Page 555), a FB Page account, a Threads account and both profiles. */
export function setupPublishingDb(prefix = 'metadash-pub-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  openDb(path.join(dir, 'data.db'));
  const mediaRoot = path.join(dir, 'planner-media');
  fs.mkdirSync(path.join(mediaRoot, 'tmp'), { recursive: true });
  setMediaRoot(mediaRoot);
  const metaProfile = upsertProfile({ label: 'Meta', appId: '1', tokenRef: storeToken('profile:1', USER_TOKEN), tokenExpiresAt: null });
  upsertProfile({ label: 'Threads', appId: '2', tokenRef: storeToken('threads:2', THREADS_TOKEN), tokenExpiresAt: null, platform: 'threads' });
  upsertAccount({ igId: ACCOUNTS.ig, platform: 'instagram', externalId: IG_ID, pageId: PAGE_ID, username: 'brand', profileId: metaProfile });
  upsertAccount({ igId: ACCOUNTS.fb, platform: 'facebook', externalId: PAGE_ID, pageId: PAGE_ID, username: 'brandpage', profileId: metaProfile });
  upsertAccount({ igId: ACCOUNTS.th, platform: 'threads', externalId: TH_ID, username: 'brand', profileId: null });

  function makeAsset({ kind = 'image', format = kind === 'image' ? 'jpeg' : 'mp4', width = 1080, height = 1350, durationMs = null, bytes = 64 } = {}) {
    const body = crypto.randomBytes(bytes);
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    const ext = { jpeg: 'jpg', png: 'png', webp: 'webp', mp4: 'mp4', mov: 'mov' }[format];
    const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' }[format];
    fs.writeFileSync(path.join(mediaRoot, `${sha}.${ext}`), body);
    return insertAsset({
      sha256: sha, fileName: `file.${ext}`, storedPath: `${sha}.${ext}`, mime, kind, bytes, width, height, rotation: 0,
      durationMs: kind === 'video' ? durationMs ?? 15_000 : null, videoCodec: kind === 'video' ? 'avc1' : null, audioCodec: kind === 'video' ? 'mp4a' : null, fps: kind === 'video' ? 30 : null,
    });
  }

  /** createPost + returns id. targets: [{ accountId, platform, format, mode?, options? }] ; assets: asset rows. */
  function makePost({ caption = 'Hello #launch', firstComment = null, scheduledAt = null, status = 'draft', targets, assets = [] }) {
    return createPost({ caption, firstComment, scheduledAt, status, targets, assets: assets.map((a) => ({ assetId: a.id, role: a.role ?? 'media' })) }, { actor: 'system' });
  }

  return {
    dir, mediaRoot, makeAsset, makePost,
    cleanup() { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
