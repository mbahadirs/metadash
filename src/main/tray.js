import { app, Menu, Tray, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, setConfig } from './config/store.js';
import { msg, currentLang } from './i18n.js';
import { progressBus } from './sync/progress.js';
import { runSync } from './sync/orchestrator.js';
import { showWindow, navigateTo } from './appWindow.js';
import { nextPostLine, todayCount } from './lifecycleRules.js';

/**
 * Tray / menu-bar icon (v1.4 plan §9): next scheduled post, today's count, pause/resume publishing, sync now,
 * open app / planner, quit. Rebuilt on planner events and every minute. Icons live in resources/tray (copied to
 * <resources>/tray by electron-builder extraResources).
 */
const REFRESH_MS = 60_000;
const EVENTS = ['planner:changed', 'publish:progress', 'publish:missed'];

let tray = null;
let timer = null;
let deps = null;

function trayIconPath() {
  const name = process.platform === 'darwin' ? 'trayTemplate.png' : process.platform === 'win32' ? 'tray.ico' : 'tray.png';
  const base = app.isPackaged ? path.join(process.resourcesPath, 'tray') : path.join(app.getAppPath(), 'resources', 'tray');
  return path.join(base, name);
}

function trayImage() {
  const file = trayIconPath();
  const img = fs.existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
  if (img.isEmpty()) console.warn('[tray] icon missing:', file);
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function setPaused(paused) {
  setConfig('planner.paused', paused);
  if (!paused) deps?.wake?.();
  refreshTray();
}

function syncNow() {
  runSync({ scope: 'full' }).catch((e) => console.warn('[tray] sync now:', e?.message ?? e));
}

function buildMenu() {
  const items = deps?.items?.() ?? [];
  const now = Date.now();
  const lang = currentLang();
  const paused = getConfig('planner.paused') === true;
  const today = todayCount(items, now);
  const template = [
    { label: nextPostLine(items, now, lang), enabled: false },
    ...(today > 0 ? [{ label: msg('tray_today', { n: today }), enabled: false }] : []),
    ...(paused ? [{ label: msg('tray_paused'), enabled: false }] : []),
    { type: 'separator' },
    { label: msg(paused ? 'tray_resume' : 'tray_pause'), click: () => setPaused(!paused) },
    { label: msg('tray_sync'), click: syncNow },
    { type: 'separator' },
    { label: msg('tray_open'), click: () => showWindow() },
    { label: msg('tray_planner'), click: () => navigateTo('/planner') },
    { type: 'separator' },
    { label: msg('tray_quit'), click: () => app.quit() }, // before-quit (lifecycle.confirmQuit) asks when posts are due
  ];
  return { menu: Menu.buildFromTemplate(template), tooltip: `${msg('tray_tooltip')} · ${template[0].label}` };
}

/** Rebuilds the menu and tooltip (no-op without a tray). */
export function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  try {
    const { menu, tooltip } = buildMenu();
    tray.setContextMenu(menu);
    tray.setToolTip(tooltip);
  } catch (e) {
    console.error('[tray] refresh failed', e);
  }
}

/**
 * @param {{ items: () => object[], wake: () => void }} options scheduled targets provider and worker wake-up
 */
export function createTray(options) {
  deps = options;
  if (tray && !tray.isDestroyed()) { refreshTray(); return tray; }
  tray = new Tray(trayImage());
  // Windows/Linux: left click opens the window, right click shows the menu. macOS shows the menu on click.
  if (process.platform !== 'darwin') tray.on('click', () => showWindow());
  for (const evt of EVENTS) progressBus.on(evt, refreshTray);
  timer = setInterval(refreshTray, REFRESH_MS);
  refreshTray();
  return tray;
}

export function destroyTray() {
  for (const evt of EVENTS) progressBus.off(evt, refreshTray);
  if (timer) clearInterval(timer);
  timer = null;
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}
