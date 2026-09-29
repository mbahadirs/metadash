/** src/main/oauth: PKCE, state, loopback receiver (real 127.0.0.1 server) and the URL opener guard. */
import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { createPkce, codeChallenge, randomState, safeEqual, buildAuthorizeUrl } from '../src/main/oauth/pkce.js';
import { startLoopback, OAuthError } from '../src/main/oauth/loopback.js';
import { openAuthUrl, setAuthUrlOpener, isOpenableAuthUrl } from '../src/main/oauth/openUrl.js';

describe('pkce', () => {
  it('creates an RFC 7636 verifier and S256 challenge', () => {
    const { verifier, challenge, method } = createPkce();
    expect(method).toBe('S256');
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
    // RFC 7636 appendix B test vector
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(createPkce().verifier).not.toBe(verifier);
  });

  it('state, constant-time compare and authorize URLs', () => {
    expect(randomState()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(null, 'x')).toBe(false);
    const url = new URL(buildAuthorizeUrl('https://accounts.google.com/o/oauth2/v2/auth', { client_id: 'c', scope: 'a b', skip: null }));
    expect(url.searchParams.get('scope')).toBe('a b');
    expect(url.searchParams.has('skip')).toBe(false);
  });
});

describe('loopback receiver', () => {
  it('returns the code for the matching state and serves a success page', async () => {
    const lb = await startLoopback({ timeoutMs: 5000, lang: 'en' });
    expect(lb.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    const wait = lb.waitForCode('S1');
    const miss = await fetch(lb.redirectUri.replace('/oauth/callback', '/favicon.ico'));
    expect(miss.status).toBe(404);
    const res = await fetch(`${lb.redirectUri}?code=AUTH&state=S1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/close this tab/);
    await expect(wait).resolves.toEqual({ code: 'AUTH', state: 'S1' });
  });

  it('rejects a state mismatch with 400 and closes', async () => {
    const lb = await startLoopback({ timeoutMs: 5000 });
    const wait = lb.waitForCode('GOOD');
    const res = await fetch(`${lb.redirectUri}?code=AUTH&state=EVIL`);
    expect(res.status).toBe(400);
    await expect(wait).rejects.toMatchObject({ name: 'OAuthError', code: 'state_mismatch' });
    await expect(fetch(`${lb.redirectUri}?code=AUTH&state=GOOD`)).rejects.toThrow();
  });

  it('maps access_denied, times out and can be cancelled', async () => {
    const a = await startLoopback({ timeoutMs: 5000 });
    const wa = a.waitForCode('S');
    await fetch(`${a.redirectUri}?error=access_denied&state=S`);
    await expect(wa).rejects.toMatchObject({ code: 'access_denied' });
    const b = await startLoopback({ timeoutMs: 30 });
    await expect(b.waitForCode('S')).rejects.toMatchObject({ code: 'timeout' });
    const c = await startLoopback({ timeoutMs: 5000 });
    const wc = c.waitForCode('S');
    c.cancel();
    await expect(wc).rejects.toBeInstanceOf(OAuthError);
  });
});

describe('openAuthUrl', () => {
  afterEach(() => setAuthUrlOpener(null));
  it('only opens https or loopback URLs, through the registered opener', async () => {
    const opened = [];
    setAuthUrlOpener((u) => opened.push(u));
    await openAuthUrl('https://accounts.google.com/x');
    await expect(openAuthUrl('file:///etc/passwd')).rejects.toMatchObject({ code: 'BAD_URL' });
    await expect(openAuthUrl('http://evil.example/')).rejects.toMatchObject({ code: 'BAD_URL' });
    expect(isOpenableAuthUrl('http://127.0.0.1:5000/cb')).toBe(true);
    expect(opened).toEqual(['https://accounts.google.com/x']);
  });
});
