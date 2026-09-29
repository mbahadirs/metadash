import { app, shell } from 'electron';
import { getConfig } from './config/store.js';
import { progressBus } from './sync/progress.js';
import { RELEASES_API, updateMode, statusFromRelease, reduceUpdateStatus, safeReleaseUrl } from './updateCheck.js';

/**
 * Update checks for packaged builds only.
 * Windows (NSIS) and Linux AppImage use electron-updater (download on request, install on quit/restart);
 * unsigned macOS builds and .deb installs only query the GitHub releases API and link to the release page.
 */
const FIRST_CHECK_MS = 10_000;
const INTERVAL_MS = 6 * 3_600_000;
const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_STATES = new Set(['downloading', 'downloaded']);

let status = { state: 'idle' };
let timers = [];
let autoUpdater = null;
let inFlight = null;

const mode = () => updateMode({ platform: process.platform, env: process.env, isPackaged: app.isPackaged });

function setStatus(next) {
  status = next;
  progressBus.emit('update:status', status);
}

export const getUpdateStatus = () => status;

async function loadAutoUpdater() {
  if (autoUpdater) return autoUpdater;
  const mod = await import('electron-updater');
  const au = mod.default?.autoUpdater ?? mod.autoUpdater;
  au.autoDownload = false;
  au.autoInstallOnAppQuit = true;
  for (const evt of ['checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error']) {
    au.on(evt, (payload) => setStatus(reduceUpdateStatus(status, evt, payload)));
  }
  autoUpdater = au;
  return au;
}

async function fetchLatestRelease() {
  const res = await fetch(RELEASES_API, {
    headers: { 'User-Agent': `MetaDash/${app.getVersion()}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  return statusFromRelease(await res.json(), app.getVersion());
}

/** Runs one check; never throws — failures become { state: 'error' }. Dev builds report { dev: true }. */
export function checkForUpdates() {
  const m = mode();
  if (m === 'off') return Promise.resolve({ state: 'not-available', dev: true });
  if (DOWNLOAD_STATES.has(status.state)) return Promise.resolve(status);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    setStatus({ state: 'checking' });
    try {
      if (m === 'auto') await (await loadAutoUpdater()).checkForUpdates();
      else setStatus(await fetchLatestRelease());
    } catch (e) {
      console.warn('[updater] check failed:', e?.message ?? e);
      setStatus({ state: 'error', error: e?.message ?? String(e) });
    }
    return status;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/** Starts downloading (auto channel) or opens the release page (manual channel). */
export async function downloadUpdate() {
  if (mode() !== 'auto' || status.manual) return openReleasePage();
  if (status.state !== 'available') return status;
  setStatus({ ...status, state: 'downloading', percent: 0 });
  try {
    await (await loadAutoUpdater()).downloadUpdate();
  } catch (e) {
    console.warn('[updater] download failed:', e?.message ?? e);
    setStatus({ state: 'error', error: e?.message ?? String(e) });
  }
  return status;
}

/** Quits and installs a downloaded update. */
export function installUpdate() {
  if (!autoUpdater || status.state !== 'downloaded') return false;
  setImmediate(() => autoUpdater.quitAndInstall());
  return true;
}

export async function openReleasePage() {
  const url = safeReleaseUrl(status.url);
  await shell.openExternal(url);
  return url;
}

/** Background checks (~10 s after start, then every 6 h) while the `autoUpdateCheck` setting is on. */
export function startUpdater() {
  stopUpdater();
  if (mode() === 'off') return;
  const tick = () => { if (getConfig('autoUpdateCheck') !== false) void checkForUpdates(); };
  timers = [setTimeout(tick, FIRST_CHECK_MS), setInterval(tick, INTERVAL_MS)];
}

export function stopUpdater() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}
