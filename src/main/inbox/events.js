import { progressBus } from '../sync/progress.js';

/**
 * Emits `inbox:updated` { commentIds?, accountIds?, reason } (forwarded to the renderer by ipc/index.js) and the v1.5
 * `studio:changed` { kind: 'inbox' } so the Studio inbox tab refreshes too. Never throws.
 */
export function emitInboxUpdated({ commentIds, accountIds, reason }) {
  const payload = { reason, ...(commentIds?.length ? { commentIds } : {}), ...(accountIds?.length ? { accountIds } : {}) };
  try {
    progressBus.emit('inbox:updated', payload);
    progressBus.emit('studio:changed', { kind: 'inbox', accountIds, ids: commentIds });
  } catch { /* no listeners */ }
}
