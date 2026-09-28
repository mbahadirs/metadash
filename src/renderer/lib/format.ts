import { useAppStore } from '@/store/app';
import { t } from '@/lib/i18n';

export function locale(lang: 'tr' | 'en' = useAppStore.getState().lang) {
  return lang === 'tr' ? 'tr-TR' : 'en-US';
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export function fmtPct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Math.abs(v));
  const sign = signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : v < 0 ? '−' : '';
  return `${sign}${s}%`;
}

export function fmtMoney(v: number | null | undefined, currency = 'TRY', digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
  } catch {
    return `${fmtNum(v, digits)} ${currency}`;
  }
}

export function fmtMoneyCompact(v: number | null | undefined, currency = 'TRY'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
  } catch {
    return `${fmtCompact(v)} ${currency}`;
  }
}

export function fmtDate(v: number | string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }): string {
  if (v == null) return '—';
  const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T00:00:00` : v) : new Date(v);
  return new Intl.DateTimeFormat(locale(), opts).format(d);
}

export function fmtDateTime(v: number | null | undefined): string {
  return fmtDate(v, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(ms: number | null | undefined, lang = useAppStore.getState().lang): string {
  if (!ms) return t('rel_never', lang);
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return t('rel_min', lang, { n: Math.max(1, Math.floor(diff / 60_000)) });
  if (h < 24) return t('rel_hours', lang, { n: h });
  return t('rel_days', lang, { n: Math.floor(h / 24) });
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

/** Short weekday names indexed Sunday = 0, derived from Intl so no names are hardcoded. */
function weekdayNames(lang: 'tr' | 'en'): string[] {
  const fmt = new Intl.DateTimeFormat(locale(lang), { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + i)));
}

export const WEEKDAYS: Record<'tr' | 'en', string[]> = { tr: weekdayNames('tr'), en: weekdayNames('en') };

export function mediaTypeLabel(m: { mediaProductType: string; mediaType: string }, lang: 'tr' | 'en'): string {
  if (m.mediaProductType === 'REELS') return 'Reels';
  if (m.mediaProductType === 'STORY') return 'Story';
  if (m.mediaType === 'CAROUSEL_ALBUM') return 'Carousel';
  if (m.mediaType === 'VIDEO') return 'Video';
  return t('type_image', lang);
}

/** Deterministic placeholder gradient for posts without an archived thumbnail. */
export function thumbGradient(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  const b = (a + 40 + (h % 60)) % 360;
  return `linear-gradient(135deg, hsl(${a} 45% 38%), hsl(${b} 55% 28%))`;
}
