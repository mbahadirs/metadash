/**
 * Periodic background tasks of v2.0 feature modules, registered by sync/scheduler.js startScheduler().
 * Each module exports `periodic`: null (nothing to do yet) or { id, intervalMs, run, runOnStart? } where run() is
 * async and must never throw for expected failures (log instead). Modules are loaded lazily so a broken module never
 * blocks the scheduler, and are only started while the app/tray runs (never in the CLI).
 *
 * Owners: inbox/poller.js (D), worker/sync.js (E), team/scheduler.js (F1). Adding a module = one line here (B).
 */
export const PERIODIC_MODULES = Object.freeze([
  () => import('../inbox/poller.js'),
  () => import('../worker/sync.js'),
  () => import('../team/scheduler.js'),
]);

/** Resolves every module's `periodic` task (skipping null and modules that fail to load). */
export async function loadPeriodicTasks(modules = PERIODIC_MODULES) {
  const tasks = [];
  for (const load of modules) {
    try {
      const mod = await load();
      const p = mod?.periodic;
      if (p && typeof p.run === 'function' && Number(p.intervalMs) > 0 && p.id) tasks.push(p);
    } catch (e) {
      console.error('[periodic] module failed to load', e);
    }
  }
  return tasks;
}
