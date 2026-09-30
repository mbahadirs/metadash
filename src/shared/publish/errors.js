/**
 * Publishing errors shared by the desktop and the self-hosted worker (pure: no i18n import).
 *
 * PublishError carries a stable message key + vars. Its `message` comes from a formatter: the desktop installs its
 * i18n `msg` (src/main/publishing/errors.js), the worker keeps the default (the key), and the desktop localizes worker
 * errors by key when it pulls them.
 *
 * classify() maps any failure to a kind:
 *   auth (190, 102, 463, 467) · permission (3, 10, 200-299) · rate (4, 17, 32, 613, 80001-80014) · quota (9, 2207042)
 *   media (IG 2207xxx) · expired (2207008/2207020) · transient (1, 2, 5xx, network) · invalid (other) · config (local)
 * Meta errors are recognized by name ('MetaError'), so both the desktop client's and graph.js errors work.
 */
let formatMessage = (key) => key;

/** Installs the message formatter (desktop: i18n msg). @param {(key: string, vars: object) => string} fn */
export function setPublishMessageFormatter(fn) {
  formatMessage = typeof fn === 'function' ? fn : (key) => key;
}

export class PublishError extends Error {
  constructor(key, vars = {}, { kind = 'config', code } = {}) {
    super(formatMessage(key, vars));
    this.name = 'PublishError';
    this.key = key;
    this.vars = vars;
    this.kind = kind;
    this.code = code ?? key;
  }
}

export const publishError = (key, vars, opts) => new PublishError(key, vars, opts);

const AUTH_CODES = new Set([190, 102, 463, 467]);
const PERMISSION_CODES = new Set([3, 10]);
const RATE_CODES = new Set([4, 17, 32, 613]);
const TRANSIENT_CODES = new Set([1, 2]);
const QUOTA_SUBCODES = new Set([2207042]); // VERIFY
const EXPIRED_SUBCODES = new Set([2207008, 2207020]); // VERIFY
const TRANSIENT_SUBCODES = new Set([2207001, 2207003, 2207032, 2207053]); // VERIFY

export const RETRYABLE_KINDS = Object.freeze(['rate', 'quota', 'transient']);

export function metaKind(e) {
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

const isPublishError = (e) => e instanceof PublishError || e?.name === 'PublishError';
const isMeta = (e) => e?.name === 'MetaError';
const isNetwork = (e) => e?.name === 'NetworkError' || e?.code === 'NETWORK' || e?.name === 'TimeoutError' || e?.name === 'AbortError' || !!e?.cause?.code;

/**
 * @param {unknown} err
 * @returns {{ kind: string, code: string, key: string|null, message: string, fbtraceId: string|null, retryable: boolean, network: boolean }}
 *   network = the request may or may not have reached Meta (timeouts, resets): the outcome is unknown.
 */
export function classify(err) {
  if (isPublishError(err)) {
    return { kind: err.kind, code: err.code, key: err.key ?? null, message: err.message, fbtraceId: null, retryable: RETRYABLE_KINDS.includes(err.kind), network: false };
  }
  if (isMeta(err)) {
    const kind = metaKind(err);
    const code = err.subcode ? `${err.code}/${err.subcode}` : String(err.code ?? 'meta');
    return { kind, code, key: null, message: err.userMessage || err.message, fbtraceId: err.fbtraceId ?? null, retryable: RETRYABLE_KINDS.includes(kind), network: false };
  }
  if (isNetwork(err)) {
    return { kind: 'transient', code: 'network', key: null, message: err?.message ?? 'network error', fbtraceId: null, retryable: true, network: true };
  }
  return { kind: 'invalid', code: 'internal', key: null, message: err?.message ?? String(err), fbtraceId: null, retryable: false, network: false };
}
