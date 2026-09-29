import fs from 'node:fs';
import path from 'node:path';
import { app, shell, dialog, BrowserWindow } from 'electron';
import { getDb, getDbPath, closeDb, reopenDb } from '../db/index.js';
import { getConfig, setConfig, getAllConfig, DEFAULTS } from '../config/store.js';
import { runReadOnly } from '../export/csv.js';
import { METRIC_SETS } from '../meta/metricMap.js';
import { exportAll, importAll, inspectTransfer } from '../export/transfer.js';
import { msg, currentLang, isSupportedLang, resolveLang } from '../i18n.js';

const SAFE_URL = /^https?:\/\//i;
const GUIDE = 'meta-app-setup.md';

/** Setup guide path for the current language (translations under docs/<lang>/), falling back to English. */
function findGuide(lang) {
  const roots = [path.join(process.resourcesPath ?? '', 'docs'), path.join(app.getAppPath(), '..', '..', 'docs'), path.join(process.cwd(), 'docs')];
  const code = resolveLang(lang);
  const rels = code === 'en' ? [GUIDE] : [path.join(code, GUIDE), GUIDE];
  return rels.flatMap((rel) => roots.map((r) => path.join(r, rel))).find((f) => fs.existsSync(f)) ?? null;
}

export function registerSystemHandlers(handle) {
  handle('system:openExternal', async (url) => {
    if (!SAFE_URL.test(String(url))) throw new Error(msg('http_only'));
    await shell.openExternal(url);
    return true;
  });
  handle('system:revealFile', (p) => { shell.showItemInFolder(p); return true; });
  handle('system:openGuide', async () => {
    const file = findGuide(currentLang());
    if (!file) throw new Error(msg('guide_missing', { f: `docs/${GUIDE}` }));
    const res = await shell.openPath(file);
    if (res) throw new Error(res);
    return file;
  });
  handle('system:info', () => ({
    version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform,
    dbPath: getDbPath(), userData: app.getPath('userData'), metricSets: METRIC_SETS, isPackaged: app.isPackaged,
  }));
  handle('system:online', async () => {
    try {
      const res = await fetch('https://graph.facebook.com/', { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      return res.status > 0;
    } catch {
      return false;
    }
  });

  handle('settings:get', (key) => getConfig(key));
  handle('settings:set', (key, value) => {
    if (!(key in DEFAULTS) && !String(key).startsWith('ui.')) throw new Error(msg('unknown_setting', { k: key }));
    if (key === 'lang' && !isSupportedLang(value)) throw new Error(msg('unsupported_lang', { lang: String(value).slice(0, 20) }));
    setConfig(key, value);
    return value;
  });
  handle('settings:all', () => getAllConfig());
  // Localized main-process string for the preload (e.g. its chart-export error), in the configured language.
  handle('i18n:msg', (key) => msg(String(key)));

  handle('db:backup', async (_p, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `metadash-backup-${new Date().toISOString().slice(0, 10)}.db`), filters: [{ name: 'SQLite', extensions: ['db'] }] });
    if (res.canceled || !res.filePath) return { canceled: true };
    await getDb().backup(res.filePath);
    return { filePath: res.filePath, size: fs.statSync(res.filePath).size };
  });
  handle('db:restore', async (filePath, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    let source = filePath;
    if (!source) {
      const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'SQLite', extensions: ['db', 'sqlite'] }] });
      if (res.canceled || !res.filePaths[0]) return { canceled: true };
      source = res.filePaths[0];
    }
    const header = Buffer.alloc(16);
    const fd = fs.openSync(source, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    if (!header.toString('utf8').startsWith('SQLite format 3')) throw new Error(msg('not_sqlite'));
    const target = getDbPath();
    closeDb();
    const keep = `${target}.pre-restore-${Date.now()}`;
    fs.copyFileSync(target, keep);
    for (const suffix of ['-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
    fs.copyFileSync(source, target);
    reopenDb();
    return { restoredFrom: source, previousCopy: keep };
  });

  handle('transfer:export', async ({ passphrase } = {}, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `metadash-export-${new Date().toISOString().slice(0, 10)}.metadash`), filters: [{ name: msg('transfer_filter'), extensions: ['metadash'] }] });
    if (res.canceled || !res.filePath) return { canceled: true };
    return exportAll({ filePath: res.filePath, passphrase: passphrase || null, appVersion: app.getVersion() });
  });
  handle('transfer:pick', async (_p, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: msg('transfer_filter'), extensions: ['metadash', 'db'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    return { filePath: res.filePaths[0], ...inspectTransfer(res.filePaths[0]) };
  });
  handle('transfer:import', ({ filePath, passphrase }) => importAll({ filePath, passphrase: passphrase || null }));
  handle('sql:run', ({ query, limit = 500 }) => runReadOnly(String(query ?? ''), limit));
}
