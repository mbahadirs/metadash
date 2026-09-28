/** Minimal dependency-free SVG chart builders for offline HTML reports. */
import { makeL, weekdays } from './reportI18n.js';
import { locale } from '../i18n.js';

const C = { line: '#2A3040', ink2: '#9AA3B2', accent: '#4F7CFF', pos: '#3FBF8F', neg: '#E5605F', warn: '#E8B44A' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(n ?? 0);

function scale(domainMax, rangePx) {
  const max = domainMax > 0 ? domainMax : 1;
  return (v) => rangePx - (v / max) * rangePx;
}

/** series: [{ name, color, values: number[] }], labels: string[] */
export function lineChart({ series, labels, width = 720, height = 220, title, dual = null, fromMin = false }) {
  const pad = { l: 56, r: dual ? 56 : 16, t: 24, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const all = series.flatMap((s) => s.values.map((v) => v ?? 0));
  const max = Math.max(1, ...all);
  const min = fromMin && all.length ? Math.min(...all) * 0.98 : 0;
  const y = (v) => h - ((v - min) / (max - min || 1)) * h;
  const x = (i) => pad.l + (labels.length > 1 ? (i / (labels.length - 1)) * w : w / 2);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const yy = pad.t + h - f * h;
    return `<line x1="${pad.l}" x2="${pad.l + w}" y1="${yy}" y2="${yy}" stroke="${C.line}" stroke-width="1"/>
      <text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${C.ink2}">${fmt(min + (max - min) * f)}</text>`;
  }).join('');
  const paths = series.map((s) => {
    const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${(pad.t + y(v ?? 0)).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${s.color ?? C.accent}" stroke-width="2" stroke-linejoin="round"/>`;
  }).join('');
  let dualSvg = '';
  if (dual) {
    const dmax = Math.max(1, ...dual.values.map((v) => v ?? 0));
    const dy = scale(dmax, h);
    const bw = Math.max(2, (w / labels.length) * 0.6);
    dualSvg = dual.values.map((v, i) => `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(pad.t + dy(v ?? 0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${(h - dy(v ?? 0)).toFixed(1)}" fill="${dual.color ?? C.warn}" opacity="0.55"/>`).join('') +
      [0, 0.5, 1].map((f) => `<text x="${pad.l + w + 8}" y="${pad.t + h - f * h + 4}" font-size="11" fill="${C.ink2}">${fmt(dmax * f)}</text>`).join('');
  }
  const step = Math.max(1, Math.ceil(labels.length / 8));
  const xLabels = labels.map((l, i) => (i % step === 0 ? `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" font-size="11" fill="${C.ink2}">${esc(l)}</text>` : '')).join('');
  const legend = series.map((s, i) => `<g transform="translate(${pad.l + i * 140},12)"><rect width="10" height="10" rx="2" fill="${s.color ?? C.accent}"/><text x="14" y="9" font-size="11" fill="${C.ink2}">${esc(s.name)}</text></g>`).join('') +
    (dual ? `<g transform="translate(${pad.l + series.length * 140},12)"><rect width="10" height="10" rx="2" fill="${dual.color ?? C.warn}" opacity="0.6"/><text x="14" y="9" font-size="11" fill="${C.ink2}">${esc(dual.name)}</text></g>` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(title ?? '')}">${grid}${dualSvg}${paths}${xLabels}${legend}</svg>`;
}

export function barChart({ items, width = 720, height = 220, color = C.accent, title }) {
  const pad = { l: 120, r: 48, t: 12, b: 12 };
  const rowH = Math.max(18, Math.min(30, (height - pad.t - pad.b) / Math.max(1, items.length)));
  const totalH = pad.t + pad.b + rowH * items.length;
  const max = Math.max(1, ...items.map((i) => i.value ?? 0));
  const w = width - pad.l - pad.r;
  const rows = items.map((it, i) => {
    const bw = ((it.value ?? 0) / max) * w;
    const yy = pad.t + i * rowH;
    return `<text x="${pad.l - 8}" y="${yy + rowH / 2 + 4}" text-anchor="end" font-size="11" fill="${C.ink2}">${esc(it.label)}</text>
      <rect x="${pad.l}" y="${yy + 3}" width="${bw.toFixed(1)}" height="${rowH - 6}" rx="2" fill="${it.color ?? color}"/>
      <text x="${pad.l + bw + 6}" y="${yy + rowH / 2 + 4}" font-size="11" fill="${C.ink2}">${fmt(it.value)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalH}" width="100%" role="img" aria-label="${esc(title ?? '')}">${rows}</svg>`;
}

export function heatmap({ matrix, width = 720, lang = 'en' }) {
  const L = makeL(lang);
  const days = weekdays(lang);
  const cell = Math.floor((width - 40) / 24);
  const height = 20 + cell * 7;
  const max = Math.max(0.01, ...matrix.flat().filter((c) => c.qualified).map((c) => c.value ?? 0));
  const cells = matrix.flatMap((row, d) => row.map((c, hIdx) => {
    const fill = c.qualified ? `rgba(79,124,255,${(0.15 + 0.85 * ((c.value ?? 0) / max)).toFixed(2)})` : c.count ? '#2A3040' : '#1F2430';
    return `<rect x="${40 + hIdx * cell}" y="${20 + d * cell}" width="${cell - 2}" height="${cell - 2}" rx="2" fill="${fill}"><title>${days[d]} ${hIdx}:00 — ${L('heat_tip', { n: c.count, v: c.value ?? '—' })}</title></rect>`;
  })).join('');
  const dayLabels = days.map((d, i) => `<text x="0" y="${20 + i * cell + cell / 2 + 4}" font-size="11" fill="${C.ink2}">${d}</text>`).join('');
  const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => `<text x="${40 + h * cell}" y="12" font-size="10" fill="${C.ink2}">${h}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%">${dayLabels}${hourLabels}${cells}</svg>`;
}

export function sparkline(values, { width = 120, height = 28, color = C.accent } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const d = v.map((x, i) => `${i === 0 ? 'M' : 'L'}${((i / (v.length - 1)) * width).toFixed(1)},${(height - ((x - min) / span) * (height - 4) - 2).toFixed(1)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

export { esc, fmt, C };
