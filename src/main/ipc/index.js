import { ipcMain, BrowserWindow } from 'electron';
import { toUserError } from '../meta/errors.js';
import { getConfig } from '../config/store.js';
import { progressBus } from '../sync/progress.js';
import { registerSetupHandlers } from './setup.handlers.js';
import { registerAccountHandlers } from './accounts.handlers.js';
import { registerSyncHandlers } from './sync.handlers.js';
import { registerAnalyticsHandlers } from './analytics.handlers.js';
import { registerAdsHandlers } from './ads.handlers.js';
import { registerExportHandlers } from './export.handlers.js';
import { registerSystemHandlers } from './system.handlers.js';
import { registerCompetitorHandlers } from './competitors.handlers.js';
import { registerUpdateHandlers } from './update.handlers.js';
import { registerAiHandlers } from './ai.handlers.js';
import { registerPlatformHandlers } from './platforms.handlers.js';
import { registerFacebookSetupHandlers } from './setup.facebook.handlers.js';
import { registerThreadsSetupHandlers } from './setup.threads.handlers.js';
import { registerPlannerHandlers } from './planner.handlers.js';
import { registerPublishingHandlers } from './publishing.handlers.js';
import { registerAppHandlers } from './app.handlers.js';

/** Wraps a handler so the renderer always receives { ok, data } | { ok: false, error }.*/
export function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      // Zero-arg calls (e.g. db:backup) still get a payload slot so `event` always lands in the same position.
      const padded = args.length ? args : [undefined];
      const data = await fn(...padded, event);
      return { ok: true, data: data ?? null };
    } catch (err) {
      const lang = safeLang();
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: toUserError(err, lang) };
    }
  });
}

function safeLang() {
  try {
    return getConfig('lang') ?? 'en';
  } catch {
    return 'en';
  }
}

/** progressBus events forwarded to every window (keep in sync with preload.cjs `on`). */
export const RENDERER_EVENTS = [
  'sync:progress', 'sync:done', 'token:warning', 'update:status', 'app:navigate',
  'planner:changed', 'publish:progress', 'publish:missed', // v1.4: { postIds, reason, … } | { targetId, postId, state, pct? } | { count }
];

export function registerIpc() {
  registerSetupHandlers(handle);
  registerAccountHandlers(handle);
  registerSyncHandlers(handle);
  registerAnalyticsHandlers(handle);
  registerAdsHandlers(handle);
  registerExportHandlers(handle);
  registerSystemHandlers(handle);
  registerCompetitorHandlers(handle);
  registerUpdateHandlers(handle);
  registerAiHandlers(handle);
  registerPlatformHandlers(handle);
  registerFacebookSetupHandlers(handle);
  registerThreadsSetupHandlers(handle);
  registerPlannerHandlers(handle);
  registerPublishingHandlers(handle);
  registerAppHandlers(handle);

  for (const evt of RENDERER_EVENTS) {
    progressBus.on(evt, (payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(evt, payload);
      }
    });
  }
}
