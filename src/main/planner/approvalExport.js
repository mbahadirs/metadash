import { app, BrowserWindow, dialog, nativeImage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { q } from '../db/index.js';
import { msg, currentLang } from '../i18n.js';
import { loadBranding } from '../export/brandingStore.js';
import { resolveMediaFile } from './assets.js';
import { buildApprovalHtml } from './approvalHtml.js';
import { selectPackPosts, createPackRecord } from './approvalPack.js';
import { invalid } from './input.js';

/**
 * planner:approval:export — Electron side of approval packs: save dialog, ≤1080 px JPEG thumbnails via nativeImage,
 * pack record, HTML file or PDF (offscreen printToPDF, same pattern as export/pdf.js).
 */
const IMAGE_MAX_PX = 1080;
const JPEG_QUALITY = 80;
const MAX_MEDIA_PER_POST = 10;
const TITLE_MAX = 200;

const cleanText = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function accountsFor(posts) {
  const ids = [...new Set(posts.flatMap((p) => p.targets.map((t) => t.accountId)))];
  if (!ids.length) return {};
  const rows = q.all(`SELECT ig_id, username, platform FROM accounts WHERE ig_id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return Object.fromEntries(rows.map((r) => [r.ig_id, { username: r.username, platform: r.platform }]));
}

/** JPEG data URL (≤1080 px) for an asset: the image itself, or the video thumbnail. null when unavailable. */
function imageDataUrl(entry) {
  const variants = entry.asset?.kind === 'video' ? ['thumb'] : ['file', 'thumb'];
  for (const v of variants) {
    const file = resolveMediaFile(entry.assetId, v);
    if (!file || !fs.existsSync(file.filePath)) continue;
    const img = nativeImage.createFromPath(file.filePath);
    if (img.isEmpty()) continue;
    const { width, height } = img.getSize();
    const scale = Math.min(1, IMAGE_MAX_PX / Math.max(width, height));
    const sized = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img;
    return `data:image/jpeg;base64,${sized.toJPEG(JPEG_QUALITY).toString('base64')}`;
  }
  return null;
}

function imagesFor(posts) {
  const out = {};
  for (const p of posts) {
    for (const a of p.assets.filter((x) => x.role === 'media').slice(0, MAX_MEDIA_PER_POST)) {
      if (out[a.assetId] !== undefined) continue;
      try { out[a.assetId] = imageDataUrl(a); } catch (e) { console.warn('[approval] thumbnail failed', a.assetId, e?.message); out[a.assetId] = null; }
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

async function writePdf(html, filePath) {
  const tmp = path.join(os.tmpdir(), `metadash-approval-${process.pid}-${Date.now()}.html`);
  await fs.promises.writeFile(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { offscreen: true, sandbox: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 300));
    const buffer = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    await fs.promises.writeFile(filePath, buffer);
  } finally {
    win.destroy();
    await fs.promises.rm(tmp, { force: true });
  }
}

async function pickTarget(event, format, lang, clientName) {
  const win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
  const slug = (clientName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const name = `${msg('approval_default_name', null, lang)}${slug ? `-${slug}` : ''}-${new Date().toISOString().slice(0, 10)}.${format}`;
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: msg(format === 'pdf' ? 'approval_file_pdf' : 'approval_file_html', null, lang), extensions: [format] }],
  });
  return res.canceled || !res.filePath ? null : res.filePath;
}

/**
 * @param {import('../../renderer/lib/types').ApprovalExportInput} p
 * @returns {Promise<{ filePath: string, packId: string, count: number } | { canceled: true }>}
 */
export async function exportApprovalPack(p = {}, event) {
  if (!p || typeof p !== 'object') throw invalid('payload');
  const format = p.format === 'pdf' ? 'pdf' : p.format === 'html' || p.format == null ? 'html' : null;
  if (!format) throw invalid('format');
  const lang = p.lang === 'tr' || p.lang === 'en' ? p.lang : currentLang();
  const title = cleanText(p.title, TITLE_MAX);
  const clientName = cleanText(p.clientName, TITLE_MAX);
  const posts = selectPackPosts(p);
  const filePath = await pickTarget(event, format, lang, clientName);
  if (!filePath) return { canceled: true };
  const pack = createPackRecord({ posts, title, clientName, lang, filePath });
  const html = buildApprovalHtml({
    pack, posts, accounts: accountsFor(posts), images: imagesFor(posts), branding: loadBranding(), lang, title, clientName,
    includeNotes: p.includeNotes === true, pdf: format === 'pdf',
  });
  if (format === 'pdf') await writePdf(html, filePath);
  else await fs.promises.writeFile(filePath, html, 'utf8');
  return { filePath, packId: pack.id, count: posts.length };
}
