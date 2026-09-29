import { MetaError, NetworkError } from './errors.js';
import { rateLimiter } from './rateLimiter.js';

export const GRAPH_VERSION = 'v26.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let apiCallCounter = 0;
export function apiCallsSoFar() {
  return apiCallCounter;
}
export function resetApiCalls() {
  apiCallCounter = 0;
}

export const REQUEST_TIMEOUT_MS = 30_000;
/** Uploads (multipart `source`, rupload binary bodies) can take minutes. */
export const UPLOAD_TIMEOUT_MS = 30 * 60_000;

/** Builds the MetaError for a failed Graph response (Graph `error` envelope, or rupload's `debug_info`). */
function toMetaError(body, res, path, source) {
  const e = body?.error ?? (body?.debug_info ? { message: body.debug_info.message, type: body.debug_info.type } : null);
  return new MetaError({
    code: e?.code ?? res.status,
    subcode: e?.error_subcode,
    message: e?.message ?? `HTTP ${res.status}`,
    type: e?.type,
    endpoint: path,
    status: res.status,
    source,
    fbtraceId: e?.fbtrace_id ?? res.headers?.get?.('x-fb-trace-id') ?? null,
    userTitle: e?.error_user_title,
    userMessage: e?.error_user_msg,
  });
}

const encodeParam = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Builds a Graph-style HTTP client (Meta Graph API, Threads Graph API) sharing the retry/back-off, pagination and
 * error envelope logic. Every client increments the global API-call counter.
 *
 * Reads (`get`, `getAll`) retry rate-limit codes up to 5 times. Writes (`post`, `postForm`, `postBinary`, `del`) never
 * retry unless the caller passes `maxRetries` (only for idempotent calls): a retried publish could post twice.
 * @param {{ base: string, limiter: import('./rateLimiter.js').RateLimiter, name?: string }} opts
 * @returns {{ name: string, base: string, limiter: object, get: Function, getAll: Function, post: Function, postForm: Function,
 *   postBinary: Function, del: Function, delay: () => Promise<void> }}
 */
export function createGraphClient({ base, limiter, name = 'meta' }) {
  const urlFor = (path, baseOverride) => (path.startsWith('http') ? new URL(path) : new URL((baseOverride ?? base) + path));

  /** One logical request (with optional retries). `init()` builds a fresh RequestInit per attempt (bodies are single-use). */
  async function request(url, init, { path, maxRetries = 0, signal, timeoutMs = REQUEST_TIMEOUT_MS }) {
    let attempt = 0;
    for (;;) {
      let res;
      try {
        apiCallCounter += 1;
        const timeout = AbortSignal.timeout(timeoutMs);
        res = await fetch(url, { ...init(), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      } catch (e) {
        if (e?.name === 'AbortError' && signal?.aborted) throw e;
        throw new NetworkError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : e?.message ?? 'network error', path);
      }
      limiter.observe(res.headers);
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (res.ok && !body?.error) return body;
      const err = toMetaError(body, res, path, name);
      if (err.isRetryable && attempt < maxRetries) {
        attempt += 1;
        const backoff = Math.min(60_000, 1000 * 2 ** attempt) * limiter.multiplier();
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }

  /**
   * GET with retry/backoff for transient codes.
   * @param {string} path   e.g. '/me/accounts' or a full URL (pagination)
   * @param {object} params query params (access_token added automatically)
   */
  async function get(path, params = {}, { token, maxRetries = 5, signal } = {}) {
    const url = urlFor(path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, encodeParam(v));
    }
    if (token && !url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
    return request(url, () => ({}), { path, maxRetries, signal });
  }

  /**
   * POST x-www-form-urlencoded (token in the body). No automatic retry: pass maxRetries only for idempotent calls.
   * @param {string} path
   * @param {object} params objects/arrays are JSON-encoded (e.g. attached_media, children)
   * @param {{ token?: string, maxRetries?: number, signal?: AbortSignal, base?: string, timeoutMs?: number }} [opts]
   */
  async function post(path, params = {}, { token, maxRetries = 0, signal, base: baseOverride, timeoutMs } = {}) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      form.set(k, encodeParam(v));
    }
    if (token && !form.has('access_token')) form.set('access_token', token);
    const body = form.toString();
    return request(urlFor(path, baseOverride), () => ({ method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }), { path, maxRetries, signal, timeoutMs });
  }

  /**
   * POST multipart/form-data (FB photos/videos `source`: append `await fs.openAsBlob(file)`). `base` overrides the
   * host (e.g. 'https://graph-video.facebook.com/v26.0'). No automatic retry.
   * @param {string} path
   * @param {FormData} formData
   */
  async function postForm(path, formData, { token, signal, base: baseOverride, maxRetries = 0, timeoutMs = UPLOAD_TIMEOUT_MS } = {}) {
    if (token && !formData.has('access_token')) formData.set('access_token', token);
    return request(urlFor(path, baseOverride), () => ({ method: 'POST', body: formData }), { path, maxRetries, signal, timeoutMs });
  }

  /**
   * POST a raw body to an absolute URL (rupload.facebook.com resumable uploads). The caller sets the headers, e.g.
   * { Authorization: `OAuth ${token}`, offset: '0', file_size: String(bytes) }. No automatic retry.
   * @param {string} url absolute URL
   * @param {Blob|Buffer|ReadableStream} blob
   */
  async function postBinary(url, blob, { headers = {}, signal, timeoutMs = UPLOAD_TIMEOUT_MS } = {}) {
    const target = new URL(url);
    return request(target, () => ({ method: 'POST', body: blob, headers, ...(blob instanceof ReadableStream ? { duplex: 'half' } : {}) }), { path: target.pathname, maxRetries: 0, signal, timeoutMs });
  }

  /** DELETE (FB scheduled post cancel, unpublished photo cleanup). Idempotent, but no retry unless asked. */
  async function del(path, params = {}, { token, maxRetries = 0, signal } = {}) {
    const url = urlFor(path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, encodeParam(v));
    if (token && !url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
    return request(url, () => ({ method: 'DELETE' }), { path, maxRetries, signal });
  }

  /** Follows `paging.next` until exhausted or `max` items collected. */
  async function getAll(path, params = {}, opts = {}) {
    const items = [];
    let next = null;
    let page = await get(path, params, opts);
    for (;;) {
      items.push(...(page.data ?? []));
      next = page.paging?.next ?? null;
      if (!next || (opts.max && items.length >= opts.max)) break;
      if (opts.stopWhen && opts.stopWhen(items)) break;
      await sleep(limiter.currentDelayMs());
      page = await get(next, {}, opts);
    }
    return items;
  }

  const delay = () => sleep(limiter.currentDelayMs());

  return { name, base, limiter, get, getAll, post, postForm, postBinary, del, delay };
}

/** Shared Meta Graph client (Instagram, Facebook Pages, Ads, auth). */
export const metaClient = createGraphClient({ base: GRAPH_BASE, limiter: rateLimiter, name: 'meta' });

export function graphGet(path, params = {}, opts = {}) {
  return metaClient.get(path, params, opts);
}

export function graphGetAll(path, params = {}, opts = {}) {
  return metaClient.getAll(path, params, opts);
}

export function graphDelay() {
  return metaClient.delay();
}
