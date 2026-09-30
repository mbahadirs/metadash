import { deriveKey, signRequest, safeEqual, MAX_SKEW_MS, PROTOCOL_VERSION, HEADER_PROTOCOL, HEADER_TS, HEADER_NONCE, HEADER_SIG } from './shared.js';

/**
 * Request authentication (HMAC-SHA256 over method, path+query, timestamp, nonce and body hash).
 * Rejects: missing headers, wrong protocol, timestamps outside ±300 s, replayed nonces (remembered 10 min, which covers
 * the whole skew window), bad signatures. Nonces live in memory: after a restart the skew window still bounds replays.
 */
export const NONCE_TTL_MS = 600_000;
const NONCE_MAX = 50_000;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** @param {{ secret: string, now?: () => number, maxSkewMs?: number, nonceTtlMs?: number }} opts */
export function createAuthenticator({ secret, now = Date.now, maxSkewMs = MAX_SKEW_MS, nonceTtlMs = NONCE_TTL_MS }) {
  let authKey = deriveKey(secret, 'auth');
  let current = secret;
  const nonces = new Map(); // nonce → expiresAt (insertion order = age)

  function remember(nonce, t) {
    for (const [n, exp] of nonces) {
      if (exp > t && nonces.size < NONCE_MAX) break;
      nonces.delete(n);
    }
    nonces.set(nonce, t + nonceTtlMs);
  }

  /**
   * @param {{ method: string, path: string, headers: Record<string, string|string[]|undefined>, bodyHash: string }} req
   * @returns {{ ok: true } | { ok: false, status: number, code: string }}
   */
  function verify({ method, path, headers, bodyHash }) {
    const h = (name) => { const v = headers[name]; return Array.isArray(v) ? v[0] : v; };
    if (h(HEADER_PROTOCOL) !== String(PROTOCOL_VERSION)) return { ok: false, status: 400, code: 'protocol_mismatch' };
    const ts = h(HEADER_TS);
    const nonce = h(HEADER_NONCE);
    const sig = h(HEADER_SIG);
    if (!ts || !nonce || !sig || !/^\d{10,16}$/.test(ts) || !NONCE_RE.test(nonce)) return { ok: false, status: 401, code: 'unauthorized' };
    const t = now();
    if (Math.abs(t - Number(ts)) > maxSkewMs) return { ok: false, status: 401, code: 'clock_skew' };
    const expected = signRequest(authKey, { method, path, ts, nonce, bodyHash });
    if (!safeEqual(expected, sig)) return { ok: false, status: 401, code: 'unauthorized' };
    const seen = nonces.get(nonce);
    if (seen && seen > t) return { ok: false, status: 401, code: 'replay' };
    remember(nonce, t);
    return { ok: true };
  }

  return {
    verify,
    /** Switches to a rotated secret (new requests must be signed with it). */
    setSecret(next) { authKey = deriveKey(next, 'auth'); current = next; },
    secret: () => current,
    nonceCount: () => nonces.size,
  };
}
