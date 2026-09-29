/**
 * Fake `fetch` for the platform APIs. Routes by host:
 *   graph.facebook.com / rupload.facebook.com     → `meta` handlers in order (Instagram first, then Facebook)
 *   graph.threads.net / .com                      → `threads` handlers in order
 *   oauth2.googleapis.com, www.googleapis.com, youtubeanalytics.googleapis.com, accounts.google.com → `google` (v2.0, C1)
 *   open.tiktokapis.com, www.tiktok.com          → `tiktok` (v2.0, C2)
 * A handler receives { url, path, query, method, body, headers } (path without a Graph /vNN.N prefix; body = the raw
 * request body string/URLSearchParams/Blob or undefined) and returns a Response, or null/undefined to pass to the next
 * handler. Unhandled requests get a Graph-style error 803 (use your own fixture's error shape in handlers).
 * Every request is recorded in `calls` as `path` (+ `?metric=…` when present); `requests` keeps { host, path, method }.
 */
export const USAGE_HEADERS = { 'x-app-usage': JSON.stringify({ call_count: 12, total_time: 5, total_cputime: 3 }) };

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...USAGE_HEADERS, ...headers } });
}

export function graphError(code, message, status = 400) {
  return json({ error: { code, message, type: 'OAuthException' } }, status);
}

export const HOST_GROUPS = Object.freeze({
  'graph.facebook.com': 'meta',
  'rupload.facebook.com': 'meta',
  'graph.threads.net': 'threads',
  'graph.threads.com': 'threads',
  'oauth2.googleapis.com': 'google',
  'www.googleapis.com': 'google',
  'youtubeanalytics.googleapis.com': 'google',
  'accounts.google.com': 'google',
  'open.tiktokapis.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
});

const hostGroup = (host) => HOST_GROUPS[host] ?? null;

/**
 * @param {{ meta?: Function[], threads?: Function[], google?: Function[], tiktok?: Function[] }} routes
 * @returns {((input: string|URL|Request, init?: object) => Promise<Response>) & { calls: string[], requests: object[], handle: (url: string, init?: object) => Response }}
 */
export function createFakeFetch({ meta = [], threads = [], google = [], tiktok = [] } = {}) {
  const calls = [];
  const requests = [];
  const groups = { meta, threads, google, tiktok };
  const handle = (raw, init = {}) => {
    const url = new URL(raw);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, '');
    const query = url.searchParams;
    const method = String(init.method ?? 'GET').toUpperCase();
    calls.push(path + (query.get('metric') ? `?metric=${query.get('metric')}` : ''));
    requests.push({ host: url.host, path, method });
    for (const h of groups[hostGroup(url.host)] ?? []) {
      const res = h({ url, path, query, method, body: init.body, headers: init.headers ?? {} });
      if (res) return res;
    }
    return graphError(803, `unhandled ${path}`);
  };
  const fakeFetch = async (input, init) => handle(typeof input === 'string' ? input : input.url ?? input.toString(), init);
  return Object.assign(fakeFetch, { calls, requests, handle });
}
