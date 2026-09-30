import { app } from 'electron';
import { msg } from '../i18n.js';
import { getSetting, setSetting } from '../db/queries/settings.js';
import { shimEnv, cliStatus, installShim, uninstallShim, ShimError } from '../cli/shim.js';

/**
 * Command-line tool channels (Settings → Command-line tool): status, install / uninstall the `metadash` shim.
 * Results: CliStatus { installed, shimPath, onPath, command, platform } (renderer lib/types.ts).
 */
export const CLI_CHANNELS = Object.freeze([
  'cli:status',
  'cli:installShim',
  'cli:uninstallShim',
]);

const DIRS_KEY = 'cli.shimDirs';

function env() {
  const extraDirs = getSetting(DIRS_KEY, []) ?? [];
  return shimEnv({ execPath: process.execPath, appPath: app.getAppPath(), isPackaged: app.isPackaged, extraDirs: Array.isArray(extraDirs) ? extraDirs : [] });
}

/** ShimError → localized Error (the IPC envelope carries message + code). */
function localized(e) {
  if (e instanceof ShimError) return Object.assign(new Error(msg(e.code, e.vars)), { code: e.code });
  return e;
}

export function registerCliHandlers(handle) {
  handle('cli:status', () => cliStatus(env()));
  handle('cli:installShim', (payload) => {
    const dir = typeof payload?.dir === 'string' && payload.dir.trim() ? payload.dir.trim() : undefined;
    try {
      const status = installShim(env(), { dir });
      if (dir) setSetting(DIRS_KEY, [...new Set([...(getSetting(DIRS_KEY, []) ?? []), dir])].slice(-5));
      return status;
    } catch (e) {
      throw localized(e);
    }
  });
  handle('cli:uninstallShim', () => {
    try { return uninstallShim(env()); } catch (e) { throw localized(e); }
  });
}
