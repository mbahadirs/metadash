import { describe, it, expect } from 'vitest';
import { createAuthenticator } from '../worker/src/auth.js';
import { createRateLimiter } from '../worker/src/ratelimit.js';
import { deriveKey, signedHeaders, sha256Hex, generateSecret } from '../src/shared/publish/protocol.js';
import { redact, redactText } from '../worker/src/log.js';

const SECRET = generateSecret();
const lower = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

function request({ secret = SECRET, method = 'GET', path = '/v1/info', body = '', now = 1_800_000_000_000, nonce } = {}) {
  const headers = lower(signedHeaders(deriveKey(secret, 'auth'), { method, path, body, now, ...(nonce ? { nonce } : {}) }));
  return { method, path, headers, bodyHash: sha256Hex(body) };
}

describe('worker request authentication', () => {
  const T = 1_800_000_000_000;

  it('accepts a correctly signed request', () => {
    const auth = createAuthenticator({ secret: SECRET, now: () => T });
    expect(auth.verify(request({ now: T }))).toEqual({ ok: true });
  });

  it('rejects a wrong secret, a tampered path, method or body', () => {
    const auth = createAuthenticator({ secret: SECRET, now: () => T });
    expect(auth.verify(request({ secret: generateSecret(), now: T }))).toMatchObject({ ok: false, status: 401, code: 'unauthorized' });
    expect(auth.verify({ ...request({ now: T }), path: '/v1/changes?since=0' })).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(auth.verify({ ...request({ now: T }), method: 'DELETE' })).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(auth.verify({ ...request({ method: 'POST', body: '{"a":1}', now: T }), bodyHash: sha256Hex('{"a":2}') })).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('rejects clock skew beyond ±300 s but tolerates less', () => {
    const auth = createAuthenticator({ secret: SECRET, now: () => T });
    expect(auth.verify(request({ now: T - 301_000 }))).toMatchObject({ ok: false, code: 'clock_skew' });
    expect(auth.verify(request({ now: T + 301_000 }))).toMatchObject({ ok: false, code: 'clock_skew' });
    expect(auth.verify(request({ now: T - 299_000 }))).toEqual({ ok: true });
  });

  it('rejects a replayed nonce', () => {
    const auth = createAuthenticator({ secret: SECRET, now: () => T });
    const req = request({ now: T });
    expect(auth.verify(req)).toEqual({ ok: true });
    expect(auth.verify(req)).toMatchObject({ ok: false, code: 'replay' });
  });

  it('rejects missing headers and a wrong protocol version', () => {
    const auth = createAuthenticator({ secret: SECRET, now: () => T });
    const req = request({ now: T });
    expect(auth.verify({ ...req, headers: { ...req.headers, 'x-md-protocol': '2' } })).toMatchObject({ ok: false, status: 400, code: 'protocol_mismatch' });
    const { 'x-md-sig': _sig, ...noSig } = req.headers;
    expect(auth.verify({ ...req, headers: noSig })).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('switches keys on rotation', () => {
    const auth = createAuthenticator({ secret: SECRET, now: () => T });
    const next = generateSecret();
    auth.setSecret(next);
    expect(auth.verify(request({ now: T }))).toMatchObject({ ok: false });
    expect(auth.verify(request({ secret: next, now: T }))).toEqual({ ok: true });
  });
});

describe('worker rate limiting', () => {
  it('limits requests per key and refills over time', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 3, perMinute: 3, now: () => t });
    expect([rl.take('a'), rl.take('a'), rl.take('a'), rl.take('a')]).toEqual([true, true, true, false]);
    expect(rl.take('b')).toBe(true);
    t += 20_000;
    expect(rl.take('a')).toBe(true);
  });

  it('locks a key out after repeated authentication failures', () => {
    let t = 0;
    const rl = createRateLimiter({ maxFailures: 3, blockMs: 60_000, now: () => t });
    rl.fail('x'); rl.fail('x');
    expect(rl.blocked('x')).toBe(false);
    rl.fail('x');
    expect(rl.blocked('x')).toBe(true);
    t += 61_000;
    expect(rl.blocked('x')).toBe(false);
  });
});

describe('worker logger redaction', () => {
  it('never logs tokens, secrets or bodies', () => {
    expect(redact({ token: 'EAAB123', nested: { accessToken: 'x', ok: 1 }, body: 'caption' })).toEqual({ token: '[redacted]', nested: { accessToken: '[redacted]', ok: 1 }, body: '[redacted]' });
    expect(redactText('failed with EAABsbCS1iHgBAKZCZBCZBZCZB0ZBZA token')).not.toContain('EAABsbCS1iHgBAKZCZBCZBZCZB0ZBZA');
  });
});
