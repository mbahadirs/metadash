import { MetaError } from '../../meta/errors.js';
import { getMetricResolution, resolveMetric, markUnsupported } from '../../db/queries/sync.js';
import { metricFromErrorMessage } from './metricNames.js';

/**
 * Metric fallback chains for platforms whose metric names churn (Facebook Pages, Threads).
 *
 * A *map* is { canonical: [apiCandidate1, apiCandidate2, ...] }. The first candidate is tried first; when Meta rejects
 * a name with an invalid-parameter error (code 100) the next candidate is tried. The winner is persisted in
 * metric_resolution (status 'ok') so later syncs request only the resolved name; when every candidate fails the
 * canonical metric is marked 'unsupported' and skipped from then on (until re-enabled in Settings).
 */

/**
 * Candidate API names for one canonical metric, honouring stored resolutions.
 * @returns {string[]} [] when the metric is known to be unsupported
 */
export function candidatesFor(platform, scope, canonical, candidates) {
  const res = getMetricResolution(platform, scope, canonical);
  if (res?.status === 'unsupported') return [];
  if (res?.status === 'ok' && res.apiName) {
    return [res.apiName, ...candidates.filter((c) => c !== res.apiName)];
  }
  return [...candidates];
}

/**
 * Requests every canonical metric of `map` through `request`, falling back per metric on invalid-parameter errors.
 *
 * @param {object} opts
 * @param {'facebook'|'threads'|string} opts.platform
 * @param {string} opts.scope                     e.g. 'account' | 'media'
 * @param {Record<string, string[]>} opts.map     canonical → API candidates
 * @param {(apiNames: string[]) => Promise<any>} opts.request  performs the API call for the given names (throws MetaError)
 * @param {() => Promise<void>} [opts.delay]      called between retries
 * @param {boolean} [opts.persist=true]           write metric_resolution rows
 * @param {number} [opts.maxAttempts]             safety cap (default: total candidates + 1)
 * @returns {Promise<{ result: any, apiToCanonical: Record<string,string>, resolved: Record<string,string>,
 *   dropped: { metric: string, apiName: string|null, message: string }[] }>}
 *   `result` is whatever the last successful `request` returned (null when nothing could be requested);
 *   `dropped` lists canonical metrics that became unsupported in this call (metric = canonical name).
 */
export async function fetchWithFallback({ platform, scope, map, request, delay, persist = true, maxAttempts }) {
  const chains = {};
  for (const [canonical, candidates] of Object.entries(map)) {
    const list = candidatesFor(platform, scope, canonical, candidates);
    if (list.length) chains[canonical] = list;
  }
  const dropped = [];
  const cap = maxAttempts ?? Object.values(chains).reduce((n, c) => n + c.length, 0) + 1;

  for (let attempt = 0; attempt < cap && Object.keys(chains).length; attempt += 1) {
    const apiToCanonical = Object.fromEntries(Object.entries(chains).map(([canonical, list]) => [list[0], canonical]));
    const apiNames = Object.keys(apiToCanonical);
    try {
      const result = await request(apiNames);
      const resolved = Object.fromEntries(Object.entries(apiToCanonical).map(([api, canonical]) => [canonical, api]));
      if (persist) for (const [canonical, api] of Object.entries(resolved)) resolveMetric(platform, scope, canonical, api);
      return { result, apiToCanonical, resolved, dropped };
    } catch (e) {
      if (!(e instanceof MetaError && e.isInvalidParam)) throw e;
      const bad = metricFromErrorMessage(e.message, apiNames) ?? apiNames[apiNames.length - 1];
      const canonical = apiToCanonical[bad];
      if (!canonical) throw e;
      const rest = chains[canonical].slice(1);
      if (rest.length) {
        chains[canonical] = rest;
      } else {
        delete chains[canonical];
        dropped.push({ metric: canonical, apiName: bad, message: e.message });
        if (persist) markUnsupported(platform, scope, canonical, e.message);
      }
      if (delay) await delay();
    }
  }
  return { result: null, apiToCanonical: {}, resolved: {}, dropped };
}

/** Renames keys of `values` from API names to canonical names (unknown keys are kept as-is). */
export function toCanonical(values, apiToCanonical) {
  return Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [apiToCanonical[k] ?? k, v]));
}
