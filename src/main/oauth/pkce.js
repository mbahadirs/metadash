import crypto from 'node:crypto';

/**
 * PKCE (RFC 7636) and OAuth state helpers for desktop OAuth flows (Google/YouTube, TikTok). Pure: no Electron.
 */
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** S256 code challenge of a verifier. */
export function codeChallenge(verifier) {
  return b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
}

/** New verifier (32 random bytes → 43 base64url chars, within RFC 7636's 43–128) and its S256 challenge. */
export function createPkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: codeChallenge(verifier), method: 'S256' };
}

/** Unguessable OAuth `state` (CSRF protection); 16 random bytes, base64url. */
export function randomState() {
  return b64url(crypto.randomBytes(16));
}

/** Constant-time string comparison (false for different lengths or non-strings). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Builds an authorize URL from a base and params (undefined/null params are skipped). */
export function buildAuthorizeUrl(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  return url.toString();
}
