import { runSync, cancelSync, syncStatus, shouldSuggestSync } from '../sync/orchestrator.js';
import { msg } from '../i18n.js';
import { listRuns, recentErrors, listDisabledMetrics, enableMetric } from '../db/queries/sync.js';

export function registerSyncHandlers(handle) {
  handle('sync:run', async (params = {}) => {
    try {
      return await runSync(params);
    } catch (e) {
      if (e.message === 'SYNC_RUNNING') throw new Error(msg('sync_running'));
      if (e.message === 'SYNC_LOCKED') throw Object.assign(new Error(msg(e.holder?.kind === 'cli' ? 'sync_locked_cli' : 'sync_locked')), { code: 'SYNC_LOCKED' });
      if (e.message === 'NO_PROFILE') throw new Error(msg('no_profile'));
      throw e;
    }
  });
  handle('sync:cancel', () => cancelSync());
  handle('sync:status', () => syncStatus());
  handle('sync:history', ({ limit = 20 } = {}) => listRuns(limit));
  handle('sync:errors', ({ limit = 50 } = {}) => recentErrors(limit));
  handle('sync:suggest', () => shouldSuggestSync());
  handle('sync:disabledMetrics', () => listDisabledMetrics());
  // Accepts a metric name (Instagram, legacy) or { metric, platform, scope } for Facebook/Threads metric_resolution rows.
  handle('sync:enableMetric', (arg) => {
    const { metric, platform, scope } = typeof arg === 'string' ? { metric: arg } : (arg ?? {});
    if (typeof metric !== 'string' || !metric) throw new Error(msg('invalid_metric'));
    enableMetric(metric, { platform, scope });
    return listDisabledMetrics();
  });
}
