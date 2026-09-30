import { describe, it, expect } from 'vitest';
import { deriveKey, seal, open, generateSecret, encodePairing, decodePairing, mediaSignature } from '../src/shared/publish/protocol.js';
import { createDataVault, openTokenEnvelope, openRotation } from '../worker/src/crypto.js';

const SECRET = generateSecret();

describe('worker envelopes', () => {
  it('round-trips a token sealed by the desktop (AAD = token key)', () => {
    const env = seal(deriveKey(SECRET, 'token'), 'EAAtoken', 'instagram:1');
    expect(env.startsWith('v1.')).toBe(true);
    expect(env).not.toContain('EAAtoken');
    expect(openTokenEnvelope(SECRET, env, 'instagram:1')).toBe('EAAtoken');
  });

  it('refuses a wrong key, a wrong AAD and tampering', () => {
    const env = seal(deriveKey(SECRET, 'token'), 'EAAtoken', 'instagram:1');
    expect(() => openTokenEnvelope(generateSecret(), env, 'instagram:1')).toThrow(expect.objectContaining({ code: 'BAD_ENVELOPE' }));
    expect(() => openTokenEnvelope(SECRET, env, 'instagram:2')).toThrow(expect.objectContaining({ code: 'BAD_ENVELOPE' }));
    const bytes = Buffer.from(env.slice(3), 'base64url');
    bytes[bytes.length - 1] ^= 1;
    expect(() => openTokenEnvelope(SECRET, `v1.${bytes.toString('base64url')}`, 'instagram:1')).toThrow(expect.objectContaining({ code: 'BAD_ENVELOPE' }));
    expect(() => open(deriveKey(SECRET, 'token'), 'garbage')).toThrow(expect.objectContaining({ code: 'BAD_ENVELOPE' }));
  });

  it('derives independent keys per purpose', () => {
    expect(deriveKey(SECRET, 'auth').equals(deriveKey(SECRET, 'token'))).toBe(false);
    const env = seal(deriveKey(SECRET, 'auth'), 'x', 'k');
    expect(() => open(deriveKey(SECRET, 'token'), env, 'k')).toThrow();
    expect(() => deriveKey('short', 'auth')).toThrow(expect.objectContaining({ code: 'BAD_SECRET' }));
  });

  it('encrypts at rest with the data key and refuses a different data key', () => {
    const a = createDataVault('a'.repeat(40));
    const b = createDataVault('b'.repeat(40));
    const stored = a.seal('EAAtoken', 'instagram:1');
    expect(a.open(stored, 'instagram:1')).toBe('EAAtoken');
    expect(() => b.open(stored, 'instagram:1')).toThrow();
    expect(() => createDataVault('short')).toThrow(expect.objectContaining({ code: 'BAD_DATA_KEY' }));
  });

  it('opens a rotation envelope sealed with the current secret only', () => {
    const next = generateSecret();
    const env = seal(deriveKey(SECRET, 'rotate'), next, 'rotate');
    expect(openRotation(SECRET, env)).toBe(next);
    expect(() => openRotation(next, env)).toThrow();
  });

  it('encodes and decodes pairing strings', () => {
    const p = encodePairing('https://worker.example.com', SECRET);
    expect(p.startsWith('mdw1:')).toBe(true);
    expect(decodePairing(p)).toEqual({ url: 'https://worker.example.com', secret: SECRET });
    expect(() => decodePairing('nope')).toThrow(expect.objectContaining({ code: 'BAD_PAIRING' }));
  });

  it('signs media URLs per sha and expiry', () => {
    const k = deriveKey(SECRET, 'media');
    expect(mediaSignature(k, 'a'.repeat(64), 1)).not.toBe(mediaSignature(k, 'a'.repeat(64), 2));
  });
});
