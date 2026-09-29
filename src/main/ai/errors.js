import { msg } from '../i18n.js';

/** User-facing AI error: `key` is an i18n key in src/main/i18n.js, `message` is already localized. */
export class AiError extends Error {
  constructor(key, { vars, lang, category, cause } = {}) {
    super(msg(key, vars, lang), cause ? { cause } : undefined);
    this.name = 'AiError';
    this.key = key;
    this.code = key.toUpperCase();
    if (category) this.category = category;
  }
}

const DETAIL_MAX = 200;

/** Maps an HTTP error status (+ provider error text, only shown for 4xx request errors) to an AiError. */
export function httpError(status, detail = '', { model } = {}) {
  if (status === 401 || status === 403) return new AiError('ai_auth');
  if (status === 429) return new AiError('ai_rate_limit');
  if (status >= 500) return new AiError('ai_server');
  if (status === 404 && model && !detail) return new AiError('ai_model_not_found', { vars: { model } });
  return new AiError('ai_bad_request', { vars: { status, detail: String(detail ?? '').slice(0, DETAIL_MAX) } });
}

/** Maps a thrown fetch error (network failure, timeout, abort) to an AiError. */
export function fetchFailure(err) {
  if (err instanceof AiError) return err;
  if (err?.name === 'TimeoutError') return new AiError('ai_timeout', { cause: err });
  if (err?.name === 'AbortError') return new AiError('ai_cancelled', { cause: err });
  return new AiError('ai_network', { cause: err });
}
