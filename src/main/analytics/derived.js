import { q } from '../db/index.js';
import { upsertInsightDaily } from '../db/queries/accounts.js';
import { fmtDate } from './util.js';

/**
 * Derived daily series for platforms without native daily insights (capabilities.dailySeries === 'derived', e.g.
 * TikTok Display API). Estimates from what every sync already stores:
 *  - follower_count (new followers per day) = followers(day) − followers(previous snapshot day), from account_snapshots
 *  - views per day = Σ over the account's posts of the growth of the post's cumulative `views` between the last capture
 *    of the previous day and the last capture of that day (media_insight_snapshots). A post's first capture only counts
 *    when it was published at most FIRST_CAPTURE_MAX_AGE_H before (otherwise its whole history would land on one day).
 * Accuracy depends on sync frequency; the UI labels these "estimated from syncs".
 * Pure SQL reads + upserts into account_insights_daily; never used for platforms with native series.
 */
const HOUR = 3_600_000;
const FIRST_CAPTURE_MAX_AGE_H = 48;

/** [{ date, value }] new followers per snapshot day (first snapshot has no predecessor and is skipped). */
export function derivedFollowerSeries(igId) {
  const rows = q.all('SELECT date, followers FROM account_snapshots WHERE ig_id = ? AND followers IS NOT NULL ORDER BY date', igId);
  const out = [];
  for (let i = 1; i < rows.length; i += 1) out.push({ date: rows[i].date, value: rows[i].followers - rows[i - 1].followers });
  return out;
}

/** [{ date, value }] estimated views per day across the account's posts. */
export function derivedViewsSeries(igId, { metric = 'views' } = {}) {
  const rows = q.all(
    `SELECT s.media_id, s.captured_at, s.value, m.posted_at FROM media_insight_snapshots s JOIN media m ON m.media_id = s.media_id
     WHERE m.ig_id = ? AND s.metric = ? ORDER BY s.media_id, s.captured_at`,
    igId, metric,
  );
  const perDay = new Map();
  let current = null;
  let lastByDay = new Map();
  const flush = () => {
    if (!current) return;
    const days = [...lastByDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    let prev = null;
    for (const [date, r] of days) {
      let delta = null;
      if (prev) delta = r.value - prev.value;
      else if (r.captured_at - (r.posted_at ?? 0) <= FIRST_CAPTURE_MAX_AGE_H * HOUR) delta = r.value;
      if (delta != null && delta > 0) perDay.set(date, (perDay.get(date) ?? 0) + delta);
      prev = r;
    }
  };
  for (const r of rows) {
    if (r.media_id !== current) { flush(); current = r.media_id; lastByDay = new Map(); }
    lastByDay.set(fmtDate(new Date(r.captured_at)), r); // rows are ordered by captured_at → last capture of the day wins
  }
  flush();
  return [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

/** Recomputes and upserts both derived series for an account; returns the number of points written. */
export function materializeDerivedSeries(igId) {
  let n = 0;
  q.tx(() => {
    for (const p of derivedFollowerSeries(igId)) { upsertInsightDaily(igId, p.date, 'follower_count', p.value); n += 1; }
    for (const p of derivedViewsSeries(igId)) { upsertInsightDaily(igId, p.date, 'views', p.value); n += 1; }
  })();
  return n;
}
