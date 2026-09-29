/** HTML fragments for white-label branding, shared by the HTML/PDF report and the table PDF. */
import { DEFAULT_ACCENT, hasBrandHeader, safeLogo } from './branding.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const BRAND_CSS = '.brand{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:2px solid var(--accent)}.brand img{max-height:40px;max-width:180px;object-fit:contain}.brand .an{font-size:15px;font-weight:600}.foot .ft{color:var(--ink-1);margin-bottom:4px}';

/** Agency logo + name bar ('' when neither is set). Logos only ever go into <img src>. */
export function brandBar(b) {
  if (!hasBrandHeader(b)) return '';
  const logo = safeLogo(b.logo);
  return `<div class="brand">${logo ? `<img src="${logo}" alt="${esc(b.agencyName || 'logo')}">` : ''}${b.agencyName ? `<span class="an">${esc(b.agencyName)}</span>` : ''}</div>`;
}

/** Footer: optional custom text, then either the MetaDash credit or a neutral line. */
export function footerHtml(b, credit, plain = '') {
  const line = b.hideCredit ? plain : credit;
  return `${b.footerText ? `<div class="ft">${esc(b.footerText)}</div>` : ''}${line ? `<div>${esc(line)}</div>` : ''}`;
}

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(',');

/** Swaps the default accent (#4F7CFF / rgba(79,124,255,…)) for the brand accent in generated markup. */
export function recolorAccent(html, accent) {
  if (!accent || accent.toLowerCase() === DEFAULT_ACCENT.toLowerCase()) return html;
  return html.replace(/#4F7CFF/gi, accent).replace(/rgba\(79,124,255,/g, `rgba(${rgb(accent)},`);
}
