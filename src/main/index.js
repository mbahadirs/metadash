import { app, BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';
import { openDb, closeDb } from './db/index.js';
import { registerIpc } from './ipc/index.js';
import { startScheduler, stopScheduler } from './sync/scheduler.js';
import { getConfig } from './config/store.js';
import { seedDemo, isSeeded } from './seed/index.js';
import { startUpdater, stopUpdater } from './updater.js';
import { startNotifications, stopNotifications } from './notifications.js';
import { configureAppWindow, createMainWindow } from './appWindow.js';
import { registerMediaScheme, handleMediaProtocol } from './protocol.js';
import { acquireSingleInstance, shouldStartHidden, startBackground, stopBackground, confirmQuit } from './lifecycle.js';

const SMOKE = process.env.METADASH_SMOKE === '1';

if (process.env.METADASH_USER_DATA) app.setPath('userData', process.env.METADASH_USER_DATA);
// One instance per userData: a second launch focuses the running window (two instances could double-publish).
const PRIMARY = acquireSingleInstance({ smoke: SMOKE });
registerMediaScheme(); // must run before app ready
configureAppWindow({ onWindowCreated: SMOKE ? (win) => runSmoke(win) : null });

/** Walks every route, records renderer errors and saves screenshots (METADASH_SMOKE=1). */
async function runSmoke(win) {
  const fs = await import('node:fs');
  const outDir = process.env.METADASH_SMOKE_DIR ?? path.join(app.getPath('userData'), 'smoke');
  fs.mkdirSync(outDir, { recursive: true });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errors.push(message); });
  win.webContents.on('did-fail-load', (_e, code, desc) => { console.error('did-fail-load', code, desc); app.exit(2); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const routes = (process.env.METADASH_SMOKE_ROUTES ?? '/,/account/17840000,/account/fb-1000000000000001,/account/th-2500000000000001,/content,/compare,/ads,/competitors,/reports,/presentation,/planner,/settings,/setup').split(',');
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

app.whenReady().then(async () => {
  if (!PRIMARY) return;
  const userData = app.getPath('userData');
  openDb(path.join(userData, 'data.db'));
  if (!app.isPackaged && process.argv.includes('--demo') && !isSeeded()) seedDemo({ reset: false });
  nativeTheme.themeSource = getConfig('theme') === 'light' ? 'light' : 'dark';
  handleMediaProtocol();
  registerIpc();
  // Login start in tray mode: no window until the user opens one from the tray.
  if (SMOKE || !shouldStartHidden()) createMainWindow();
  startScheduler();
  if (!SMOKE) {
    startUpdater();
    startNotifications();
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
  // Tray, window-all-closed policy, login item, power events and the publishing worker (lifecycle.js).
  await startBackground({ smoke: SMOKE });
});

app.on('before-quit', (event) => {
  if (!PRIMARY) return;
  if (!confirmQuit(event)) return; // stays open when the user cancels the "posts are due" prompt
  stopBackground();
  stopScheduler();
  stopUpdater();
  stopNotifications();
  closeDb();
});
