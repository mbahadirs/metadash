import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { currentLang, locale } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(v);
const df = (v, type) => { const d = typeof v === 'number' ? new Date(v) : new Date(String(v).length === 10 ? `${v}T00:00:00` : v); return Number.isNaN(d.getTime()) ? esc(v) : type === 'date' ? d.toLocaleDateString(locale()) : d.toLocaleString(locale()); };

function cell(v, type) {
  if (v == null || v === '') return '<span class="m">—</span>';
  if (type === 'date' || type === 'datetime') return df(v, type);
  if (typeof v === 'number') return type === 'percent' ? `%${nf(v)}` : nf(v);
  return esc(v);
}

/** Renders sheet data (same shape as the Excel export) to a landscape A4 PDF. */
export async function writeTablePdf(filePath, { title, sheets, subtitle }) {
  const body = sheets.map((s) => `<h2>${esc(s.name)} <span class="m">· ${s.rows.length}</span></h2><table><thead><tr>${s.columns.map((c) => `<th class="${['int', 'float', 'percent', 'money'].includes(c.type) ? 'n' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${s.rows.map((r) => `<tr>${s.columns.map((c) => `<td class="${['int', 'float', 'percent', 'money'].includes(c.type) ? 'n' : ''}">${cell(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('');
  const html = `<!doctype html><html lang="${currentLang()}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;font-size:10px;color:#111;margin:0;padding:18px}h1{font-size:16px;margin:0 0 2px}h2{font-size:12px;margin:14px 0 6px}.m{color:#777;font-weight:normal}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;page-break-inside:auto}th{background:#eef0f4;text-align:left;font-weight:600;padding:5px 6px;border-bottom:1px solid #ccd;white-space:nowrap}td{padding:4px 6px;border-bottom:1px solid #e3e6ec;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
th.n,td.n{text-align:right}tr{page-break-inside:avoid}.sub{color:#666;font-size:10px;margin-bottom:8px}</style></head><body><h1>${esc(title)}</h1><div class="sub">${esc(subtitle ?? '')} · MetaDash · ${new Date().toLocaleString(locale())}</div>${body}</body></html>`;
  const tmp = path.join(os.tmpdir(), `metadash-table-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { offscreen: true, sandbox: true } });
  try {
    await win.loadFile(tmp);
    const buffer = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: true, margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 } });
    fs.writeFileSync(filePath, buffer);
  } finally {
    win.destroy();
    fs.rmSync(tmp, { force: true });
  }
  return filePath;
}
