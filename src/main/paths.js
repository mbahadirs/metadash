import os from 'node:os';
import path from 'node:path';

const APP_NAME = 'MetaDash';

/** Mirrors Electron's app.getPath('userData') so scripts run under ELECTRON_RUN_AS_NODE agree with the app. */
export function userDataDir() {
  if (process.env.METADASH_USER_DATA) return process.env.METADASH_USER_DATA;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', APP_NAME);
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), APP_NAME);
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), APP_NAME);
}

export function dbPath() {
  return path.join(userDataDir(), 'data.db');
}
