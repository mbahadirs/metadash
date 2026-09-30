import { msg } from '../i18n.js';
import { PublishError, publishError, classify, setPublishMessageFormatter } from '../../shared/publish/errors.js';

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
 * Subcode lists are VERIFY: Meta documents them only partially (IG error-codes page, checked 2026-09-29).
 * v2.0: PublishError and classify() live in src/shared/publish/errors.js (shared with the self-hosted worker); this module
 * installs the i18n formatter so PublishError messages stay localized on the desktop.
 */
setPublishMessageFormatter((key, vars) => msg(key, vars));

export const BACKOFF_MIN = Object.freeze([1, 5, 15, 60, 180]);
export const MAX_ATTEMPTS = BACKOFF_MIN.length;
export const RATE_DELAY_MS = 15 * 60_000;
export const QUOTA_DELAY_MS = 30 * 60_000;

export { PublishError, publishError, classify };

/** Backoff delay for the n-th consecutive transient failure (1-based). */
export function backoffMs(attempt) {
  const i = Math.min(Math.max(1, attempt), BACKOFF_MIN.length) - 1;
  return BACKOFF_MIN[i] * 60_000;
}

/** User-facing text for a classified failure (stored in planner_targets.last_error). */
export function describeFailure(c, { scopes } = {}) {
  if (c.kind === 'auth') return msg('pub_err_auth', { detail: c.message });
  if (c.kind === 'permission') return msg('pub_err_permission', { detail: c.message, scopes: scopes ?? '' });
  if (c.kind === 'media') return msg('pub_err_media', { detail: c.message });
  return c.message;
}
