/**
 * Per-client rate limiting (token bucket) plus an authentication-failure lockout.
 *   take(key)      → true when the request may proceed (bucket of `capacity`, refilled `perMinute` per minute)
 *   fail(key)      → counts an authentication failure; `maxFailures` within `failWindowMs` blocks the key for `blockMs`
 *   blocked(key)   → true while the key is locked out
 * Keys are client IPs (behind a reverse proxy: the proxy's address unless MD_TRUST_PROXY=1, see server.js).
 */
const MAX_KEYS = 10_000;

export function createRateLimiter({ capacity = 120, perMinute = 120, maxFailures = 20, failWindowMs = 600_000, blockMs = 900_000, now = Date.now } = {}) {
  const buckets = new Map();
  const failures = new Map();

  const trim = (map) => { if (map.size > MAX_KEYS) for (const k of [...map.keys()].slice(0, map.size - MAX_KEYS)) map.delete(k); };

  function take(key, cost = 1) {
    const t = now();
    const b = buckets.get(key) ?? { tokens: capacity, at: t };
    const tokens = Math.min(capacity, b.tokens + (Math.max(0, t - b.at) / 60_000) * perMinute); // clock going back never drains
    const ok = tokens >= cost;
    buckets.set(key, { tokens: ok ? tokens - cost : tokens, at: t });
    trim(buckets);
    return ok;
  }

  function blocked(key) {
    const f = failures.get(key);
    return !!f?.blockedUntil && f.blockedUntil > now();
  }

  function fail(key) {
    const t = now();
    const f = failures.get(key);
    const fresh = !f || t - f.since > failWindowMs;
    const next = fresh ? { count: 1, since: t, blockedUntil: null } : { ...f, count: f.count + 1 };
    if (next.count >= maxFailures) next.blockedUntil = t + blockMs;
    failures.set(key, next);
    trim(failures);
  }

  return { take, fail, blocked };
}
