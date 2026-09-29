import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { progressBus } from './sync/progress.js';

/**
 * The single main window: creation, lookup, showing and in-app navigation. Shared by index.js, notifications,
 * publishing notifications (chunk B) and the tray (chunk C). The window may be destroyed while the app keeps running
 * (tray mode); ensureWindow() recreates it.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const NAVIGATE_DELAY_MS = 600;

let mainWindow = null;
let onCreated = null;

/** index.js registers a hook that runs for every new window (smoke runner). */
export function configureAppWindow({ onWindowCreated } = {}) {
  onCreated = onWindowCreated ?? null;
}

export function createMainWindow({ show = true } = {}) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#10131A',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = win;
  if (show) win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  onCreated?.(win);
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  return win;
}

/** The live main window, or null (never created, closed or destroyed). */
export function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** Returns the main window, creating it when needed (e.g. from a notification click in tray mode). */
export function ensureWindow() {
  return getMainWindow() ?? createMainWindow();
}

/** Brings the main window to the front (restoring/creating it). */
export function showWindow() {
  const win = ensureWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

/** Shows the window and asks the renderer to navigate (hash route, e.g. '/planner?tab=queue'). */
export function navigateTo(route) {
  const win = showWindow();
  const send = () => progressBus.emit('app:navigate', { route });
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, NAVIGATE_DELAY_MS));
  else send();
}
