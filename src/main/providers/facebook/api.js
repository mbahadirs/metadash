import { metaClient } from '../../meta/client.js';
import { MetaError } from '../../meta/errors.js';
import { fetchWithFallback } from '../shared/metricFallback.js';
import { metricFromErrorMessage } from '../shared/metricNames.js';
import { discoverMetaPages } from '../shared/metaPages.js';
import {
  DAILY_METRICS, POST_METRICS, PAGE_DISCOVERY_FIELDS, PAGE_PROFILE_FIELDS, POST_FIELDS, POST_COUNT_FIELDS, POSTS_PAGE_SIZE, POSTS_MAX,
} from './metrics.js';
import { mapDiscoveredPage, mapProfile, mapPost, parseDailyRows, parsePostInsightRows, inlineCounts } from './mappers.js';

/** Facebook Page Graph calls. Every Page endpoint except the token lookup uses the Page access token. */

/**
 * Wraps a multi-metric request so Meta's unnamed "(#100) The value must be a valid insights metric" can be pinned on
 * the right metric: the metrics are then requested one by one (results cached for the rest of this fetch) and the
 * first rejected one is re-thrown as a code-100 error that names it — metricFallback then advances exactly that chain.
 * @param {(names: string[]) => Promise<object[]>} fetchMany returns insights rows ({ name, ... })
 * @returns {(names: string[]) => Promise<object[]>}
 */
export function isolatingRequest(fetchMany) {
  const cache = new Map(); // api name → { rows } | { error }
  const fetchInto = async (names) => {
    const rows = await fetchMany(names);
    for (const n of names) cache.set(n, { rows: rows.filter((r) => r.name === n) });
  };
  return async (names) => {
    const missing = names.filter((n) => !cache.has(n));
    if (missing.length) {
      try {
        await fetchInto(missing);
      } catch (e) {
        if (!(e instanceof MetaError && e.isInvalidParam)) throw e;
        if (missing.length > 1 && metricFromErrorMessage(e.message, missing)) throw e; // named: let the fallback handle it
        for (const n of missing) {
          try {
            await fetchInto([n]);
          } catch (single) {
            if (!(single instanceof MetaError && single.isInvalidParam)) throw single;
            cache.set(n, { error: single });
          }
        }
      }
    }
    const bad = names.find((n) => cache.get(n)?.error);
    if (bad) {
      const { error } = cache.get(bad);
      throw new MetaError({ code: error.code, subcode: error.subcode, type: error.type, status: error.status, endpoint: error.endpoint, source: error.source, message: `${error.message} [metric: ${bad}]` });
    }
    return names.flatMap((n) => cache.get(n).rows);
  };
}

/** Page access token for one Page (null when Meta returns none — no role / no ANALYZE / not managed any more). */
export async function fetchPageToken(pageId, userToken, client = metaClient) {
  const body = await client.get(`/${pageId}`, { fields: 'id,name,access_token' }, { token: userToken });
  return { token: body?.access_token ?? null, name: body?.name ?? null };
}

export async function discoverPages(userToken, client = metaClient) {
  const { pages, businesses, warnings } = await discoverMetaPages({ token: userToken, fields: PAGE_DISCOVERY_FIELDS, client });
  return { items: pages.map(mapDiscoveredPage), businesses, warnings };
}

export async function fetchPageProfile(pageId, pageToken, client = metaClient) {
  return mapProfile(await client.get(`/${pageId}`, { fields: PAGE_PROFILE_FIELDS }, { token: pageToken }));
}

export async function fetchPagePosts(pageId, pageToken, { sinceUnix, max = POSTS_MAX } = {}, client = metaClient) {
  const params = { fields: POST_FIELDS, limit: POSTS_PAGE_SIZE, ...(sinceUnix ? { since: sinceUnix } : {}) };
  const items = await client.getAll(`/${pageId}/posts`, params, { token: pageToken, max });
  return items.slice(0, max).map(mapPost);
}

/**
 * Daily Page insights for [sinceUnix, untilUnix) with per-metric fallback (resolutions persisted in metric_resolution).
 * @returns {Promise<{ series: Record<string, {date:string, value:number}[]>, dropped: {metric:string, message:string}[] }>}
 */
export async function fetchPageInsightsDaily(pageId, pageToken, { sinceUnix, untilUnix }, client = metaClient) {
  const fetchMany = async (names) => {
    const body = await client.get(`/${pageId}/insights`, { metric: names.join(','), period: 'day', since: sinceUnix, until: untilUnix }, { token: pageToken });
    return body?.data ?? [];
  };
  const out = await fetchWithFallback({
    platform: 'facebook', scope: 'account', map: DAILY_METRICS, request: isolatingRequest(fetchMany), delay: client.delay,
  });
  return { series: parseDailyRows(out.result ?? [], out.apiToCanonical), dropped: out.dropped.map(({ metric, message }) => ({ metric, message })) };
}

/**
 * Lifetime insights + counts of one post in a single call (`fields=…,insights.metric(…)`), with per-metric fallback.
 * Without insights access (permission error) the counts are still returned and `onWarning` is called.
 * @returns {Promise<{ values: Record<string, number>, dropped: {metric:string, message:string}[] }>}
 */
export async function fetchPostInsights(postId, pageToken, { onWarning } = {}, client = metaClient) {
  let counts = null;
  const fetchMany = async (names) => {
    const body = await client.get(`/${postId}`, { fields: `${POST_COUNT_FIELDS},insights.metric(${names.join(',')})` }, { token: pageToken });
    counts = body;
    return body?.insights?.data ?? [];
  };
  let out = { result: null, apiToCanonical: {}, dropped: [] };
  try {
    out = await fetchWithFallback({ platform: 'facebook', scope: 'media', map: POST_METRICS, request: isolatingRequest(fetchMany), delay: client.delay });
  } catch (e) {
    if (!(e instanceof MetaError && e.isPermissionError)) throw e;
    onWarning?.(e);
  }
  if (!counts) counts = await client.get(`/${postId}`, { fields: POST_COUNT_FIELDS }, { token: pageToken });
  const values = { ...stripUndefined(inlineCounts(counts)), ...parsePostInsightRows(out.result ?? [], out.apiToCanonical) };
  return { values, dropped: out.dropped.map(({ metric, message }) => ({ metric, message })) };
}

const stripUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
