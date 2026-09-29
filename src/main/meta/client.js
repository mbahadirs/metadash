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

/**
 * Builds a Graph-style HTTP client (Meta Graph API, Threads Graph API) sharing the retry/back-off, pagination and
 * error envelope logic. Every client increments the global API-call counter.
 * @param {{ base: string, limiter: import('./rateLimiter.js').RateLimiter, name?: string }} opts
 * @returns {{ name: string, base: string, limiter: object, get: Function, getAll: Function, delay: () => Promise<void> }}
 */
export function createGraphClient({ base, limiter, name = 'meta' }) {
  /**
   * GET with retry/backoff for transient codes.
   * @param {string} path   e.g. '/me/accounts' or a full URL (pagination)
   * @param {object} params query params (access_token added automatically)
   */
  async function get(path, params = {}, { token, maxRetries = 5, signal } = {}) {
    const url = path.startsWith('http') ? new URL(path) : new URL(base + path);
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
      limiter.observe(res.headers);
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
        source: name,
      });
      if (err.isRetryable && attempt < maxRetries) {
        attempt += 1;
        const backoff = Math.min(60_000, 1000 * 2 ** attempt) * limiter.multiplier();
        await sleep(backoff);
        continue;
      }
      throw err;
    }
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

  return { name, base, limiter, get, getAll, delay };
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
