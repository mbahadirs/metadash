import { translate } from '../locales/catalog.js';

export const RETRYABLE_CODES = new Set([4, 17, 32, 613]);

export class MetaError extends Error {
  constructor({ code, subcode, message, type, endpoint, status, source, fbtraceId, userTitle, userMessage }) {
    super(message);
    this.name = 'MetaError';
    this.code = code ?? null;
    this.subcode = subcode ?? null;
    this.type = type ?? null;
    this.endpoint = endpoint ?? null;
    this.status = status ?? null;
    this.source = source ?? null; // client name that raised it: 'meta' | 'threads'
    this.fbtraceId = fbtraceId ?? null; // Graph `fbtrace_id` (quote it to Meta support; stored on failed publish targets)
    this.userTitle = userTitle ?? null; // Graph `error_user_title` / `error_user_msg` (publishing errors often carry them)
    this.userMessage = userMessage ?? null;
  }

  get isRetryable() {
    return RETRYABLE_CODES.has(this.code);
  }
  get isTokenError() {
    return this.code === 190 || this.code === 102;
  }
  get isPermissionError() {
    return this.code === 10 || this.code === 200 || (this.code >= 200 && this.code <= 299);
  }
  get isInvalidParam() {
    return this.code === 100;
  }
}

export class NetworkError extends Error {
  constructor(message, endpoint) {
    super(message);
    this.name = 'NetworkError';
    this.endpoint = endpoint;
    this.code = 'NETWORK';
  }
}

const PERMISSION_HINTS = {
  insights: 'instagram_manage_insights',
  media: 'instagram_basic',
  adaccounts: 'ads_read',
  accounts: 'pages_show_list',
};

/** Translates any error into the user-facing envelope { code, message, hint }. Strings: locales/<lang>/errors.json. */
export function toUserError(err, lang = 'en') {
  const m = (key, vars) => translate(key, vars, lang);
  if (err instanceof NetworkError || err?.code === 'NETWORK' || err?.name === 'FetchError' || err?.cause?.code === 'ENOTFOUND') {
    return { code: 'NETWORK', message: m('err_network'), hint: m('err_network_hint') };
  }
  if (err instanceof MetaError) {
    if (err.isTokenError && err.source === 'threads') return { code: err.code, message: m('err_threads_token'), hint: m('err_threads_token_hint') };
    if (err.isTokenError) return { code: err.code, message: m('err_meta_token'), hint: m('err_meta_token_hint') };
    if (err.isRetryable) return { code: err.code, message: m('err_rate_limit'), hint: m('err_rate_limit_hint') };
    if (err.isPermissionError) {
      return { code: err.code, message: m('err_permission', { perm: guessPermission(err.endpoint) }), hint: m('err_permission_hint') };
    }
    if (err.isInvalidParam) return { code: err.code, message: m('err_invalid_param', { detail: err.message }), hint: m('err_invalid_param_hint') };
    return { code: err.code, message: err.message, hint: m('err_generic_hint') };
  }
  return {
    code: err?.code ?? 'UNKNOWN',
    message: err?.message ?? m('err_unexpected'),
    hint: null,
  };
}

function guessPermission(endpoint = '') {
  for (const [needle, perm] of Object.entries(PERMISSION_HINTS)) {
    if (endpoint.includes(needle)) return perm;
  }
  return 'instagram_manage_insights';
}
