import { slaRows } from '../db/queries/inbox.js';
import { inboxSettings } from './settings.js';

/**
 * Response-time metrics. First-response time (FRT) = first owner reply − comment time, for top-level comments from
 * other people. Comments closed as done/ignored without a reply are excluded (slaRows).
 *   answeredPct  = answered / incoming
 *   withinSlaPct = answered within the target / eligible, where eligible = answered OR older than the target
 *                  (a fresh unanswered comment is not counted against the target yet)
 *   medianFrtMin / p90FrtMin (linear interpolation), backlog = open, unanswered and older than the target
 * Health score response component: 0.5 × answeredPct + 0.5 × withinSlaPct (plan decision, analytics/health.js).
 */
const MINUTE = 60_000;

/** Percentile with linear interpolation between closest ranks (p in 0..1); null for an empty list. */
export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Metrics for a list of slaRows. */
export function summarize(rows, { slaHours = 24, now = Date.now() } = {}) {
  const slaMin = slaHours * 60;
  const frt = rows.filter((r) => r.firstResponseAt != null).map((r) => Math.max(0, (r.firstResponseAt - r.createdAt) / MINUTE));
  const eligible = rows.filter((r) => r.firstResponseAt != null || (now - r.createdAt) / MINUTE >= slaMin).length;
  const within = frt.filter((m) => m <= slaMin).length;
  const backlog = rows.filter((r) => r.firstResponseAt == null && r.status === 'open' && (now - r.createdAt) / MINUTE > slaMin).length;
  return {
    incoming: rows.length,
    answered: frt.length,
    answeredPct: rows.length ? round1((frt.length / rows.length) * 100) : null,
    withinSlaPct: eligible ? round1((within / eligible) * 100) : null,
    medianFrtMin: round1(percentile(frt, 0.5)),
    p90FrtMin: round1(percentile(frt, 0.9)),
    backlog,
  };
}

/** Health "response" component (0–100) from summarize(): 50 % answered + 50 % within SLA. */
export function responseScore(s) {
  if (!s || s.answeredPct == null) return 0;
  const within = s.withinSlaPct ?? s.answeredPct;
  return 0.5 * s.answeredPct + 0.5 * within;
}

/** Groups rows by account (+ platform) and adds totals. → InboxSla */
export function computeSla(rows, { slaHours = 24, now = Date.now() } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.accountId}|${r.platform}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = [...groups.entries()].map(([key, list]) => {
    const [accountId, platform] = key.split('|');
    return { accountId, platform, ...summarize(list, { slaHours, now }) };
  }).sort((a, b) => b.backlog - a.backlog || b.incoming - a.incoming);
  return { slaHours, totals: summarize(rows, { slaHours, now }), rows: out };
}

/** inbox:sla — { from, to, accountIds?, platforms? } (YYYY-MM-DD) → InboxSla. */
export function inboxSla({ from, to, accountIds, platforms } = {}, { now = Date.now(), slaHours = inboxSettings().slaHours } = {}) {
  return computeSla(slaRows({ from, to, accountIds, platforms }), { slaHours, now });
}
