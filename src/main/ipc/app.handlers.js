import { backgroundState, updateBackground } from '../lifecycle.js';

/**
 * Background-mode channels (v1.4 chunk C). Types: renderer lib/types.ts BackgroundSettings.
 *  app:background:get  () → { trayMode, launchAtLogin, startHidden, keepAwakeForPosts, supported: { loginItem, tray } }
 *  app:background:set  (Partial<{ trayMode, launchAtLogin, startHidden, keepAwakeForPosts }>) → same as get
 *    Applied immediately: the tray is created/destroyed and the login item (macOS/Windows) or XDG autostart file (Linux)
 *    is updated. Unknown keys and non-boolean values are ignored. keepAwakeForPosts is read by the publishing worker.
 * Config keys: app.trayMode, app.launchAtLogin, app.startHidden, app.keepAwakeForPosts.
 */
export const APP_CHANNELS = ['app:background:get', 'app:background:set'];

export function registerAppHandlers(handle) {
  handle('app:background:get', () => backgroundState());
  handle('app:background:set', (patch) => updateBackground(patch));
}
