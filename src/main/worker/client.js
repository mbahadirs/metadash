import fs from 'node:fs';
import { Readable } from 'node:stream';
import {
  deriveKey, signedHeaders, seal, sha256Hex, PROTOCOL_VERSION,
} from '../../shared/publish/protocol.js';

/**
 * Signed HTTP client for the self-hosted worker (protocol v1, src/shared/publish/protocol.js). Every request except
 * health() is HMAC-signed; token envelopes are sealed here so a TLS-terminating proxy never sees plaintext tokens.
 * Not to be confused with src/main/publishing/worker.js (the local tray publishing queue).
 */
export const REQUEST_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 30 * 60_000;

export class WorkerHttpError extends Error {
  constructor(status, code, body) {
    super(`worker ${status} ${code}`);
    this.name = 'WorkerHttpError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function normalizeUrl(url) {
  const u = new URL(String(url ?? '').trim());
  if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error('worker URL must be http(s)'), { code: 'BAD_URL' });
  return u.toString().replace(/\/+$/, '');
}

/** @param {{ url: string, secret: string, fetchImpl?: typeof fetch, now?: () => number }} opts */
export function createWorkerClient({ url, secret, fetchImpl = globalThis.fetch, now = Date.now }) {
  const base = normalizeUrl(url);
  const authKey = deriveKey(secret, 'auth');
  const tokenKey = deriveKey(secret, 'token');

  async function request(method, path, { json, stream, bodyHash, contentType, contentLength, timeoutMs = REQUEST_TIMEOUT_MS, allow = [] } = {}) {
    const body = json !== undefined ? JSON.stringify(json) : '';
    const headers = {
      ...signedHeaders(authKey, { method, path, body, bodyHash, now: now() }),
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(contentType ? { 'content-type': contentType } : {}),
      ...(contentLength != null ? { 'content-length': String(contentLength) } : {}),
    };
    let res;
    try {
      res = await fetchImpl(base + path, {
        method, headers, signal: AbortSignal.timeout(timeoutMs),
        ...(stream ? { body: stream, duplex: 'half' } : json !== undefined ? { body } : {}),
      });
    } catch (e) {
      throw Object.assign(new Error(e?.name === 'TimeoutError' ? 'worker timeout' : `worker unreachable: ${e?.message ?? e}`), { code: 'WORKER_OFFLINE' });
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok && !allow.includes(res.status)) throw new WorkerHttpError(res.status, data?.error?.code ?? `http_${res.status}`, data);
    return { status: res.status, data };
  }

  return {
    base,
    async health() {
      const started = now();
      let res;
      try {
        res = await fetchImpl(`${base}/v1/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (e) {
        throw Object.assign(new Error(`worker unreachable: ${e?.message ?? e}`), { code: 'WORKER_OFFLINE' });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new WorkerHttpError(res.status, 'health_failed', data);
      return { ...data, latencyMs: Math.max(0, now() - started) };
    },
    info: async () => (await request('GET', '/v1/info')).data,
    /** Seals the token with K_tok (AAD = key) before it leaves the machine. */
    async putToken(key, { platform, accountId, token, expiresAt = null, scopes = [], broad = false }) {
      const envelope = seal(tokenKey, token, key);
      return (await request('PUT', `/v1/tokens/${encodeURIComponent(key)}`, { json: { platform, accountId, envelope, expiresAt, scopes, broad } })).data;
    },
    deleteToken: async (key) => (await request('DELETE', `/v1/tokens/${encodeURIComponent(key)}`)).data,
    /** Streams a file (content-addressed by its sha256). */
    async putMediaFile(sha256, filePath, mime) {
      const size = fs.statSync(filePath).size;
      const stream = Readable.toWeb(fs.createReadStream(filePath));
      return (await request('PUT', `/v1/media/${sha256}`, { stream, bodyHash: sha256, contentType: mime, contentLength: size, timeoutMs: UPLOAD_TIMEOUT_MS })).data;
    },
    pushItems: async (items) => (await request('POST', '/v1/items:batch', { json: { items } })).data,
    /** @returns {{ recalled: boolean, status: number, code?: string, itemStatus?: string }} */
    async recall(id, revision) {
      const q = revision != null ? `?revision=${encodeURIComponent(revision)}` : '';
      const r = await request('DELETE', `/v1/items/${id}${q}`, { allow: [404, 409] });
      if (r.status === 200) return { recalled: true, status: 200 };
      if (r.status === 404) return { recalled: true, status: 404, code: 'not_found' }; // nothing to recall on the worker
      return { recalled: false, status: r.status, code: r.data?.error?.code ?? 'conflict', itemStatus: r.data?.itemStatus ?? null };
    },
    changes: async (since = 0) => (await request('GET', `/v1/changes?since=${Math.max(0, Number(since) || 0)}`)).data,
    /** Rotation: the new secret travels sealed with the current secret's rotate key. */
    async rotate(nextSecret) {
      const envelope = seal(deriveKey(secret, 'rotate'), nextSecret, 'rotate');
      return (await request('POST', '/v1/rotate', { json: { envelope } })).data;
    },
    reset: async () => (await request('POST', '/v1/reset', { json: {} })).data,
    protocol: PROTOCOL_VERSION,
    bodyHash: sha256Hex,
  };
}
