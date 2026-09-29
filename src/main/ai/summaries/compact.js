import { AiError } from '../errors.js';
import { fmtDate, toDate } from '../../analytics/util.js';
import { mediaTypeKey } from '../../db/queries/media.js';

const DIGITS = 2;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const CAPTION_MAX = 120;

/** Returns a copy without null/undefined/NaN/empty values and with numbers rounded to 2 decimals. */
export function compact(value) {
  return prune(value) ?? {};
}

function prune(v) {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10 ** DIGITS) / 10 ** DIGITS : undefined;
  if (Array.isArray(v)) {
    const arr = v.map(prune).filter((x) => x !== undefined);
    return arr.length ? arr : undefined;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v).map(([k, x]) => [k, prune(x)]).filter(([, x]) => x !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return v;
}

/** Single-line caption, truncated with an ellipsis. */
export function truncate(text, max = CAPTION_MAX) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export const typeKey = (p) => mediaTypeKey(p);

/**
 * Compact per-post metrics used by every summary. `platform` is included for Facebook/Threads posts (Instagram is the
 * default); Threads posts have no reach (views instead) and add reposts/quotes; Facebook posts add link clicks.
 */
export function postSummary(p, { withAccount = false } = {}) {
  const platform = p.platform ?? 'instagram';
  return {
    ...(withAccount ? { account: `@${p.username}` } : {}),
    ...(platform !== 'instagram' ? { platform } : {}),
    date: fmtDate(new Date(p.postedAt)),
    type: typeKey(p),
    caption: truncate(p.caption),
    reach: p.reach, views: p.views, likes: p.likes, comments: p.comments, saves: p.saved, shares: p.shares,
    reposts: p.reposts, quotes: p.quotes, linkClicks: p.clicks,
    erPct: p.engagementRate,
    adSpend: p.spend || undefined,
  };
}

export function assertDate(value, field) {
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(toDate(value).getTime())) throw new AiError('ai_bad_input', { vars: { field } });
  return value;
}

export function assertRange(from, to) {
  assertDate(from, 'from');
  assertDate(to, 'to');
  if (from > to) throw new AiError('ai_bad_input', { vars: { field: 'from > to' } });
  return { from, to };
}

export function assertIds(ids, field, max) {
  if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== 'string' || !x || x.length > 64)) throw new AiError('ai_bad_input', { vars: { field } });
  return max ? ids.slice(0, max) : ids;
}
