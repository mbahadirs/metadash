import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, BrowserWindow } from 'electron';
import { writeHtmlReport, buildReport, TEMPLATE_SECTIONS } from '../export/htmlReport.js';
import { getSetting, setSetting } from '../db/queries/settings.js';
import { writePdfReport } from '../export/pdf.js';
import { exportCsv, CSV_QUERIES } from '../export/csv.js';
import { writeWorkbook } from '../export/xlsx.js';
import { writeTablePdf } from '../export/tablePdf.js';
import { reportSheets } from '../export/xlsxReport.js';
import { msg, currentLang } from '../i18n.js';

async function askPath(event, { defaultName, filters }) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
}

const stamp = () => new Date().toISOString().slice(0, 10);
/** Report params with lang defaulting to the configured UI language. */
const withLang = (params) => ({ ...params, lang: params?.lang ?? currentLang() });

function recordHistory(entry) {
  const list = getSetting('ui.reportHistory', []) ?? [];
  setSetting('ui.reportHistory', [{ ...entry, at: Date.now() }, ...list].slice(0, 50));
}

export function registerExportHandlers(handle) {
  handle('export:html', async ({ template, params }, event) => {
    const filePath = await askPath(event, { defaultName: `metadash-${template}-${stamp()}.html`, filters: [{ name: 'HTML', extensions: ['html'] }] });
    if (!filePath) return { canceled: true };
    writeHtmlReport(template, withLang(params), filePath);
    recordHistory({ template, filePath, kind: 'html', from: params.from, to: params.to, igIds: params.igIds ?? (params.igId ? [params.igId] : []) });
    return { filePath };
  });
  handle('export:pdf', async ({ template, params }, event) => {
    const filePath = await askPath(event, { defaultName: `metadash-${template}-${stamp()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!filePath) return { canceled: true };
    await writePdfReport(template, withLang(params), filePath);
    recordHistory({ template, filePath, kind: 'pdf', from: params.from, to: params.to, igIds: params.igIds ?? (params.igId ? [params.igId] : []) });
    return { filePath };
  });
  handle('export:csv', async ({ query, sql }, event) => {
    const filePath = await askPath(event, { defaultName: `metadash-${query ?? 'query'}-${stamp()}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!filePath) return { canceled: true };
    return exportCsv({ query, sql, filePath });
  });
  handle('export:preview', ({ template, params }) => buildReport(template, withLang(params)));
  handle('export:sections', () => TEMPLATE_SECTIONS);
  handle('export:history', () => getSetting('ui.reportHistory', []) ?? []);
  handle('export:clearHistory', () => { setSetting('ui.reportHistory', []); return []; });
  handle('export:xlsx', async ({ name, sheets }, event) => {
    if (!Array.isArray(sheets) || !sheets.length) throw new Error(msg('no_tables'));
    const safe = String(name ?? 'table').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60);
    const filePath = await askPath(event, { defaultName: `metadash-${safe}-${stamp()}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (!filePath) return { canceled: true };
    await writeWorkbook(filePath, sheets);
    return { filePath, rows: sheets.reduce((n, s) => n + (s.rows?.length ?? 0), 0) };
  });
  handle('export:tablePdf', async ({ name, title, subtitle, sheets }, event) => {
    if (!Array.isArray(sheets) || !sheets.length) throw new Error(msg('no_tables'));
    const safe = String(name ?? 'table').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60);
    const filePath = await askPath(event, { defaultName: `metadash-${safe}-${stamp()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!filePath) return { canceled: true };
    await writeTablePdf(filePath, { title: title ?? name, subtitle, sheets });
    return { filePath };
  });
  handle('export:xlsxReport', async ({ template, params }, event) => {
    const filePath = await askPath(event, { defaultName: `metadash-${template}-${stamp()}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (!filePath) return { canceled: true };
    const sheets = reportSheets(template, withLang(params));
    await writeWorkbook(filePath, sheets);
    recordHistory({ template, filePath, kind: 'xlsx', from: params.from, to: params.to, igIds: params.igIds ?? (params.igId ? [params.igId] : []) });
    return { filePath, sheets: sheets.length };
  });
  handle('export:csvQueries', () => Object.keys(CSV_QUERIES));
  handle('export:savePng', async ({ dataUrl, name }, event) => {
    const filePath = await askPath(event, { defaultName: `${name ?? 'chart'}-${stamp()}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!filePath) return { canceled: true };
    const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { filePath };
  });
  handle('export:pickLogo', async (_p, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: msg('image_filter'), extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    const file = res.filePaths[0];
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return { name: path.basename(file), dataUrl: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` };
  });
}
