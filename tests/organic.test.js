import { describe, it, expect, vi } from 'vitest';
import { MetaError } from '../src/main/meta/errors.js';

const calls = [];
vi.mock('../src/main/meta/client.js', () => ({
  graphGet: vi.fn(async (path, params) => {
    calls.push(params);
    const metrics = params.metric.split(',');
    if (params.metric_type === 'time_series' && metrics.includes('profile_views')) {
      throw new MetaError({ code: 100, message: '(#100) The metric profile_views must be requested with metric_type=total_value' });
    }
    if (params.metric_type === 'time_series' && metrics.includes('bogus')) {
      throw new MetaError({ code: 100, message: 'metric bogus is not supported' });
    }
    if (params.metric_type === 'time_series') {
      return { data: metrics.map((m) => ({ name: m, values: [{ end_time: '2026-09-01T07:00:00+0000', value: 10 }, { end_time: '2026-09-02T07:00:00+0000', value: 12 }] })) };
    }
    return { data: metrics.map((m) => ({ name: m, total_value: { value: 5 } })) };
  }),
  graphGetAll: vi.fn(),
  graphDelay: vi.fn(async () => {}),
}));

const { fetchAccountInsightsDaily } = await import('../src/main/meta/organic.js');

describe('fetchAccountInsightsDaily', () => {
  it('keeps time-series metrics daily, fetches total_value-only metrics per day and drops unsupported ones', async () => {
    const since = Math.floor(Date.UTC(2026, 8, 1) / 1000);
    const until = since + 2 * 86_400;
    const { series, dropped } = await fetchAccountInsightsDaily('1', 't', { sinceUnix: since, untilUnix: until, overrides: { account: { daily: ['reach', 'profile_views', 'bogus'] } } });
    expect(series.reach).toEqual([{ date: '2026-09-01', value: 10 }, { date: '2026-09-02', value: 12 }]);
    expect(series.profile_views).toEqual([{ date: '2026-09-01', value: 5 }, { date: '2026-09-02', value: 5 }]);
    expect(dropped.map((d) => d.metric)).toEqual(['bogus']);
    expect(calls.filter((c) => c.metric_type === 'total_value')).toHaveLength(2);
  });
});
