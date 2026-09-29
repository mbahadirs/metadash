import ExcelJS from 'exceljs';

/**
 * Generic workbook writer. sheets: [{ name, columns: [{ key, label, type }], rows: object[] }]
 * type: 'text' | 'int' | 'float' | 'percent' | 'money' | 'date' | 'datetime'
 */
const NUM_FMT = { int: '#,##0', float: '#,##0.00', percent: '0.00"%"', money: '#,##0.00', date: 'dd.mm.yyyy', datetime: 'dd.mm.yyyy hh:mm' };

/** Options: creator (workbook metadata), title (optional bold title row above each sheet's header, e.g. the agency name). */
export async function writeWorkbook(filePath, sheets, { creator = 'MetaDash', title = '' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date();
  const used = new Set();
  for (const sheet of sheets) {
    if (!sheet?.columns?.length) continue;
    let name = String(sheet.name ?? 'Sayfa').replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Sayfa';
    let i = 2;
    while (used.has(name)) name = `${name.slice(0, 28)} ${i++}`;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sheet.columns.map((c) => ({ header: c.label ?? c.key, key: c.key, width: Math.min(60, Math.max(10, String(c.label ?? c.key).length + 4)) }));
    for (const row of sheet.rows ?? []) {
      const out = {};
      for (const c of sheet.columns) out[c.key] = coerce(row[c.key], c.type);
      ws.addRow(out);
    }
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0F4' } };
    header.alignment = { vertical: 'middle' };
    sheet.columns.forEach((c, idx) => {
      const col = ws.getColumn(idx + 1);
      if (NUM_FMT[c.type]) col.numFmt = NUM_FMT[c.type];
      if (['int', 'float', 'percent', 'money'].includes(c.type)) col.alignment = { horizontal: 'right' };
      const longest = Math.max(String(c.label ?? c.key).length, ...(sheet.rows ?? []).slice(0, 200).map((r) => String(r[c.key] ?? '').length));
      col.width = Math.min(60, Math.max(10, longest + 2));
    });
    if ((sheet.rows ?? []).length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    if (sheet.note) {
      ws.addRow([]);
      const r = ws.addRow([sheet.note]);
      r.font = { italic: true, color: { argb: 'FF888888' } };
    }
    if (title) addTitleRow(ws, String(title), sheet.columns.length, (sheet.rows ?? []).length > 0);
  }
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

/** Inserts a title row above the header and shifts the frozen pane / filter to the header's new row. */
function addTitleRow(ws, title, cols, filtered) {
  ws.spliceRows(1, 0, [title]);
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  if (filtered) ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols } };
}

function coerce(v, type) {
  if (v == null || v === '') return null;
  if (type === 'date' || type === 'datetime') {
    const d = typeof v === 'number' ? new Date(v) : new Date(String(v).length === 10 ? `${v}T00:00:00` : v);
    return Number.isNaN(d.getTime()) ? String(v) : d;
  }
  if (['int', 'float', 'percent', 'money'].includes(type)) {
    if (typeof v === 'number') return v;
    const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : String(v);
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
