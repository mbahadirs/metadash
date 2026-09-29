/**
 * A/B caption tests (v1.5): pure analysis. Instagram has no true split test for feed captions, so a "test" tags
 * separate posts to arms (variant tagging across posts) and compares each post's lift against its account's type
 * benchmark (the 90 days before the post, same media type, like contentAnalysis.recent). Lift = value / benchmark
 * (1 = on par). Each arm gets n, mean, median and a seeded bootstrap 90% CI of the mean.
 * Verdict: 'need_more' (any arm n < 3) → 'directional' (the best arm's CI does not overlap the others') → 'inconclusive'.
 */
export const AB_METRICS = ['reach_lift', 'er', 'save_rate', 'views_lift'];
export const AB_VARIABLES = ['caption_hook', 'length', 'emoji', 'cta', 'hashtags', 'other'];
export const MIN_ARM_N = 3;
export const MIN_AGE_HOURS = 72;
export const BENCH_MIN_POSTS = 3;
const HOUR = 3_600_000;
const DEFAULT_ITERATIONS = 2000;

/** Deterministic PRNG (mulberry32) so bootstrap CIs are reproducible and testable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const quantile = (sorted, p) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/** Bootstrap distribution of the mean (sorted). */
function bootstrapMeans(xs, rng, iterations) {
  const out = new Array(iterations);
  for (let b = 0; b < iterations; b++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rng() * xs.length)];
    out[b] = s / xs.length;
  }
  return out.sort((a, b) => a - b);
}

/** Metric value and benchmark for one post. Threads has no reach: reach_lift uses views there. */
export function metricPair(obs, metric) {
  const b = obs.bench ?? {};
  const threads = obs.platform === 'threads';
  switch (metric) {
    case 'er': return [obs.engagementRate, b.engagementRate];
    case 'save_rate': return [obs.reach > 0 && obs.saved != null ? (obs.saved * 100) / obs.reach : null, b.saveRate];
    case 'views_lift': return [obs.views, b.views];
    case 'reach_lift':
    default: return threads ? [obs.views, b.views] : [obs.reach, b.reach];
  }
}

/**
 * Lift of one post, or { excluded: reason }: pending (not synced yet), too_young (< minAgeHours), no_benchmark
 * (< 3 comparable posts), no_metric.
 */
export function liftFor(obs, metric, { now, minAgeHours = MIN_AGE_HOURS } = {}) {
  if (!obs.synced || !Number.isFinite(obs.postedAt)) return { excluded: 'pending' };
  if (now - obs.postedAt < minAgeHours * HOUR) return { excluded: 'too_young' };
  if (!obs.bench || (obs.bench.posts ?? 0) < BENCH_MIN_POSTS) return { excluded: 'no_benchmark' };
  const [v, bv] = metricPair(obs, metric);
  if (!Number.isFinite(v) || !Number.isFinite(bv) || bv <= 0) return { excluded: 'no_metric' };
  return { lift: v / bv };
}

const round = (v, d = 3) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

export function armStats(lifts, { rng, iterations = DEFAULT_ITERATIONS } = {}) {
  if (!lifts.length) return { n: 0, mean: null, median: null, ci: null, boot: null };
  const boot = lifts.length > 1 ? bootstrapMeans(lifts, rng, iterations) : null;
  return {
    n: lifts.length,
    mean: mean(lifts),
    median: median(lifts),
    ci: boot ? [quantile(boot, 0.05), quantile(boot, 0.95)] : null,
    boot,
  };
}

const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];

/** Verdict over arms with stats; returns { verdict, winner, probBest }. */
export function verdictFor(arms, { minN = MIN_ARM_N } = {}) {
  if (arms.length < 2 || arms.some((a) => a.n < minN)) return { verdict: 'need_more', winner: null, probBest: null };
  const best = [...arms].sort((a, b) => b.mean - a.mean)[0];
  const others = arms.filter((a) => a !== best);
  // Probability the best arm's bootstrap mean beats each other arm's (paired by iteration index of shuffled draws).
  let probBest = null;
  if (best.boot && others.every((o) => o.boot)) {
    const iters = best.boot.length;
    let wins = 0;
    const rng = mulberry32(7);
    for (let i = 0; i < iters; i++) {
      const bv = best.boot[Math.floor(rng() * iters)];
      if (others.every((o) => bv > o.boot[Math.floor(rng() * o.boot.length)])) wins += 1;
    }
    probBest = wins / iters;
  }
  const separated = best.ci && others.every((o) => o.ci && !overlaps(best.ci, o.ci));
  return { verdict: separated ? 'directional' : 'inconclusive', winner: separated ? best.arm : null, probBest };
}

/**
 * observations: [{ arm, mediaKey, platform, postedAt, synced, reach, views, engagementRate, saved, bench }]
 * → { metric, arms:[{arm, n, mean, median, ci, posts:[{mediaKey, lift|excluded}], excluded}], verdict, winner, probBest }
 */
export function analyzeAbTest({ metric = 'reach_lift', arms: armNames, observations = [], now = Date.now(), minAgeHours = MIN_AGE_HOURS, seed = 42, iterations = DEFAULT_ITERATIONS }) {
  const names = [...new Set([...(armNames ?? []), ...observations.map((o) => o.arm)])].sort();
  const rng = mulberry32(seed);
  const arms = names.map((arm) => {
    const posts = observations.filter((o) => o.arm === arm).map((o) => ({ mediaKey: o.mediaKey, targetId: o.targetId ?? null, platform: o.platform ?? null, postedAt: o.postedAt ?? null, ...liftFor(o, metric, { now, minAgeHours }) }));
    const lifts = posts.filter((p) => p.lift != null).map((p) => p.lift);
    return { arm, ...armStats(lifts, { rng, iterations }), posts, excluded: posts.filter((p) => p.excluded).length };
  });
  const v = verdictFor(arms);
  return {
    metric,
    arms: arms.map(({ boot, ...a }) => ({
      ...a, mean: round(a.mean), median: round(a.median), ci: a.ci ? a.ci.map((x) => round(x)) : null,
      posts: a.posts.map((p) => ({ ...p, lift: round(p.lift) })),
    })),
    verdict: v.verdict, winner: v.winner, probBest: round(v.probBest, 2), minN: MIN_ARM_N, minAgeHours,
  };
}
