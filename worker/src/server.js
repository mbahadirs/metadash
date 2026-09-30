import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PROTOCOL_VERSION, isSha256, sha256Hex, TOKEN_KEY_RE, HEADER_PROTOCOL, HEADER_TS, HEADER_NONCE, HEADER_SIG } from './shared.js';
import { createStore } from './store.js';
import { createAuthenticator } from './auth.js';
import { createDataVault, openRotation } from './crypto.js';
import { createRateLimiter } from './ratelimit.js';
import { createMediaStore, MEDIA_MAX_BYTES, isAllowedMime } from './media.js';
import { createTokenVault, TokenRejected } from './tokens.js';
import { createScheduler } from './scheduler.js';
import { upsertItems, recallItem, toChange, queueCounts, isItemId, MAX_BATCH } from './items.js';
import { silentLogger } from './log.js';
import { clientKeyFor } from './clientip.js';

/**
 * HTTP API (node:http, no framework). Every route except GET /v1/health (Docker HEALTHCHECK: {ok, protocol, version})
 * and GET /m/<sha256> (signed expiring URL for Meta's media crawler) requires an HMAC-signed request (auth.js).
 * Per-IP rate limit on every route and an auth-failure lockout. Only requests that carry signature headers count toward
 * the lockout (unsigned scans get 401 and are bounded by the per-minute limiter); /v1/health is never locked out.
 * Client address: clientip.js (X-Forwarded-For only with MD_TRUST_PROXY=1 and a private/loopback proxy peer).
 * JSON bodies ≤ 1 MB; media uploads ≤ 100 MB streamed.
 *
 *   GET    /v1/info                     → { version, time, tz, queue, publicMediaUrl, tokens }
 *   PUT    /v1/tokens/:key              { platform, accountId, envelope, expiresAt, scopes, broad? }
 *   DELETE /v1/tokens/:key
 *   PUT    /v1/media/:sha256            raw bytes (Content-Type = mime) → { sha256, bytes, url }
 *   POST   /v1/items:batch              { items } → { results }
 *   DELETE /v1/items/:id?revision=      recall (409 once publishing started)
 *   GET    /v1/changes?since=<seq>      → { seq, more, changes }
 *   POST   /v1/rotate                   { envelope } (new secret sealed with the current one) → { rotated: true }
 *   POST   /v1/reset                    deletes every item, token and media file (desktop "disconnect")
 */
export const WORKER_VERSION = '2.0.0';
export const JSON_LIMIT = 1024 * 1024;

const SECURITY_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function send(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), ...headers });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) { reject(new HttpError(413, 'too_large')); req.resume(); return; }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(buf) {
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'bad_json'); }
}

function secretState(store, envSecret, vault) {
  const saved = store.getMeta('rotatedSecret');
  if (saved && saved.fromHash === sha256Hex(envSecret)) {
    try { return vault.open(saved.sealed, 'secret'); } catch { /* data key changed: fall back to the env secret */ }
  }
  return envSecret;
}

/**
 * @param {{ dataDir: string, secret: string, dataKey: string, publicUrl?: string|null, fetchImpl?: typeof fetch,
 *   now?: () => number, strictScopes?: boolean, trustProxy?: boolean, log?: object, tz?: string,
 *   rateLimit?: { capacity?: number, perMinute?: number, maxFailures?: number } }} opts
 */
export function createWorkerApp(opts) {
  const { dataDir, dataKey, publicUrl = null, fetchImpl = globalThis.fetch, now = Date.now, strictScopes = true, trustProxy = false, log = silentLogger } = opts;
  if (typeof opts.secret !== 'string' || opts.secret.length < 32) throw Object.assign(new Error('MD_WORKER_SECRET must be at least 32 characters'), { code: 'BAD_SECRET' });
  const vault = createDataVault(dataKey);
  const store = createStore({ dir: dataDir, now });
  let secret = secretState(store, opts.secret, vault);
  const getSecret = () => secret;
  const auth = createAuthenticator({ secret, now });
  const limiter = createRateLimiter({ now, ...(opts.rateLimit ?? {}) });
  const media = createMediaStore({ dir: dataDir, store, getSecret, publicUrl, now });
  const tokens = createTokenVault({ store, vault, getSecret, fetchImpl, now, strictScopes, log });
  const scheduler = createScheduler({ store, tokens, media, fetchImpl, now, log });
  const tz = opts.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const clientKey = (req) => clientKeyFor({ trustProxy, remoteAddress: req.socket.remoteAddress, forwardedFor: req.headers['x-forwarded-for'] });
  const bearsSignature = (req) => [HEADER_TS, HEADER_NONCE, HEADER_SIG].some((h) => req.headers[h] != null);

  function authenticate(req, path, bodyHash, ip) {
    if (!bearsSignature(req) && req.headers[HEADER_PROTOCOL] == null) throw new HttpError(401, 'unauthorized'); // unsigned: no lockout
    const r = auth.verify({ method: req.method, path, headers: req.headers, bodyHash });
    if (!r.ok) {
      if (bearsSignature(req)) limiter.fail(ip);
      log.warn('auth rejected', { code: r.code, ip });
      throw new HttpError(r.status, r.code);
    }
  }

  async function signedJson(req, path, ip) {
    const buf = await readBody(req, JSON_LIMIT);
    authenticate(req, path, sha256Hex(buf), ip);
    return parseJson(buf);
  }

  // ---- routes ----------------------------------------------------------------------------------------------------
  function info() {
    return {
      version: WORKER_VERSION, protocol: PROTOCOL_VERSION, time: now(), tz, queue: queueCounts(store), publicMediaUrl: media.publicEnabled,
      tokens: tokens.list(),
    };
  }

  async function putToken(req, res, key, path, ip) {
    const body = await signedJson(req, path, ip);
    if (!TOKEN_KEY_RE.test(key)) throw new HttpError(400, 'bad_token_key');
    try {
      send(res, 200, await tokens.accept(key, body));
    } catch (e) {
      if (e instanceof TokenRejected) throw new HttpError(422, e.code, e.scopes ? { scopes: e.scopes } : {});
      throw e;
    }
  }

  async function putMedia(req, res, sha, path, ip) {
    // The signed body hash IS the path's sha256, so the request is authenticated before the body is read.
    authenticate(req, path, sha, ip);
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    if (!isAllowedMime(mime)) { req.resume(); throw new HttpError(415, 'unsupported_media_type'); }
    if (Number(req.headers['content-length'] ?? 0) > MEDIA_MAX_BYTES) { req.resume(); throw new HttpError(413, 'too_large'); }
    try {
      const r = await media.put(sha, req, { mime });
      send(res, 200, { sha256: sha, bytes: r.bytes, url: media.signedUrl(sha) });
    } catch (e) {
      if (e.code === 'too_large') throw new HttpError(413, 'too_large');
      if (e.code === 'hash_mismatch') throw new HttpError(422, 'hash_mismatch');
      throw e;
    }
  }

  function serveMedia(req, res, sha, url) {
    if (!media.publicEnabled || !media.verifySigned(sha, url.searchParams.get('exp'), url.searchParams.get('sig')) || !media.has(sha)) throw new HttpError(404, 'not_found');
    const meta = media.meta(sha);
    res.writeHead(200, { ...SECURITY_HEADERS, 'cache-control': 'private, max-age=3600', 'content-type': meta.mime ?? 'application/octet-stream', 'content-length': meta.bytes });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(media.pathOf(sha)).pipe(res);
  }

  async function rotate(req, res, path, ip) {
    const body = await signedJson(req, path, ip);
    let next;
    try { next = openRotation(secret, body.envelope); } catch { throw new HttpError(422, 'bad_envelope'); }
    if (typeof next !== 'string' || next.length < 32) throw new HttpError(422, 'bad_secret');
    store.setMeta('rotatedSecret', { sealed: vault.seal(next, 'secret'), fromHash: sha256Hex(opts.secret), at: now() });
    secret = next;
    auth.setSecret(next);
    log.info('secret rotated');
    send(res, 200, { rotated: true });
  }

  async function reset(req, res, path, ip) {
    await signedJson(req, path, ip);
    await media.removeAll();
    store.reset();
    log.info('worker reset by desktop');
    send(res, 200, { reset: true });
  }

  async function route(req, res) {
    const ip = clientKey(req);
    if (!limiter.take(ip)) throw new HttpError(429, 'rate_limited');
    const url = new URL(req.url, 'http://worker.local');
    const path = req.url; // signed exactly as sent (path + query)
    const p = url.pathname;
    const m = req.method;

    // Health (Docker HEALTHCHECK, desktop reachability test) is unauthenticated and never subject to the lockout.
    if (m === 'GET' && p === '/v1/health') return send(res, 200, { ok: true, protocol: PROTOCOL_VERSION, version: WORKER_VERSION });
    if (limiter.blocked(ip)) { req.resume(); throw new HttpError(429, 'locked_out'); }
    const mediaGet = p.match(/^\/m\/([a-f0-9]{64})$/);
    if ((m === 'GET' || m === 'HEAD') && mediaGet) return serveMedia(req, res, mediaGet[1], url);

    if (m === 'GET' && p === '/v1/info') { await signedJson(req, path, ip); return send(res, 200, info()); }
    if (m === 'GET' && p === '/v1/changes') {
      await signedJson(req, path, ip);
      const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0);
      const r = store.changesSince(since);
      return send(res, 200, { seq: r.seq, more: r.more, changes: r.changes.map(toChange) });
    }
    if (m === 'POST' && p === '/v1/items:batch') {
      const body = await signedJson(req, path, ip);
      if (!Array.isArray(body.items) || body.items.length > MAX_BATCH) throw new HttpError(400, 'bad_batch');
      const results = upsertItems({ store, tokens, media, now }, body.items);
      if (results.some((r) => r.result === 'accepted')) setImmediate(() => scheduler.tick());
      return send(res, 200, { results });
    }
    const item = p.match(/^\/v1\/items\/([^/]+)$/);
    if (m === 'DELETE' && item) {
      await signedJson(req, path, ip);
      const id = decodeURIComponent(item[1]).toLowerCase();
      if (!isItemId(id)) throw new HttpError(400, 'bad_id');
      const r = recallItem(store, id, url.searchParams.get('revision'));
      return send(res, r.status, r.body);
    }
    const tok = p.match(/^\/v1\/tokens\/([^/]+)$/);
    if (m === 'PUT' && tok) return putToken(req, res, decodeURIComponent(tok[1]), path, ip);
    if (m === 'DELETE' && tok) {
      await signedJson(req, path, ip);
      return send(res, 200, { deleted: tokens.remove(decodeURIComponent(tok[1])) });
    }
    const med = p.match(/^\/v1\/media\/([^/]+)$/);
    if (m === 'PUT' && med) {
      if (!isSha256(med[1])) { req.resume(); throw new HttpError(400, 'bad_sha'); }
      return putMedia(req, res, med[1], path, ip);
    }
    if (m === 'POST' && p === '/v1/rotate') return rotate(req, res, path, ip);
    if (m === 'POST' && p === '/v1/reset') return reset(req, res, path, ip);
    req.resume();
    throw new HttpError(404, 'not_found');
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, ...e.extra } });
      const ref = crypto.randomUUID().slice(0, 8);
      log.error('request failed', { ref, message: e?.message });
      return send(res, 500, { error: { code: 'internal', ref } });
    });
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 30 * 60_000;

  return {
    server,
    store,
    scheduler,
    tokens,
    media,
    listen(port = 8787, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    async close() {
      await scheduler.stop();
      const closed = new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closed;
    },
  };
}
