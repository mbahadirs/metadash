import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { buildReport } from './htmlReport.js';

/** Renders the report HTML in an offscreen window and prints it to PDF. */
export async function writePdfReport(template, params, filePath) {
  const html = buildReport(template, params);
  const tmp = path.join(os.tmpdir(), `metadash-report-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { offscreen: true, sandbox: true } });
  try {
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 300));
    const buffer = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    fs.writeFileSync(filePath, buffer);
  } finally {
    win.destroy();
    fs.rmSync(tmp, { force: true });
  }
  return filePath;
}
