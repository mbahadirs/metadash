/**
 * Fake `fetch` for Graph-style APIs. Routes by host:
 *   graph.facebook.com            → `meta` handlers in order (Instagram first, then Facebook)
 *   graph.threads.net / .com      → `threads` handlers in order
 * A handler receives { url, path, query } (path without the /vNN.N prefix) and returns a Response, or null/undefined
 * to pass to the next handler. Unhandled requests get a Graph error 803.
 * Every request is recorded in `calls` as `path` (+ `?metric=…` when present).
 */
export const USAGE_HEADERS = { 'x-app-usage': JSON.stringify({ call_count: 12, total_time: 5, total_cputime: 3 }) };

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...USAGE_HEADERS, ...headers } });
}

export function graphError(code, message, status = 400) {
  return json({ error: { code, message, type: 'OAuthException' } }, status);
}

const hostGroup = (host) => {
  if (host === 'graph.facebook.com') return 'meta';
  if (host === 'graph.threads.net' || host === 'graph.threads.com') return 'threads';
  return null;
};

/**
 * @param {{ meta?: Function[], threads?: Function[] }} routes
 * @returns {((input: string|URL|Request) => Promise<Response>) & { calls: string[], handle: (url: string) => Response }}
 */
export function createFakeFetch({ meta = [], threads = [] } = {}) {
  const calls = [];
  const groups = { meta, threads };
  const handle = (raw) => {
    const url = new URL(raw);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, '');
    const query = url.searchParams;
    calls.push(path + (query.get('metric') ? `?metric=${query.get('metric')}` : ''));
    for (const h of groups[hostGroup(url.host)] ?? []) {
      const res = h({ url, path, query });
      if (res) return res;
    }
    return graphError(803, `unhandled ${path}`);
  };
  const fakeFetch = async (input) => handle(typeof input === 'string' ? input : input.url ?? input.toString());
  return Object.assign(fakeFetch, { calls, handle });
}
