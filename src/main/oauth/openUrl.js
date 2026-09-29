/**
 * How an OAuth authorize URL reaches the user. The GUI opens the system browser (Electron shell.openExternal,
 * loaded lazily so this module stays importable under ELECTRON_RUN_AS_NODE); the CLI registers a printer with
 * setAuthUrlOpener(url => process.stdout.write(url)). Only https URLs (and http loopback) are ever opened.
 */
let opener = null;

export function setAuthUrlOpener(fn) {
  opener = typeof fn === 'function' ? fn : null;
}

export function isOpenableAuthUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'));
  } catch {
    return false;
  }
}

export async function openAuthUrl(url) {
  if (!isOpenableAuthUrl(url)) throw Object.assign(new Error('Refusing to open a non-https URL'), { code: 'BAD_URL' });
  if (opener) return opener(url);
  const mod = await import('electron');
  const shell = mod.shell ?? mod.default?.shell;
  if (!shell?.openExternal) throw Object.assign(new Error('No browser opener available'), { code: 'NO_OPENER' });
  return shell.openExternal(url);
}
