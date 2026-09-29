import { notImplemented } from './notImplemented.js';

/**
 * Background-mode channels — STUBS (v1.4 chunk A). Chunk C replaces this file; keep `registerAppHandlers(handle)` and
 * `APP_CHANNELS`. Contract (types in renderer lib/types.ts, BackgroundSettings):
 *  app:background:get  () → { trayMode, launchAtLogin, startHidden, keepAwakeForPosts, supported: { loginItem, tray } }
 *  app:background:set  (Partial<{ trayMode, launchAtLogin, startHidden, keepAwakeForPosts }>) → same as get (applied immediately)
 * Config keys: app.trayMode, app.launchAtLogin, app.startHidden, app.keepAwakeForPosts (config/store.js DEFAULTS).
 */
export const APP_CHANNELS = ['app:background:get', 'app:background:set'];

export function registerAppHandlers(handle) {
  for (const channel of APP_CHANNELS) handle(channel, () => { throw notImplemented(); });
}
