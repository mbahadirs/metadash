import { useState, type RefObject } from 'react';
import { api, call } from '@/lib/api';
import { useT, decimalSeparator, type Lang } from '@/lib/i18n';
import { useAppStore } from '@/store/app';

export type XlsxType = 'text' | 'int' | 'float' | 'percent' | 'money' | 'date' | 'datetime';
export interface XlsxColumn { key: string; label: string; type?: XlsxType }
export interface XlsxSheet { name: string; columns: XlsxColumn[]; rows: object[]; note?: string }

/**
 * "Excel" button. Either pass `getData` (exact rows as shown, with typed columns) or `tableRef`
 * (falls back to reading the rendered <table>, parsing locale-formatted numbers).
 */
export function ExcelButton({ name, getData, tableRef, small = true, label, pdf = true, title }: { name: string; getData?: () => XlsxSheet | XlsxSheet[]; tableRef?: RefObject<HTMLElement | null>; small?: boolean; label?: string; pdf?: boolean; title?: string }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const run = async (kind: 'xlsx' | 'pdf' = 'xlsx') => {
    setBusy(true); setDone(null);
    try {
      let sheets: XlsxSheet[] = [];
      if (getData) { const d = getData(); sheets = Array.isArray(d) ? d : [d]; }
      else if (tableRef?.current) sheets = [domTableToSheet(tableRef.current, name, lang)];
      const res = await call<{ filePath?: string; canceled?: boolean; rows?: number }>(kind === 'pdf' ? api.export.tablePdf({ name, title: title ?? sheets[0]?.name ?? name, sheets }) : api.export.xlsx({ name, sheets }));
      if (!res.canceled && res.filePath) setDone(res.filePath.split('/').pop() ?? '');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setDone(null), 4000);
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <button className={`btn ${small ? 'btn-sm' : ''} text-ink-2 hover:text-ink-1`} onClick={(e) => { e.stopPropagation(); run('xlsx'); }} disabled={busy} title={t('export_excel')}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M9 13l6 6M15 13l-6 6" /></svg>
        {done ? `✓ ${done}` : label ?? (busy ? '…' : 'Excel')}
      </button>
      {pdf && <button className={`btn ${small ? 'btn-sm' : ''} text-ink-2 hover:text-ink-1`} onClick={(e) => { e.stopPropagation(); run('pdf'); }} disabled={busy} title={t('export_pdf_table')}>{t('export_pdf_table')}</button>}
    </span>
  );
}

const NUM_RE = /^[▲▼+−-]?\s*[\d.,]+\s*%?$/;

/** Reads a rendered table. Stacked cells (value + delta) become "value" and "value Δ" columns. */
export function domTableToSheet(root: HTMLElement, name: string, lang: Lang): XlsxSheet {
  const table = root.tagName === 'TABLE' ? root : root.querySelector('table');
  if (!table) return { name, columns: [], rows: [] };
  const headers = [...table.querySelectorAll('thead th')].map((th, i) => (th.textContent ?? '').replace(/[▲▼]/g, '').trim() || `col${i + 1}`);
  const bodyRows = [...table.querySelectorAll('tbody tr')].filter((tr) => tr.querySelectorAll('td').length >= headers.length - 1);
  const columns: XlsxColumn[] = [];
  const keyFor = (i: number) => `c${i}`;
  headers.forEach((h, i) => { columns.push({ key: keyFor(i), label: h, type: 'text' }); });
  const extra = new Map<number, XlsxColumn>();
  const rows: Record<string, unknown>[] = bodyRows.map((tr) => {
    const out: Record<string, unknown> = {};
    [...tr.querySelectorAll('td')].forEach((td, i) => {
      if (i >= headers.length) return;
      const parts = cellParts(td);
      const [main, ...rest] = parts;
      const parsed = parseCell(main, lang);
      out[keyFor(i)] = parsed.value;
      if (parsed.type !== 'text') columns[i].type = parsed.type;
      if (rest.length) {
        if (!extra.has(i)) extra.set(i, { key: `${keyFor(i)}_d`, label: `${headers[i]} Δ`, type: 'text' });
        const p2 = parseCell(rest.join(' '), lang);
        out[`${keyFor(i)}_d`] = p2.value;
        if (p2.type !== 'text') extra.get(i)!.type = p2.type;
      }
    });
    return out;
  });
  const cols = columns.flatMap((c, i) => (extra.has(i) ? [c, extra.get(i)!] : [c])).filter((c) => rows.some((r) => r[c.key] != null && r[c.key] !== '') || c.label);
  return { name, columns: cols, rows };
}

function cellParts(td: Element): string[] {
  const stacked = td.querySelector('.leading-tight');
  if (stacked) {
    const divs = [...stacked.children].map((el) => (el.textContent ?? '').trim()).filter(Boolean);
    const own = [...stacked.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => (n.textContent ?? '').trim()).filter(Boolean).join(' ');
    return [own, ...divs].filter(Boolean);
  }
  return [(td.textContent ?? '').replace(/\s+/g, ' ').trim()];
}

function parseCell(text: string, lang: Lang): { value: unknown; type: XlsxType } {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s || s === '—' || s === '-') return { value: null, type: 'text' };
  const m = /^([▲▼+−-]?)\s*([\d.,]+)\s*(%?)$/.exec(s.replace(/^[▲▼]\s*/, (x) => x));
  if (m && NUM_RE.test(s)) {
    const sign = m[1] === '▼' || m[1] === '−' || m[1] === '-' ? -1 : 1;
    const raw = decimalSeparator(lang) === '.' ? m[2].replace(/,/g, '') : m[2].replace(/\./g, '').replace(',', '.');
    const n = Number(raw);
    if (Number.isFinite(n)) return { value: sign * n, type: m[3] ? 'percent' : Number.isInteger(n) ? 'int' : 'float' };
  }
  return { value: s, type: 'text' };
}
