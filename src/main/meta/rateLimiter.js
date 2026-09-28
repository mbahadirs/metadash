/**
 * Tracks Meta usage headers and derives a delay multiplier for the queues.
 * Usage above 80% doubles the base delay; above 95% quadruples it.
 */
export class RateLimiter {
  constructor({ baseDelayMs = 250 } = {}) {
    this.baseDelayMs = baseDelayMs;
    this.appUsage = { call_count: 0, total_time: 0, total_cputime: 0 };
    this.bucUsage = {};
    this.updatedAt = 0;
  }

  /** Reads X-App-Usage / X-Business-Use-Case-Usage from response headers. */
  observe(headers) {
    const app = safeJson(headers.get?.('x-app-usage') ?? headers['x-app-usage']);
    if (app) this.appUsage = { ...this.appUsage, ...app };
    const buc = safeJson(headers.get?.('x-business-use-case-usage') ?? headers['x-business-use-case-usage']);
    if (buc) this.bucUsage = buc;
    this.updatedAt = Date.now();
  }

  maxUsagePct() {
    let max = Math.max(this.appUsage.call_count ?? 0, this.appUsage.total_time ?? 0, this.appUsage.total_cputime ?? 0);
    for (const entries of Object.values(this.bucUsage)) {
      for (const e of Array.isArray(entries) ? entries : []) {
        max = Math.max(max, e.call_count ?? 0, e.total_time ?? 0, e.total_cputime ?? 0);
      }
    }
    return max;
  }

  multiplier() {
    const pct = this.maxUsagePct();
    if (pct >= 95) return 4;
    if (pct >= 80) return 2;
    return 1;
  }

  currentDelayMs() {
    return this.baseDelayMs * this.multiplier();
  }

  snapshot() {
    return { usagePct: this.maxUsagePct(), multiplier: this.multiplier(), updatedAt: this.updatedAt };
  }
}

function safeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export const rateLimiter = new RateLimiter({ baseDelayMs: Number(process.env.METADASH_GRAPH_DELAY_MS ?? 250) });
