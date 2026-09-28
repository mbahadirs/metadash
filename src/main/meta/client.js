import { MetaError, NetworkError } from './errors.js';
import { rateLimiter } from './rateLimiter.js';

export const GRAPH_VERSION = 'v21.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let apiCallCounter = 0;
export function apiCallsSoFar() {
  return apiCallCounter;
}
export function resetApiCalls() {
  apiCallCounter = 0;
}

/**
 * Graph API GET with retry/backoff for transient codes.
 * @param {string} path   e.g. '/me/accounts' or a full URL (pagination)
 * @param {object} params query params (access_token added automatically)
 */
export const REQUEST_TIMEOUT_MS = 30_000;

export async function graphGet(path, params = {}, { token, maxRetries = 5, signal } = {}) {
  const url = path.startsWith('http') ? new URL(path) : new URL(GRAPH_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  if (token && !url.searchParams.has('access_token')) url.searchParams.set('access_token', token);

  let attempt = 0;
  for (;;) {
    let res;
    try {
      apiCallCounter += 1;
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (e) {
      if (e?.name === 'AbortError' && signal?.aborted) throw e;
      throw new NetworkError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : e?.message ?? 'network error', path);
    }
    rateLimiter.observe(res.headers);
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok && !body?.error) return body;
    const err = new MetaError({
      code: body?.error?.code ?? res.status,
      subcode: body?.error?.error_subcode,
      message: body?.error?.message ?? `HTTP ${res.status}`,
      type: body?.error?.type,
      endpoint: path,
      status: res.status,
    });
    if (err.isRetryable && attempt < maxRetries) {
      attempt += 1;
      const backoff = Math.min(60_000, 1000 * 2 ** attempt) * rateLimiter.multiplier();
      await sleep(backoff);
      continue;
    }
    throw err;
  }
}

/** Follows `paging.next` until exhausted or `max` items collected. */
export async function graphGetAll(path, params = {}, opts = {}) {
  const items = [];
  let next = null;
  let page = await graphGet(path, params, opts);
  for (;;) {
    items.push(...(page.data ?? []));
    next = page.paging?.next ?? null;
    if (!next || (opts.max && items.length >= opts.max)) break;
    if (opts.stopWhen && opts.stopWhen(items)) break;
    await sleep(rateLimiter.currentDelayMs());
    page = await graphGet(next, {}, opts);
  }
  return items;
}

export function graphDelay() {
  return sleep(rateLimiter.currentDelayMs());
}
