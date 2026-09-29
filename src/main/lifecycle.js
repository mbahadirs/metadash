import { app, BrowserWindow, dialog, Notification, powerMonitor } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig, setConfig } from './config/store.js';
import { getSetting, setSetting } from './db/queries/settings.js';
import { q } from './db/index.js';
import { listTargets } from './db/queries/planner.js';
import { msg } from './i18n.js';
import { showWindow } from './appWindow.js';
import { runNotifications } from './notifications.js';
import { createTray, destroyTray, refreshTray } from './tray.js';
import {
  shouldQuitOnAllClosed, shouldHideDock, loginItemArgs, linuxAutostartDesktop, startHidden, quitNeedsConfirm,
  supportedFeatures, sanitizeBackgroundPatch, SCHEDULED_TARGET_STATES,
} from './lifecycleRules.js';

/**
 * Background mode (v1.4 plan §9): single-instance lock, tray, window-close policy, launch at login, hidden start,
 * quit confirmation and power events → publishing worker wake-up. Decisions live in lifecycleRules.js (pure).
 * The publishing worker (chunk B, publishing/worker.js) is loaded lazily and every export is feature-checked.
 */
const HINT_KEY = 'app.trayHintShown';
const LINUX_AUTOSTART = 'metadash.desktop';

let quitReason = null;
let smokeMode = false;
let worker = null;
let started = false;

// ---- quit state -------------------------------------------------------------------------------------------------
/** Marks an intentional quit so window-all-closed quits and the confirmation is skipped ('update' | 'shutdown' | 'user'). */
export function markQuitting(reason = 'user') {
  quitReason = reason;
}
export const isQuitting = () => quitReason != null;

// ---- single instance --------------------------------------------------------------------------------------------
/**
 * Must run before app ready. A second launch focuses the existing window instead of starting a second publisher.
 * @returns {boolean} false when another instance owns the lock (this one is quitting)
 */
export function acquireSingleInstance({ smoke = false } = {}) {
  if (smoke) return true;
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => { app.whenReady().then(() => showWindow()).catch((e) => console.error('[lifecycle] focus failed', e)); });
  return true;
}

// ---- publishing worker (chunk B) --------------------------------------------------------------------------------
async function loadWorker() {
  if (worker) return worker;
  try {
    worker = await import('./publishing/worker.js');
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes('worker.js')) console.info('[lifecycle] publishing worker not available in this build');
    else console.error('[lifecycle] publishing worker failed to load', e);
    worker = null;
  }
  return worker;
}

const callWorker = (name, ...args) => {
  try {
    return typeof worker?.[name] === 'function' ? worker[name](...args) : undefined;
  } catch (e) {
    console.error(`[lifecycle] worker.${name} failed`, e);
    return undefined;
  }
};

/** Nudges the publishing worker (resume, unlock, tray resume). */
export function wakePublishing() {
  callWorker('wake');
}

// ---- scheduled items for the tray / quit confirmation ----------------------------------------------------------
/** Pending targets with account usernames (post time = scheduledAt). */
export function scheduledItems() {
  try {
    const targets = listTargets({ states: [...SCHEDULED_TARGET_STATES] });
    const names = new Map(q.all('SELECT ig_id, username FROM accounts').map((r) => [r.ig_id, r.username]));
    return targets.map((t) => ({ ...t, username: names.get(t.accountId) ?? null }));
  } catch (e) {
    console.error('[lifecycle] scheduled items failed', e);
    return [];
  }
}

// ---- background settings -----------------------------------------------------------------------------------------
export function backgroundState() {
  return {
    trayMode: getConfig('app.trayMode') === true,
    launchAtLogin: getConfig('app.launchAtLogin') === true,
    startHidden: getConfig('app.startHidden') !== false,
    keepAwakeForPosts: getConfig('app.keepAwakeForPosts') === true,
    supported: supportedFeatures(process.platform),
  };
}

function linuxAutostartPath() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', LINUX_AUTOSTART);
}

/** Registers/unregisters the OS login item from the current settings. Dev builds only log (they would register bare Electron). */
function applyLoginItem() {
  const s = backgroundState();
  if (!s.supported.loginItem) return;
  if (!app.isPackaged) { console.info('[lifecycle] login item not registered in development builds'); return; }
  try {
    if (process.platform === 'linux') {
      const file = linuxAutostartPath();
      if (!s.launchAtLogin) { fs.rmSync(file, { force: true }); return; }
      const { args } = loginItemArgs({ openAtLogin: true, startHidden: s.startHidden, trayMode: s.trayMode });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, linuxAutostartDesktop({ execPath: process.execPath, appImage: process.env.APPIMAGE, hidden: args.length > 0 }), 'utf8');
      return;
    }
    app.setLoginItemSettings(loginItemArgs({
      openAtLogin: s.launchAtLogin, startHidden: s.startHidden, trayMode: s.trayMode,
      path: process.platform === 'win32' ? process.execPath : undefined,
    }));
  } catch (e) {
    console.error('[lifecycle] login item', e);
    throw new Error(msg('bg_login_item_failed', { detail: e?.message ?? String(e) }));
  }
}

function applyTray(on) {
  if (smokeMode) return;
  if (on) createTray({ items: scheduledItems, wake: wakePublishing });
  else destroyTray();
  updateDock();
}

/** app:background:set — saves known keys and applies them immediately. */
export function updateBackground(patch) {
  const clean = sanitizeBackgroundPatch(patch);
  const before = backgroundState();
  for (const [k, v] of Object.entries(clean)) setConfig(`app.${k}`, v);
  const after = backgroundState();
  if (before.trayMode !== after.trayMode) applyTray(after.trayMode);
  if (['launchAtLogin', 'startHidden', 'trayMode'].some((k) => before[k] !== after[k])) applyLoginItem();
  return after;
}

// ---- windows, dock, hidden start ---------------------------------------------------------------------------------
function updateDock() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const hide = shouldHideDock({ platform: 'darwin', trayMode: backgroundState().trayMode, windowCount: visibleWindowCount() });
  if (hide) app.dock.hide();
  else void app.dock.show();
}

/** Offscreen helper windows (PDF export) are never shown and don't count. */
function visibleWindowCount() {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !w.webContents.isOffscreen()).length;
}

/** No window on this launch? (login start in tray mode). */
export function shouldStartHidden() {
  const s = backgroundState();
  let loginSettings = {};
  if (process.platform === 'darwin') { try { loginSettings = app.getLoginItemSettings(); } catch { loginSettings = {}; } }
  return startHidden({
    argv: process.argv, platform: process.platform, trayMode: s.trayMode, startHiddenPref: s.startHidden,
    launchAtLogin: s.launchAtLogin, loginSettings, systemUptimeSec: os.uptime(),
  });
}

function showTrayHintOnce() {
  if (getSetting(HINT_KEY, false) || !Notification.isSupported()) return;
  setSetting(HINT_KEY, true);
  const body = msg(process.platform === 'darwin' ? 'bg_tray_hint_body_mac' : 'bg_tray_hint_body');
  new Notification({ title: msg('bg_tray_hint_title'), body, silent: true }).show();
}

function onAllWindowsClosed() {
  const trayMode = backgroundState().trayMode;
  if (shouldQuitOnAllClosed({ platform: process.platform, trayMode, smoke: smokeMode, quitting: isQuitting() })) { app.quit(); return; }
  if (trayMode) { showTrayHintOnce(); updateDock(); }
}

/**
 * before-quit guard: asks when app-mode posts are due within 2 h. Returns false (and cancels) when the user stays.
 * Update installs and OS shutdown never ask.
 */
export function confirmQuit(event) {
  if (smokeMode || quitReason === 'update' || quitReason === 'shutdown' || quitReason === 'confirmed') return true;
  const n = quitNeedsConfirm({ items: scheduledItems(), now: Date.now(), reason: quitReason });
  if (n > 0) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning', buttons: [msg('bg_quit_anyway'), msg('bg_cancel')], defaultId: 1, cancelId: 1,
      title: msg('bg_quit_confirm_title'), message: msg('bg_quit_confirm_title'), detail: msg('bg_quit_confirm_body', { n }),
    });
    if (choice !== 0) { event?.preventDefault(); quitReason = null; return false; }
  }
  quitReason = 'confirmed';
  return true;
}

function onPowerWake() {
  wakePublishing();
  try { runNotifications(); } catch (e) { console.error('[lifecycle] notifications after resume', e); }
  refreshTray();
}

/**
 * Starts background mode after the DB and IPC are ready: publishing worker, tray, login item refresh, power events.
 * @param {{ smoke?: boolean }} opts
 */
export async function startBackground({ smoke = false } = {}) {
  if (started) return;
  started = true;
  smokeMode = smoke;
  app.on('window-all-closed', onAllWindowsClosed);
  app.on('browser-window-created', () => { if (process.platform === 'darwin' && app.dock) void app.dock.show(); });
  if (smoke) return;
  powerMonitor.on('resume', onPowerWake);
  powerMonitor.on('unlock-screen', onPowerWake);
  powerMonitor.on('shutdown', () => markQuitting('shutdown'));
  const s = backgroundState();
  if (s.trayMode) applyTray(true);
  if (s.launchAtLogin) { try { applyLoginItem(); } catch { /* logged in applyLoginItem */ } }
  const mod = await loadWorker();
  if (typeof mod?.startPublishing === 'function') {
    try { await mod.startPublishing(); } catch (e) { console.error('[lifecycle] startPublishing failed', e); }
  }
}

/** Stops the worker and the tray (before-quit). */
export function stopBackground() {
  callWorker('stopPublishing');
  destroyTray();
}
