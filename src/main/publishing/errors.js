import { MetaError, NetworkError } from '../meta/errors.js';
import { msg } from '../i18n.js';

/**
 * Publishing error classification (plan §6.7). Every failure a publisher or host throws is mapped to one class:
 *   auth        token invalid/expired (190, 102, 463, 467)          → pause that auth's targets, token:warning, one notification
 *   permission  missing scope / role (3, 10, 200-299)               → failed, no retry ("missing scope" hint)
 *   rate        app/BUC/page rate limits (4, 17, 32, 613, 80001+)    → retry after RATE_DELAY_MS, attempts not counted
 *   quota       IG/Threads 24 h publishing limit (9, 2207042)       → retry after QUOTA_DELAY_MS, warning notification
 *   media       Meta rejected the media (IG 2207xxx family)         → failed, no retry
 *   expired     container expired (IG 2207008/2207020, status EXPIRED) → recreate once
 *   transient   1, 2, HTTP 5xx, network                             → backoff 1/5/15/60/180 min, max 5 attempts
 *   invalid     other Graph rejections (100 …)                      → failed, no retry
 *   config      local problem (no media host, file missing, …)      → failed, no retry
 * Subcode lists below are VERIFY: Meta documents them only partially (IG error-codes page, checked 2026-09-29).
 */
export const BACKOFF_MIN = Object.freeze([1, 5, 15, 60, 180]);
export const MAX_ATTEMPTS = BACKOFF_MIN.length;
export const RATE_DELAY_MS = 15 * 60_000;
export const QUOTA_DELAY_MS = 30 * 60_000;

const AUTH_CODES = new Set([190, 102, 463, 467]);
const PERMISSION_CODES = new Set([3, 10]);
const RATE_CODES = new Set([4, 17, 32, 613]);
const TRANSIENT_CODES = new Set([1, 2]);
const QUOTA_SUBCODES = new Set([2207042]); // "maximum number of posts reached" (VERIFY)
const EXPIRED_SUBCODES = new Set([2207008, 2207020]); // container / media expired (VERIFY)
const TRANSIENT_SUBCODES = new Set([2207001, 2207003, 2207032, 2207053]); // server error / download timeout / retry (VERIFY)

/** Local publishing error with an i18n message and a stable code (stored in planner_targets.last_error_code). */
export class PublishError extends Error {
  constructor(key, vars = {}, { kind = 'config', code } = {}) {
    super(msg(key, vars));
    this.name = 'PublishError';
    this.key = key;
    this.vars = vars;
    this.kind = kind;
    this.code = code ?? key;
  }
}

export const publishError = (key, vars, opts) => new PublishError(key, vars, opts);

/** Backoff delay for the n-th consecutive transient failure (1-based). */
export function backoffMs(attempt) {
  const i = Math.min(Math.max(1, attempt), BACKOFF_MIN.length) - 1;
  return BACKOFF_MIN[i] * 60_000;
}

function metaKind(e) {
  const code = Number(e.code);
  const sub = Number(e.subcode);
  if (AUTH_CODES.has(code) || AUTH_CODES.has(sub)) return 'auth';
  if (code === 9 || QUOTA_SUBCODES.has(sub)) return 'quota';
  if (EXPIRED_SUBCODES.has(sub)) return 'expired';
  if (TRANSIENT_SUBCODES.has(sub)) return 'transient';
  if (sub >= 2207000 && sub < 2208000) return 'media';
  if (RATE_CODES.has(code) || (code >= 80001 && code <= 80014)) return 'rate';
  if (PERMISSION_CODES.has(code) || (code >= 200 && code <= 299)) return 'permission';
  if (TRANSIENT_CODES.has(code) || (Number(e.status) >= 500 && code === Number(e.status))) return 'transient';
  if (Number(e.status) >= 500) return 'transient';
  return 'invalid';
}

const RETRYABLE = new Set(['rate', 'quota', 'transient']);

/**
 * @param {unknown} err
 * @returns {{ kind: string, code: string, message: string, fbtraceId: string|null, retryable: boolean, network: boolean }}
 *   network = the request may or may not have reached Meta (timeouts, connection resets): the outcome is unknown.
 */
export function classify(err) {
  if (err instanceof PublishError) {
    return { kind: err.kind, code: err.code, message: err.message, fbtraceId: null, retryable: RETRYABLE.has(err.kind), network: false };
  }
  if (err instanceof MetaError) {
    const kind = metaKind(err);
    const code = err.subcode ? `${err.code}/${err.subcode}` : String(err.code ?? 'meta');
    const detail = err.userMessage || err.message;
    return { kind, code, message: detail, fbtraceId: err.fbtraceId ?? null, retryable: RETRYABLE.has(kind), network: false };
  }
  if (err instanceof NetworkError || err?.code === 'NETWORK' || err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.cause?.code) {
    return { kind: 'transient', code: 'network', message: err?.message ?? 'network error', fbtraceId: null, retryable: true, network: true };
  }
  return { kind: 'invalid', code: 'internal', message: err?.message ?? String(err), fbtraceId: null, retryable: false, network: false };
}

/** User-facing text for a classified failure (stored in planner_targets.last_error). */
export function describeFailure(c, { scopes } = {}) {
  if (c.kind === 'auth') return msg('pub_err_auth', { detail: c.message });
  if (c.kind === 'permission') return msg('pub_err_permission', { detail: c.message, scopes: scopes ?? '' });
  if (c.kind === 'media') return msg('pub_err_media', { detail: c.message });
  return c.message;
}
