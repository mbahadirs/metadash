import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { tableHtml } from './tableHtml.js';

/** Renders sheet data (same shape as the Excel export) to a landscape A4 PDF, with optional report branding. */
export async function writeTablePdf(filePath, { title, sheets, subtitle, branding }) {
  const html = tableHtml({ title, sheets, subtitle, branding });
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
