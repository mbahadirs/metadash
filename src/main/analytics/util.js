import { differenceInCalendarDays, format, parseISO, subDays, addDays } from 'date-fns';

export const DAY_MS = 86_400_000;

export function toDate(str) {
  return str.length > 10 ? new Date(str) : parseISO(str);
}

export function fmtDate(d) {
  return format(d, 'yyyy-MM-dd');
}

/** Converts YYYY-MM-DD range to inclusive ms range (local time). */
export function rangeMs(from, to) {
  const start = toDate(from).getTime();
  const end = toDate(to).getTime() + DAY_MS - 1;
  return { fromMs: start, toMs: end };
}

/** Previous period of equal length ending the day before `from`. */
export function previousPeriod(from, to) {
  const days = differenceInCalendarDays(toDate(to), toDate(from)) + 1;
  const prevTo = subDays(toDate(from), 1);
  const prevFrom = subDays(prevTo, days - 1);
  return { from: fmtDate(prevFrom), to: fmtDate(prevTo), days };
}

export function periodDays(from, to) {
  return differenceInCalendarDays(toDate(to), toDate(from)) + 1;
}

export function pctChange(current, previous) {
  if (previous == null || previous === 0) return current ? null : 0;
  if (current == null) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function mean(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function stddev(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export function median(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Percentile rank (0-100) of value within population. */
export function percentileRank(value, population) {
  const pop = population.filter((x) => x != null && Number.isFinite(x));
  if (value == null || !pop.length) return 50;
  const below = pop.filter((x) => x < value).length;
  const equal = pop.filter((x) => x === value).length;
  return ((below + equal * 0.5) / pop.length) * 100;
}

export function eachDay(from, to) {
  const out = [];
  let d = toDate(from);
  const end = toDate(to);
  while (d <= end) {
    out.push(fmtDate(d));
    d = addDays(d, 1);
  }
  return out;
}

export function round(n, digits = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
