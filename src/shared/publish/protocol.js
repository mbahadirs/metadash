import crypto from 'node:crypto';

/**
 * Desktop ↔ self-hosted worker wire protocol v1 (pure: node:crypto only). Used by src/main/worker/client.js and by
 * worker/src/auth.js + crypto.js, so signing and sealing have exactly one implementation.
 *
 *   K_auth  = HKDF-SHA256(secret, info 'mdw-auth-v1')    request signatures
 *   K_tok   = HKDF-SHA256(secret, info 'mdw-token-v1')   token envelopes (AES-256-GCM, AAD = token key)
 *   K_media = HKDF-SHA256(secret, info 'mdw-media-v1')   signed public media URLs
 *   X-MD-Sig = base64url(HMAC-SHA256(K_auth, METHOD \n PATH?QUERY \n TS \n NONCE \n hex(SHA256(body))))
 * Envelope: 'v1.' + base64url(iv(12) | tag(16) | ciphertext).
 */
export const PROTOCOL_VERSION = 1;
export const HEADER_PROTOCOL = 'x-md-protocol';
export const HEADER_TS = 'x-md-ts';
export const HEADER_NONCE = 'x-md-nonce';
export const HEADER_SIG = 'x-md-sig';
export const MAX_SKEW_MS = 300_000;
export const SECRET_BYTES = 32;
export const PAIRING_PREFIX = 'mdw1:';

const INFO = Object.freeze({ auth: 'mdw-auth-v1', token: 'mdw-token-v1', media: 'mdw-media-v1', data: 'mdw-data-v1', rotate: 'mdw-rotate-v1' });
const SALT = Buffer.from('metadash-worker');

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64url = (s) => Buffer.from(String(s), 'base64url');
export const sha256Hex = (data) => crypto.createHash('sha256').update(data ?? '').digest('hex');

/** 32-byte key from a secret (string or Buffer) and a purpose ('auth' | 'token' | 'media' | 'data' | 'rotate'). */
export function deriveKey(secret, purpose) {
  if (!secret || (typeof secret === 'string' && secret.length < 16)) throw Object.assign(new Error('secret too short'), { code: 'BAD_SECRET' });
  const info = INFO[purpose];
  if (!info) throw new Error(`unknown key purpose ${purpose}`);
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), SALT, Buffer.from(info), 32));
}

export const generateSecret = () => b64url(crypto.randomBytes(SECRET_BYTES));
export const generateNonce = () => b64url(crypto.randomBytes(16));

export function canonicalRequest({ method, path, ts, nonce, bodyHash }) {
  return [String(method).toUpperCase(), path, String(ts), nonce, bodyHash].join('\n');
}

export function signRequest(authKey, parts) {
  return b64url(crypto.createHmac('sha256', authKey).update(canonicalRequest(parts)).digest());
}

/** Constant-time comparison of two base64url/hex strings. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Headers for a signed request. `body` is the exact bytes sent (string/Buffer; '' when none); streamed uploads pass `bodyHash`. */
export function signedHeaders(authKey, { method, path, body = '', bodyHash: knownHash, now = Date.now(), nonce = generateNonce() }) {
  const ts = String(Math.floor(now));
  const bodyHash = knownHash ?? sha256Hex(body);
  return {
    'X-MD-Protocol': String(PROTOCOL_VERSION),
    'X-MD-Ts': ts,
    'X-MD-Nonce': nonce,
    'X-MD-Sig': signRequest(authKey, { method, path, ts, nonce, bodyHash }),
  };
}

/** AES-256-GCM seal. `aad` binds the ciphertext to its purpose (e.g. the token key). */
export function seal(key, plaintext, aad = '') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(Buffer.from(String(plaintext), 'utf8')), c.final()]);
  return `v1.${b64url(Buffer.concat([iv, c.getAuthTag(), ct]))}`;
}

/** Opens a seal() envelope; throws { code: 'BAD_ENVELOPE' } on a wrong key, wrong AAD or tampering. */
export function open(key, envelope, aad = '') {
  try {
    if (typeof envelope !== 'string' || !envelope.startsWith('v1.')) throw new Error('format');
    const raw = fromB64url(envelope.slice(3));
    if (raw.length < 29) throw new Error('short');
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    throw Object.assign(new Error('envelope could not be opened'), { code: 'BAD_ENVELOPE' });
  }
}

/** Signed media URL query: sig = HMAC(K_media, sha256 \n exp). */
export function mediaSignature(mediaKey, sha256, exp) {
  return b64url(crypto.createHmac('sha256', mediaKey).update(`${sha256}\n${exp}`).digest());
}

/** Pairing string 'mdw1:' + base64url(url|secret). */
export function encodePairing(url, secret) {
  return PAIRING_PREFIX + b64url(Buffer.from(`${url}|${secret}`, 'utf8'));
}

/** @returns {{ url: string, secret: string }} throws { code: 'BAD_PAIRING' } */
export function decodePairing(pairing) {
  const s = String(pairing ?? '').trim();
  if (!s.startsWith(PAIRING_PREFIX)) throw Object.assign(new Error('bad pairing string'), { code: 'BAD_PAIRING' });
  const text = fromB64url(s.slice(PAIRING_PREFIX.length)).toString('utf8');
  const i = text.lastIndexOf('|');
  if (i <= 0) throw Object.assign(new Error('bad pairing string'), { code: 'BAD_PAIRING' });
  return { url: text.slice(0, i), secret: text.slice(i + 1) };
}

export const isSha256 = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
