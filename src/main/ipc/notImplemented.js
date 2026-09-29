import { msg } from '../i18n.js';

/** Localized error for IPC channels whose implementation has not landed yet ({ code: 'NOT_IMPLEMENTED' }). */
export function notImplemented() {
  return Object.assign(new Error(msg('not_implemented')), { code: 'NOT_IMPLEMENTED' });
}
