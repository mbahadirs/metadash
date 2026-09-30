import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { toCsv } from '../src/main/export/csv.js';
import { writeWorkbook } from '../src/main/export/xlsx.js';
import { neutralizeFormula } from '../src/main/export/formulaGuard.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-formula-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('spreadsheet formula injection guard', () => {
  it('prefixes strings that a spreadsheet would treat as a formula', () => {
    for (const s of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tfoo', '\rbar']) expect(neutralizeFormula(s)).toBe(`'${s}`);
    for (const s of ['hello', '', 'a=b', ' =x', '1-2']) expect(neutralizeFormula(s)).toBe(s);
    expect(neutralizeFormula(-5)).toBe(-5);
    expect(neutralizeFormula(null)).toBe(null);
  });

  it('CSV: neutralizes text cells and headers, leaves numbers alone', () => {
    const csv = toCsv(['caption', 'reach', '=cmd'], [{ caption: '=HYPERLINK("http://evil","click")', reach: -12, '=cmd': '@x' }, ['+SUM(1)', 3, 'ok']]);
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe("caption,reach,'=cmd");
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil"",""click"")",-12,'@x`);
    expect(lines[2]).toBe("'+SUM(1),3,ok");
  });

  it('XLSX: neutralizes text-typed cells (and text fallbacks), keeps numbers numeric', async () => {
    const file = path.join(dir, 'f.xlsx');
    await writeWorkbook(file, [{
      name: 'S',
      columns: [{ key: 'caption', label: 'Caption', type: 'text' }, { key: 'reach', label: 'Reach', type: 'int' }, { key: 'raw', label: 'Raw' }],
      rows: [{ caption: '=1+1', reach: -5, raw: '-cmd|calc' }, { caption: 'fine', reach: '=1.2.3', raw: 7 }],
    }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet('S');
    expect(ws.getCell('A2').value).toBe("'=1+1");
    expect(ws.getCell('B2').value).toBe(-5);
    expect(ws.getCell('C2').value).toBe("'-cmd|calc");
    expect(ws.getCell('A3').value).toBe('fine');
    expect(ws.getCell('B3').value).toBe("'=1.2.3");
    expect(ws.getCell('C3').value).toBe(7);
  });
});
