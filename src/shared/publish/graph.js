/**
 * Minimal Graph API plumbing shared by the desktop publishers and the self-hosted worker. Pure ESM, fetch only:
 * no electron / db / config / i18n imports (tests/shared.publish.purity.test.js enforces it).
 *
 * The desktop keeps its own rate-limited client (src/main/meta/client.js); the worker uses createFetchGraphClient().
 * Both clients throw errors named 'MetaError' / 'NetworkError' with the same fields, and errors.js classifies them by
 * name (duck typing), so one classification serves both processes.
 */
export const GRAPH_VERSION = 'v26.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const THREADS_BASE = 'https://graph.threads.net/v1.0';
export const REQUEST_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 30 * 60_000;

/** Same fields as src/main/meta/errors.js MetaError (name 'MetaError'). */
export class GraphError extends Error {
  constructor({ code, subcode, message, type, endpoint, status, source, fbtraceId, userTitle, userMessage }) {
    super(message);
    this.name = 'MetaError';
    this.code = code ?? null;
    this.subcode = subcode ?? null;
    this.type = type ?? null;
    this.endpoint = endpoint ?? null;
    this.status = status ?? null;
    this.source = source ?? null;
    this.fbtraceId = fbtraceId ?? null;
    this.userTitle = userTitle ?? null;
    this.userMessage = userMessage ?? null;
  }
}

export class GraphNetworkError extends Error {
  constructor(message, endpoint) {
    super(message);
    this.name = 'NetworkError';
    this.endpoint = endpoint;
    this.code = 'NETWORK';
  }
}

export const isMetaError = (e) => e?.name === 'MetaError' && e?.code != null;
export const isGone = (e) => e?.name === 'MetaError' && (e.code === 100 || e.status === 404);

const encodeParam = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

function toGraphError(body, res, path, source) {
  const e = body?.error ?? (body?.debug_info ? { message: body.debug_info.message, type: body.debug_info.type } : null);
  return new GraphError({
    code: e?.code ?? res.status, subcode: e?.error_subcode, message: e?.message ?? `HTTP ${res.status}`, type: e?.type, endpoint: path,
    status: res.status, source, fbtraceId: e?.fbtrace_id ?? null, userTitle: e?.error_user_title, userMessage: e?.error_user_msg,
  });
}

/**
 * Small Graph client (no retries: the caller's scheduler owns retry/backoff). Tokens travel in the request body or the
 * `access_token` query parameter exactly like the desktop client, never in logs.
 * @param {{ base: string, name?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
export function createFetchGraphClient({ base, name = 'meta', fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const urlFor = (path, baseOverride) => (path.startsWith('http') ? new URL(path) : new URL((baseOverride ?? base) + path));

  async function request(url, init, { path, timeout = timeoutMs }) {
    let res;
    try {
      res = await fetchImpl(url.toString(), { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      throw new GraphNetworkError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : e?.message ?? 'network error', path);
    }
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.ok && !body?.error) return body;
    throw toGraphError(body, res, path, name);
  }

  return {
    name,
    base,
    async get(path, params = {}, { token, base: b } = {}) {
      const url = urlFor(path, b);
      for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, encodeParam(v));
      if (token && !url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
      return request(url, { method: 'GET' }, { path });
    },
    async post(path, params = {}, { token, base: b } = {}) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v != null) form.set(k, encodeParam(v));
      if (token && !form.has('access_token')) form.set('access_token', token);
      return request(urlFor(path, b), { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }, { path });
    },
    async postForm(path, form, { token, base: b } = {}) {
      if (token && !form.has('access_token')) form.set('access_token', token);
      return request(urlFor(path, b), { method: 'POST', body: form }, { path, timeout: UPLOAD_TIMEOUT_MS });
    },
    async postBinary(url, blob, { headers = {} } = {}) {
      const streamed = typeof ReadableStream !== 'undefined' && blob instanceof ReadableStream;
      return request(urlFor(url), { method: 'POST', body: blob, headers, ...(streamed ? { duplex: 'half' } : {}) }, { path: url, timeout: UPLOAD_TIMEOUT_MS });
    },
    async del(path, params = {}, { token, base: b } = {}) {
      const url = urlFor(path, b);
      for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, encodeParam(v));
      if (token) url.searchParams.set('access_token', token);
      return request(url, { method: 'DELETE' }, { path });
    },
  };
}
