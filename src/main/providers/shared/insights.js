import { MetaError } from '../../meta/errors.js';
import { metricFromErrorMessage } from './metricNames.js';

export const DAY_SECONDS = 86_400;

const identity = (name) => name;

/**
 * Daily account insights over any Graph-style `/insights` edge (Instagram user, Facebook Page, Threads user).
 *
 * 1. `metrics` are requested together as a time series (`seriesParams`, default `metric_type=time_series`).
 *    A metric rejected with an invalid-parameter error (code 100) is removed; if the message mentions `total_value`
 *    it is moved to the per-day pass, otherwise it is reported in `dropped`.
 * 2. Per-day pass: `totalOnly` metrics (given up front and/or discovered in step 1) are fetched one day at a time
 *    with `totalParams` (default `metric_type=total_value`) so the stored series stays daily.
 * Unsupported metrics are dropped, never the whole request; any other error is thrown.
 *
 * @param {{ get: Function, delay: () => Promise<void> }} client  Graph client (see meta/client.js createGraphClient)
 * @param {string} path          e.g. `/${igId}/insights`
 * @param {string[]} metrics     metrics to request as a time series
 * @param {object} opts
 * @param {number} opts.sinceUnix
 * @param {number} opts.untilUnix
 * @param {string} [opts.token]
 * @param {boolean} [opts.timeSeries=true]   false = skip step 1 and fetch every metric per day
 * @param {string[]} [opts.totalOnly=[]]     metrics known to be total_value-only
 * @param {object} [opts.seriesParams]       extra params for the time-series call
 * @param {object} [opts.totalParams]        extra params for the per-day call
 * @param {(name:string)=>string} [opts.normalize] maps API metric names to stored names
 * @returns {Promise<{ series: Record<string, {date:string, value:number}[]>, dropped: {metric:string, message:string}[] }>}
 */
export async function fetchInsightsDaily(client, path, metrics, {
  sinceUnix, untilUnix, token, timeSeries = true, totalOnly: initialTotalOnly = [],
  seriesParams = { metric_type: 'time_series' }, totalParams = { metric_type: 'total_value' }, normalize = identity,
} = {}) {
  let series = timeSeries ? [...metrics] : [];
  let totalOnly = timeSeries ? [...initialTotalOnly] : [...metrics, ...initialTotalOnly];
  const dropped = [];
  const out = {};
  const push = (name, date, value) => {
    if (typeof value !== 'number') return;
    out[name] = [...(out[name] ?? []), { date, value }];
  };

  for (let attempt = 0; attempt < 6 && series.length; attempt += 1) {
    try {
      const body = await client.get(path, {
        metric: series.join(','), period: 'day', since: sinceUnix, until: untilUnix, ...seriesParams,
      }, { token });
      for (const row of body.data ?? []) {
        const name = normalize(row.name);
        for (const v of row.values ?? []) push(name, String(v.end_time).slice(0, 10), v.value);
      }
      break;
    } catch (e) {
      if (!(e instanceof MetaError && e.isInvalidParam)) throw e;
      const bad = metricFromErrorMessage(e.message, series) ?? series[series.length - 1];
      series = series.filter((m) => m !== bad);
      if (/total_value/i.test(e.message)) totalOnly = [...totalOnly, bad];
      else dropped.push({ metric: bad, message: e.message });
      await client.delay();
    }
  }

  for (let day = sinceUnix; day < untilUnix && totalOnly.length; day += DAY_SECONDS) {
    const date = new Date(day * 1000).toISOString().slice(0, 10);
    for (let attempt = 0; attempt < 4 && totalOnly.length; attempt += 1) {
      try {
        const body = await client.get(path, {
          metric: totalOnly.join(','), period: 'day', since: day, until: Math.min(day + DAY_SECONDS, untilUnix), ...totalParams,
        }, { token });
        for (const row of body.data ?? []) push(normalize(row.name), date, row.total_value?.value ?? row.values?.[0]?.value);
        break;
      } catch (e) {
        if (!(e instanceof MetaError && e.isInvalidParam)) throw e;
        const bad = metricFromErrorMessage(e.message, totalOnly) ?? totalOnly[totalOnly.length - 1];
        totalOnly = totalOnly.filter((m) => m !== bad);
        dropped.push({ metric: bad, message: e.message });
      }
    }
    await client.delay();
  }
  return { series: out, dropped };
}
