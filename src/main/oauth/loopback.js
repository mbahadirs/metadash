import http from 'node:http';
import { safeEqual } from './pkce.js';
import { msg } from '../i18n.js';

/**
 * Loopback redirect receiver for desktop OAuth (RFC 8252 §7.3): listens on 127.0.0.1 with an ephemeral port, accepts
 * exactly one request on `path`, checks `state` in constant time and answers with a small localized page.
 *
 *   const lb = await startLoopback({ path: '/oauth/callback', timeoutMs: 300_000 });
 *   open(authorizeUrl(lb.redirectUri, state));
 *   const { code } = await lb.waitForCode(state);   // rejects OAuthError: state_mismatch | access_denied | timeout | cancelled
 *
 * The server closes after the first callback request, on timeout, or on cancel(). Other paths get 404 and keep waiting.
 */
export class OAuthError extends Error {
  constructor(code, message, extra = {}) {
    super(message ?? code);
    this.name = 'OAuthError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(ok, lang) {
  const title = msg(ok ? 'oauth_done_title' : 'oauth_failed_title', null, lang);
  const body = msg(ok ? 'oauth_done_body' : 'oauth_failed_body', null, lang);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="viewport" content="width=device-width"></head>`
    + `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#222"><h1 style="font-size:20px">${esc(title)}</h1><p>${esc(body)}</p></body></html>`;
}

/**
 * @param {{ path?: string, timeoutMs?: number, host?: string, lang?: string }} [opts]
 * @returns {Promise<{ redirectUri: string, port: number, waitForCode: (state: string) => Promise<{code: string, state: string}>, cancel: () => void }>}
 */
export async function startLoopback({ path = '/oauth/callback', timeoutMs = 300_000, host = '127.0.0.1', lang } = {}) {
  let settle = null;
  const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  result.catch(() => {}); // observed through waitForCode
  let expected = null;
  let done = false;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (req.method !== 'GET' || url.pathname !== path) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    const state = url.searchParams.get('state') ?? '';
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    let outcome;
    if (!expected || !safeEqual(state, expected)) outcome = new OAuthError('state_mismatch', 'OAuth state mismatch');
    else if (error) outcome = new OAuthError(error === 'access_denied' ? 'access_denied' : 'oauth_error', url.searchParams.get('error_description') ?? error, { vendorError: error });
    else if (!code) outcome = new OAuthError('no_code', 'OAuth callback without code');
    else outcome = { code, state };
    const ok = !(outcome instanceof OAuthError);
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
    res.end(page(ok, lang));
    finish(outcome);
  });

  function finish(outcome) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
    if (outcome instanceof Error) settle.reject(outcome);
    else settle.resolve(outcome);
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const { port } = server.address();
  const timer = setTimeout(() => finish(new OAuthError('timeout', 'OAuth sign-in timed out')), timeoutMs);
  timer.unref?.();

  return {
    redirectUri: `http://${host}:${port}${path}`,
    port,
    waitForCode(state) {
      expected = String(state ?? '');
      return result;
    },
    cancel() { finish(new OAuthError('cancelled', 'OAuth sign-in cancelled')); },
  };
}
