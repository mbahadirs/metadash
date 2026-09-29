import { bestTime } from '../analytics/besttime.js';
import { fmtDate, DAY_MS } from '../analytics/util.js';
import { listAccounts } from '../db/queries/accounts.js';
import { scheduledForAccounts } from '../db/queries/planner.js';
import { getConfig } from '../config/store.js';
import { invalid } from './input.js';

/**
 * Best-time slot suggestions (v1.4 plan §7). `nextSlots` and `scoreMatrix` are pure; `suggestSlots` gathers the
 * bestTime() matrices and existing scheduled posts from the DB. Hours are machine-local, like media.posted_hour.
 */
export const SHRINK_K = 3;
export const MIN_SOURCE_POSTS = 10;
export const MIN_LEAD_MS = 15 * 60_000;
export const HISTORY_DAYS = 180;
const HOUR_MS = 3_600_000;
const MAX_COUNT = 24;
const MAX_DAYS = 60;
const MAX_ACCOUNTS = 50;

/**
 * Generic engagement prior (0–1) used when there is no usable history: weekday commute/lunch/evening peaks, later
 * and flatter weekends, near zero overnight. Index [weekday 0=Sun][hour].
 */
export const DEFAULT_GRID = Object.freeze(Array.from({ length: 7 }, (_, weekday) => Object.freeze(Array.from({ length: 24 }, (__, hour) => {
  const weekend = weekday === 0 || weekday === 6;
  if (hour < 7 || hour >= 23) return 0.1;
  const peaks = weekend ? { 10: 0.8, 11: 0.85, 12: 0.8, 19: 0.8, 20: 0.85 } : { 8: 0.7, 9: 0.75, 12: 0.85, 13: 0.8, 18: 0.85, 19: 0.95, 20: 0.9 };
  return peaks[hour] ?? (weekend ? 0.55 : 0.6);
}))));

const cellsOf = (m) => (Array.isArray(m?.matrix) && m.matrix.length === 7 ? m.matrix : null);

function totals(matrix) {
  let sum = 0;
  let count = 0;
  for (const row of matrix) for (const c of row) if (c.count && c.value != null) { sum += c.value * c.count; count += c.count; }
  return { sum, count };
}

/** Per-cell scores: qualified cells keep their average ER, thin cells are shrunk toward the matrix mean. */
export function scoreMatrix(result) {
  const matrix = cellsOf(result);
  if (!matrix) return null;
  const { sum, count } = totals(matrix);
  const prior = count ? sum / count : 0;
  const cells = matrix.map((row) => row.map((c) => {
    const n = c.value != null ? c.count : 0;
    const score = c.qualified && n ? c.value : (c.value != null ? c.value * n : 0) / (n + SHRINK_K) + (prior * SHRINK_K) / (n + SHRINK_K);
    return { score, avgEr: c.value ?? null, posts: c.count ?? 0, qualified: !!c.qualified && n > 0 };
  }));
  return { cells, prior, posts: count };
}

function pickSource(sources = {}) {
  for (const name of ['account', 'portfolio']) {
    const scored = scoreMatrix(sources[name]);
    if (scored && scored.posts >= MIN_SOURCE_POSTS) return { name, scored };
  }
  const cells = DEFAULT_GRID.map((row) => row.map((score) => ({ score, avgEr: null, posts: 0, qualified: false })));
  return { name: 'default', scored: { cells, prior: 0, posts: 0 } };
}

/** Local full hours in [start, end), stepping with setHours so DST days keep their wall-clock hours. */
function hourGrid(startMs, endMs) {
  const d = new Date(startMs);
  if (d.getMinutes() || d.getSeconds() || d.getMilliseconds()) d.setHours(d.getHours() + 1, 0, 0, 0);
  const out = [];
  while (d.getTime() < endMs && out.length < MAX_DAYS * 24 + 2) {
    out.push(d.getTime());
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return out;
}

/**
 * @param {{ accountIds: string[], fromMs: number, now: number, days?: number, count?: number, minGapHours?: number,
 *   existing?: { postId, ref, accountId, scheduledAt }[], sources: { account?: object|null, portfolio?: object|null } }} p
 * @returns {import('../../renderer/lib/types').Slot[]} best first
 */
export function nextSlots({ accountIds = [], fromMs, now, days = 7, count = 3, minGapHours = 3, existing = [], sources = {} }) {
  const n = Math.max(0, Math.min(MAX_COUNT, Math.floor(count)));
  if (!n) return [];
  const { name, scored } = pickSource(sources);
  const gapMs = Math.max(0, Number(minGapHours) || 0) * HOUR_MS;
  const spacingMs = Math.max(gapMs, HOUR_MS);
  const start = Math.max(fromMs ?? now, now + MIN_LEAD_MS);
  const end = (fromMs ?? now) + Math.min(MAX_DAYS, Math.max(0, days)) * DAY_MS;
  const ids = new Set(accountIds.map(String));
  const mine = existing.filter((e) => ids.has(String(e.accountId)) && e.scheduledAt != null);

  const candidates = hourGrid(start, end).map((at) => {
    const d = new Date(at);
    const weekday = d.getDay();
    const hour = d.getHours();
    const cell = scored.cells[weekday][hour];
    const conflicts = gapMs ? mine.filter((e) => Math.abs(e.scheduledAt - at) < gapMs) : [];
    return { at, weekday, hour, score: Math.round(cell.score * 10_000) / 10_000, avgEr: cell.avgEr, posts: cell.posts, qualified: cell.qualified, source: name, conflicts, tie: DEFAULT_GRID[weekday][hour] };
  });
  const rank = (a, b) => b.score - a.score || b.tie - a.tie || a.at - b.at;
  const chosen = [];
  const take = (pool) => {
    for (const c of [...pool].sort(rank)) {
      if (chosen.length >= n) return;
      if (chosen.some((s) => Math.abs(s.at - c.at) < spacingMs)) continue;
      chosen.push(c);
    }
  };
  take(candidates.filter((c) => !c.conflicts.length));
  if (chosen.length < n) take(candidates.filter((c) => c.conflicts.length));
  return chosen.sort(rank).map(({ tie, ...slot }) => slot); // eslint-disable-line no-unused-vars
}

const cleanIds = (ids) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_ACCOUNTS || ids.some((x) => typeof x !== 'string' || !x || x.length > 64)) throw invalid('accountIds');
  return [...new Set(ids)];
};
const clampNum = (v, min, max, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(max, Math.max(min, Number(v))) : fallback);

/**
 * planner:suggestSlots — { accountIds, from?, days?, count? } → Slot[] from the last 180 days of synced posts.
 * The portfolio fallback pools every tracked account on the same platforms.
 */
export function suggestSlots(p = {}, { now = Date.now() } = {}) {
  const accountIds = cleanIds(p?.accountIds);
  const fromMs = clampNum(p.from, now - DAY_MS, now + 365 * DAY_MS, now);
  const days = clampNum(p.days, 1, MAX_DAYS, 7);
  const count = clampNum(p.count, 1, MAX_COUNT, 3);
  const minGapHours = clampNum(getConfig('planner.minGapHours'), 0, 72, 3);
  const range = { from: fmtDate(new Date(now - HISTORY_DAYS * DAY_MS)), to: fmtDate(new Date(now)) };
  const account = bestTime({ igIds: accountIds, ...range, minPosts: 3 });
  const tracked = listAccounts({ onlyTracked: true });
  const platforms = new Set(tracked.filter((a) => accountIds.includes(a.igId)).map((a) => a.platform));
  const peers = tracked.filter((a) => platforms.has(a.platform)).map((a) => a.igId);
  const portfolio = peers.length > accountIds.length ? bestTime({ igIds: peers, ...range, minPosts: 3 }) : null;
  const gapMs = minGapHours * HOUR_MS;
  const existing = scheduledForAccounts({ accountIds, from: fromMs - gapMs, to: fromMs + days * DAY_MS + gapMs });
  return nextSlots({ accountIds, fromMs, now, days, count, minGapHours, existing, sources: { account, portfolio } });
}
