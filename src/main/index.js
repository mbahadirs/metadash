import { app, BrowserWindow, shell, nativeTheme } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb } from './db/index.js';
import { registerIpc } from './ipc/index.js';
import { startScheduler, stopScheduler } from './sync/scheduler.js';
import { getConfig } from './config/store.js';
import { seedDemo, isSeeded } from './seed/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const SMOKE = process.env.METADASH_SMOKE === '1';

let mainWindow = null;
if (process.env.METADASH_USER_DATA) app.setPath('userData', process.env.METADASH_USER_DATA);

function createWindow() {
  mainWindow = new BrowserWindow({
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
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
  if (SMOKE) runSmoke(mainWindow);
  mainWindow.on('closed', () => { mainWindow = null; });
}

/** Walks every route, records renderer errors and saves screenshots (METADASH_SMOKE=1). */
async function runSmoke(win) {
  const fs = await import('node:fs');
  const outDir = process.env.METADASH_SMOKE_DIR ?? path.join(app.getPath('userData'), 'smoke');
  fs.mkdirSync(outDir, { recursive: true });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errors.push(message); });
  win.webContents.on('did-fail-load', (_e, code, desc) => { console.error('did-fail-load', code, desc); app.exit(2); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const routes = (process.env.METADASH_SMOKE_ROUTES ?? '/,/account/17840000,/content,/compare,/ads,/competitors,/reports,/presentation,/settings,/setup').split(',');
  win.webContents.once('did-finish-load', async () => {
    await sleep(1500);
    const ok = await win.webContents.executeJavaScript('!!document.querySelector("[data-app-ready]")');
    console.log('[smoke] app-ready:', ok);
    if (process.env.METADASH_SMOKE_THEME) await win.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme', '${process.env.METADASH_SMOKE_THEME}')`);
    for (const route of routes) {
      await win.webContents.executeJavaScript(`location.hash = '#${route}'`);
      await sleep(route === '/' ? 800 : 1400);
      for (const sel of (process.env.METADASH_SMOKE_CLICK ?? '').split('|').filter(Boolean)) {
        await win.webContents.executeJavaScript(`(() => { const sel = ${JSON.stringify(sel)}; if (sel.startsWith('scroll=')) { const target = [...document.querySelectorAll('section, div')].find((n) => n.innerText && n.innerText.trim().startsWith(sel.slice(7))); if (target) target.scrollIntoView({ block: 'start' }); return !!target; } const el = sel.startsWith('text=') ? [...document.querySelectorAll('button, a, [role=tab]')].find((b) => b.innerText.trim() === sel.slice(5)) : document.querySelector(sel); if (el) el.click(); return !!el; })()`);
        await sleep(900);
      }
      const keys = Number(process.env.METADASH_SMOKE_KEYS ?? 0);
      for (let k = 1; k <= keys; k += 1) {
        const shot = await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, `${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}-${k}.png`), shot.toPNG());
        await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))`);
        await sleep(700);
      }
      const text = await win.webContents.executeJavaScript('document.body.innerText.replace(/\\s+/g, " ").slice(0, 300)');
      const img = await win.webContents.capturePage();
      const file = path.join(outDir, route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root') + '.png';
      fs.writeFileSync(file, img.toPNG());
      console.log(`[smoke] ${route} → ${text.slice(0, 120)}`);
    }
    if (process.env.METADASH_SMOKE_SYNC === '1') {
      await win.webContents.executeJavaScript(`location.hash = '#/'`);
      const res = await win.webContents.executeJavaScript('window.api.sync.run({ scope: "full" })');
      console.log('[smoke] sync.run →', JSON.stringify(res));
      for (let i = 0; i < 60; i += 1) { await sleep(500); const st = await win.webContents.executeJavaScript('window.api.sync.status()'); if (!st.data.running) { console.log('[smoke] sync done', JSON.stringify(st.data).slice(0, 200)); break; } }
      await sleep(800);
      fs.writeFileSync(path.join(outDir, 'after-sync.png'), (await win.webContents.capturePage()).toPNG());
    }
    console.log('[smoke] renderer errors:', errors.length);
    for (const e of errors.slice(0, 20)) console.log('  ', e.slice(0, 300));
    app.exit(ok && errors.length === 0 ? 0 : 1);
  });
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  openDb(path.join(userData, 'data.db'));
  if (!app.isPackaged && process.argv.includes('--demo') && !isSeeded()) seedDemo({ reset: false });
  nativeTheme.themeSource = getConfig('theme') === 'light' ? 'light' : 'dark';
  registerIpc();
  createWindow();
  startScheduler();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || SMOKE) app.quit();
});

app.on('before-quit', () => {
  stopScheduler();
  closeDb();
});
