import { getUpdateStatus, checkForUpdates, downloadUpdate, installUpdate, openReleasePage } from '../updater.js';

/** Update channel: status / manual check / download / restart-to-install / open release page. */
export function registerUpdateHandlers(handle) {
  handle('update:status', () => getUpdateStatus());
  handle('update:check', () => checkForUpdates());
  handle('update:download', () => downloadUpdate());
  handle('update:install', () => installUpdate());
  handle('update:openRelease', () => openReleasePage());
}
