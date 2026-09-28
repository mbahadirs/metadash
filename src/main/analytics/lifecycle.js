import { snapshotsForAccount, snapshotsForMedia } from '../db/queries/media.js';
import { rangeMs, median, round } from './util.js';

export const AGE_BUCKETS = [1, 2, 4, 6, 12, 24, 36, 48, 72, 96, 120, 168, 336, 720];

function bucketOf(age) {
  return AGE_BUCKETS.find((b) => age <= b) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1];
}

/**
 * Builds age→metric curves from media_insight_snapshots.
 * Each media's series is normalised to its final value so posts of different sizes can be pooled.
 */
export function lifecycle({ igId, from, to, metric = 'reach' }) {
  const { fromMs, toMs } = rangeMs(from, to);
  const rows = snapshotsForAccount(igId, fromMs, toMs).filter((r) => r.metric === metric);
  return buildCurve(rows);
}

export function mediaLifecycle(mediaId) {
  const rows = snapshotsForMedia(mediaId);
  const byMetric = {};
  for (const r of rows) {
    byMetric[r.metric] = byMetric[r.metric] ?? [];
    byMetric[r.metric].push({ ageHours: r.ageHours, value: r.value, capturedAt: r.capturedAt });
  }
  return { series: byMetric, hoursTo80: round(hoursToShare(byMetric.reach ?? byMetric.total_interactions ?? [], 0.8), 1) };
}

function buildCurve(rows) {
  const byMedia = new Map();
  for (const r of rows) {
    const list = byMedia.get(r.mediaId) ?? [];
    byMedia.set(r.mediaId, [...list, r]);
  }
  const buckets = new Map(AGE_BUCKETS.map((b) => [b, []]));
  const hours80 = [];
  for (const series of byMedia.values()) {
    const sorted = [...series].sort((a, b) => a.ageHours - b.ageHours);
    const final = sorted[sorted.length - 1]?.value ?? 0;
    if (!final) continue;
    for (const p of sorted) buckets.get(bucketOf(p.ageHours)).push(p.value / final);
    const h = hoursToShare(sorted, 0.8);
    if (h != null) hours80.push(h);
  }
  const curve = AGE_BUCKETS.map((b) => ({ ageHours: b, ratio: round(median(buckets.get(b)) ?? null, 3), samples: buckets.get(b).length }))
    .filter((p) => p.samples > 0);
  return { curve, hoursTo80: round(median(hours80), 1), mediaCount: byMedia.size };
}

/** Hours until the metric reaches `share` of its final value (linear interpolation). */
export function hoursToShare(series, share) {
  if (!series.length) return null;
  const sorted = [...series].sort((a, b) => a.ageHours - b.ageHours);
  const final = sorted[sorted.length - 1].value;
  if (!final) return null;
  const target = final * share;
  let prev = { ageHours: 0, value: 0 };
  for (const p of sorted) {
    if (p.value >= target) {
      const span = p.value - prev.value;
      if (span <= 0) return p.ageHours;
      return prev.ageHours + ((target - prev.value) / span) * (p.ageHours - prev.ageHours);
    }
    prev = p;
  }
  return sorted[sorted.length - 1].ageHours;
}
