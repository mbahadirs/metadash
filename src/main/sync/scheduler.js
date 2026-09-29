import { getConfig } from '../config/store.js';
import { runSync, syncStatus } from './orchestrator.js';
import { lastSuccessfulRun } from '../db/queries/sync.js';
import { listProviders } from '../providers/index.js';

import { loadPeriodicTasks } from './periodic.js';

let timer = null;
const periodicTimers = new Map(); // id → interval handle
let generation = 0;

/**
 * While the app is open: stories every N hours, full sync once a day if enabled; plus the v2.0 feature modules'
 * periodic tasks (sync/periodic.js: inbox polling, worker sync, team publish/pull).
 */
export function startScheduler() {
  stopScheduler();
  timer = setInterval(tick, 15 * 60_000);
  const gen = generation;
  loadPeriodicTasks().then((tasks) => { if (gen === generation) for (const t of tasks) registerPeriodic(t); }).catch((e) => console.error('[scheduler] periodic', e));
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  generation += 1;
  for (const h of periodicTimers.values()) clearInterval(h);
  periodicTimers.clear();
}

/**
 * Registers a periodic task { id, intervalMs, run, runOnStart? }; re-registering an id replaces it. Runs never
 * overlap (a run still in flight skips the next tick) and errors are logged, never thrown. Returns an unregister fn.
 */
export function registerPeriodic({ id, intervalMs, run, runOnStart = false }) {
  if (!id || typeof run !== 'function' || !(intervalMs > 0)) throw new Error('registerPeriodic: id, intervalMs and run are required');
  unregisterPeriodic(id);
  let busy = false;
  const fire = async () => {
    if (busy) return;
    busy = true;
    try { await run(); } catch (e) { console.error(`[periodic:${id}]`, e); } finally { busy = false; }
  };
  const h = setInterval(fire, intervalMs);
  h.unref?.();
  periodicTimers.set(id, h);
  if (runOnStart) void fire();
  return () => unregisterPeriodic(id);
}

export function unregisterPeriodic(id) {
  const h = periodicTimers.get(id);
  if (h) clearInterval(h);
  periodicTimers.delete(id);
}

/** Ids of the registered periodic tasks (diagnostics/tests). */
export function periodicIds() {
  return [...periodicTimers.keys()];
}

/** Provider housekeeping (e.g. Threads token refresh). A failing provider never blocks the others or the sync. */
export async function runMaintenance() {
  for (const p of listProviders()) {
    try {
      await p.maintenance?.();
    } catch (e) {
      console.error(`[maintenance:${p.platform}]`, e);
    }
  }
}

async function tick() {
  if (syncStatus().running) return;
  await runMaintenance();
  const hours = Number(getConfig('storyIntervalHours') ?? 4);
  const lastStories = lastSuccessfulRun('stories');
  if (hours > 0 && (!lastStories || Date.now() - lastStories.finished_at > hours * 3_600_000)) {
    try { await runSync({ scope: 'stories' }); } catch { /* ignore */ }
    return;
  }
  if (getConfig('autoSyncDaily')) {
    const last = lastSuccessfulRun('organic');
    if (!last || Date.now() - last.finished_at > 24 * 3_600_000) {
      try { await runSync({ scope: 'full' }); } catch { /* ignore */ }
    }
  }
}
