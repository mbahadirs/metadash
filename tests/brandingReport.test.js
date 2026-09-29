import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { subDays } from 'date-fns';
import { openDb, closeDb } from '../src/main/db/index.js';
import { seedDemo } from '../src/main/seed/index.js';
import { buildReport } from '../src/main/export/htmlReport.js';
import { writeWorkbook } from '../src/main/export/xlsx.js';
import { setClientLogo, getClientLogo, clientLogoFlags } from '../src/main/db/queries/accountLogos.js';
import { fmtDate } from '../src/main/analytics/util.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const CLIENT_SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>').toString('base64')}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-brand-'));
const to = fmtDate(new Date());
const from = fmtDate(subDays(new Date(), 27));
const IG = '17840000';

beforeAll(() => { openDb(path.join(dir, 'data.db')); seedDemo({ reset: true }); });
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('branded HTML reports', () => {
  it('unbranded report keeps the MetaDash credit', () => {
    const html = buildReport('monthly', { igId: IG, from, to });
    expect(html).toContain('Generated with MetaDash');
    expect(html).not.toContain('class="brand"');
  });
  it('includes agency name, logo, footer and accent; omits the credit when hidden', () => {
    const branding = { agencyName: 'Acme <Agency>', logo: PNG, accent: '#ff3366', footerText: 'hello@acme.io · acme.io', hideCredit: true };
    for (const tpl of ['monthly', 'portfolio', 'campaign']) {
      const html = buildReport(tpl, { igId: IG, igIds: [IG], from, to, branding });
      expect(html).toContain('Acme &lt;Agency&gt;');
      expect(html).toContain(`src="${PNG}"`);
      expect(html).toContain('hello@acme.io · acme.io');
      expect(html).toContain('--accent:#ff3366');
      expect(html).not.toContain('MetaDash');
      expect(html).not.toMatch(/#4F7CFF/i);
    }
  });
  it('invalid branding values fall back safely', () => {
    const html = buildReport('monthly', { igId: IG, from, to, branding: { agencyName: 'X', accent: 'red;}</style><script>', logo: 'javascript:alert(1)' }, logoDataUrl: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Generated with MetaDash');
  });
  it('stores a per-account client logo and shows it for single-account reports', () => {
    setClientLogo(IG, CLIENT_SVG);
    expect(getClientLogo(IG)).toBe(CLIENT_SVG);
    expect(clientLogoFlags()[IG]).toBe(true);
    expect(buildReport('monthly', { igId: IG, from, to })).toContain(`src="${CLIENT_SVG}"`);
    expect(buildReport('portfolio', { from, to })).not.toContain(CLIENT_SVG);
    expect(() => setClientLogo(IG, 'data:image/png;base64,AAAA')).toThrow();
    setClientLogo(IG, null);
    expect(getClientLogo(IG)).toBeNull();
  });
});

describe('branded Excel export', () => {
  it('adds a title row with the agency name when requested', async () => {
    const file = path.join(dir, 'b.xlsx');
    await writeWorkbook(file, [{ name: 'S', columns: [{ key: 'a', label: 'A', type: 'int' }], rows: [{ a: 1 }, { a: 2 }] }], { title: 'Acme Agency' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet('S');
    expect(ws.getCell('A1').value).toBe('Acme Agency');
    expect(ws.getCell('A2').value).toBe('A');
    expect(ws.getCell('A3').value).toBe(1);
  });
});
