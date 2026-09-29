/** Printable HTML for table exports (same sheet shape as the Excel export); rendered to PDF by tablePdf.js. */
import { currentLang, locale } from '../i18n.js';
import { resolveBranding } from './branding.js';
import { esc, brandBar, footerHtml, BRAND_CSS } from './brandingHtml.js';

const NUM = ['int', 'float', 'percent', 'money'];
const nf = (v) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(v);
const df = (v, type) => { const d = typeof v === 'number' ? new Date(v) : new Date(String(v).length === 10 ? `${v}T00:00:00` : v); return Number.isNaN(d.getTime()) ? esc(v) : type === 'date' ? d.toLocaleDateString(locale()) : d.toLocaleString(locale()); };

function cell(v, type) {
  if (v == null || v === '') return '<span class="m">—</span>';
  if (type === 'date' || type === 'datetime') return df(v, type);
  if (typeof v === 'number') return type === 'percent' ? `%${nf(v)}` : nf(v);
  return esc(v);
}

const sheetHtml = (s) => `<h2>${esc(s.name)} <span class="m">· ${s.rows.length}</span></h2><table><thead><tr>${s.columns.map((c) => `<th class="${NUM.includes(c.type) ? 'n' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${s.rows.map((r) => `<tr>${s.columns.map((c) => `<td class="${NUM.includes(c.type) ? 'n' : ''}">${cell(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function tableHtml({ title, sheets, subtitle, lang = currentLang(), branding }) {
  const b = resolveBranding(branding);
  const when = new Date().toLocaleString(locale(lang));
  const sub = [subtitle, b.hideCredit ? null : 'MetaDash', when].filter(Boolean).map(esc).join(' · ');
  const foot = b.footerText ? `<footer class="foot">${footerHtml({ ...b, hideCredit: true }, '')}</footer>` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
:root{--accent:${b.accent};--ink-1:#111}body{font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;font-size:10px;color:#111;margin:0;padding:18px}h1{font-size:16px;margin:8px 0 2px}h2{font-size:12px;margin:14px 0 6px;color:var(--accent)}.m{color:#777;font-weight:normal}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;page-break-inside:auto}th{background:#eef0f4;text-align:left;font-weight:600;padding:5px 6px;border-bottom:2px solid var(--accent);white-space:nowrap}td{padding:4px 6px;border-bottom:1px solid #e3e6ec;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
th.n,td.n{text-align:right}tr{page-break-inside:avoid}.sub{color:#666;font-size:10px;margin-bottom:8px}.foot{margin-top:16px;padding-top:8px;border-top:1px solid #e3e6ec;color:#666}${BRAND_CSS}</style></head><body>${brandBar(b)}<h1>${esc(title)}</h1><div class="sub">${sub}</div>${sheets.map(sheetHtml).join('')}${foot}</body></html>`;
}
