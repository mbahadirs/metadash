import { getConfig } from '../config/store.js';
import { runSync, syncStatus } from './orchestrator.js';
import { lastSuccessfulRun } from '../db/queries/sync.js';

let timer = null;

/** While the app is open: stories every N hours, full sync once a day if enabled. */
export function startScheduler() {
  stopScheduler();
  timer = setInterval(tick, 15 * 60_000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick() {
  if (syncStatus().running) return;
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
