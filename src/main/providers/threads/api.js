/**
 * Threads API calls used by the Threads provider.
 *
 * Checked against developers.facebook.com/docs/threads on 2026-09-29.
 * CONFIRMED
 *  - Host: graph.threads.net and graph.threads.com are both accepted; references use graph.threads.net/v1.0
 *    (constant THREADS_HOST in ./client.js).
 *  - Authorize: https://threads.com/oauth/authorize?client_id&redirect_uri&scope&response_type=code[&state].
 *    redirect_uri must exactly match a URI in the app's OAuth settings. Codes are valid 1 hour, single use.
 *  - Code exchange: POST https://graph.threads.net/oauth/access_token (client_id, client_secret, code,
 *    grant_type=authorization_code, redirect_uri) → { access_token, user_id } (short-lived).
 *  - Long-lived: GET /access_token?grant_type=th_exchange_token&client_secret&access_token → { access_token,
 *    token_type, expires_in } valid 60 days; expired short-lived tokens cannot be exchanged.
 *  - Refresh: GET /refresh_access_token?grant_type=th_refresh_token&access_token → 60 days from the refresh; the
 *    token must be ≥24h old and not expired; a token not refreshed within 60 days expires for good.
 *  - GET /me fields: id, username, name, threads_profile_picture_url, threads_biography, is_verified.
 *  - GET /{user-id}/threads: since, until, limit; fields incl. id, media_product_type, media_type, media_url,
 *    permalink, text, timestamp, shortcode, thumbnail_url, children, is_quote_post. media_type ∈ TEXT_POST, IMAGE,
 *    VIDEO, CAROUSEL_ALBUM, AUDIO, REPOST_FACADE.
 *  - GET /{media-id}/insights metrics: views, likes, replies, reposts, quotes, shares (REPOST_FACADE → empty).
 *  - GET /{user-id}/threads_insights: views = time series; likes, replies, reposts, quotes, followers_count =
 *    total_value; clicks = link_total_values [{ value, link_url }]; follower_demographics = total_value with
 *    breakdown=country|city|age|gender (one per call, ≥100 followers). followers_count and follower_demographics
 *    ignore since/until. Earliest since = 1712991600 (2024-04-13); data only guaranteed from 2024-06-01.
 *  - Rate limit: 4800 × impressions calls per rolling 24h (+ CPU time limits); separate from the Meta Graph quota.
 * UNVERIFIED (code is tolerant)
 *  - Whether `https://localhost/` (or any non-public https URL) is accepted as a redirect URI; docs only require an
 *    exact match. The desktop flow therefore lets the user paste the code or the whole redirect URL.
 *  - Whether threads_insights/insights emit X-App-Usage headers (the limiter just observes them when present).
 *  - Exact follower_demographics JSON (assumed IG-style total_value.breakdowns[0].results[].dimension_values) and the
 *    error returned below 100 followers (any invalid-param/permission error skips that breakdown).
 *  - Whether th_exchange_token rejects an already long-lived token (e.g. from the dashboard token generator); if the
 *    exchange fails but /me works, the token is stored as-is with an assumed 60-day expiry.
 *  - Maximum since/until span for the views time series (MetaDash asks for ≤30 days).
 */
import { MetaError } from '../../meta/errors.js';
import { metricFromErrorMessage } from '../shared/metricNames.js';
import { candidatesFor } from '../shared/metricFallback.js';
import { threadsClient, THREADS_MIN_SINCE_UNIX } from './client.js';
import { MEDIA_METRICS, DAILY_SERIES_METRICS, DAILY_TOTAL_METRICS, DEMOGRAPHIC_BREAKDOWNS } from './metrics.js';
import { mapPost, insightValues, insightValue, mapDemographics } from './mappers.js';

const DAY_SECONDS = 86_400;
export const ME_FIELDS = 'id,username,name,threads_profile_picture_url,threads_biography';
export const THREAD_FIELDS = 'id,media_product_type,media_type,media_url,permalink,text,timestamp,thumbnail_url,shortcode,is_quote_post,children{media_url,thumbnail_url}';

/** canonical→api map minus metrics marked unsupported in metric_resolution. */
export function activeMetrics(scope, map) {
  return Object.fromEntries(Object.entries(map).filter(([canonical, api]) => candidatesFor('threads', scope, canonical, [api]).length));
}

/**
 * Which requested metric an invalid-parameter error is about. Handles Meta's
 * "metric[N] must be one of the following values: a, b, c" form (index first, then "not in the valid list") before
 * the generic name search, which would otherwise pick the first *valid* name the message lists.
 * @returns {string|null}
 */
export function rejectedMetric(message, names) {
  const text = String(message ?? '');
  const idx = /metric\[(\d+)\]/i.exec(text);
  if (idx && names[Number(idx[1])]) return names[Number(idx[1])];
  const valid = /one of the following values:\s*([a-z_,\s]+)/i.exec(text);
  if (valid) {
    const allowed = new Set(valid[1].split(/[\s,]+/).filter(Boolean));
    const bad = names.find((n) => !allowed.has(n));
    if (bad) return bad;
  }
  const found = metricFromErrorMessage(text, names);
  return found && names.includes(found) ? found : null;
}

/**
 * Calls `request(apiNames)`; on an invalid-parameter error that names one of the requested metrics, drops that metric
 * and retries. An invalid-parameter error that names no requested metric (e.g. deleted object) is rethrown unchanged
 * so the job logs it instead of disabling a healthy metric.
 * @returns {Promise<{ body: any, names: string[], droppedApi: {apiName:string, message:string}[] }>}
 */
export async function requestDropping(names, request, delay) {
  let left = [...names];
  const droppedApi = [];
  while (left.length) {
    try {
      return { body: await request(left), names: left, droppedApi };
    } catch (e) {
      if (!(e instanceof MetaError && e.isInvalidParam)) throw e;
      const bad = rejectedMetric(e.message, left);
      if (!bad) throw e;
      left = left.filter((n) => n !== bad);
      droppedApi.push({ apiName: bad, message: e.message });
      if (delay) await delay();
    }
  }
  return { body: null, names: [], droppedApi };
}

const invert = (map) => Object.fromEntries(Object.entries(map).map(([c, a]) => [a, c]));
const toDropped = (droppedApi, apiToCanonical) => droppedApi.map((d) => ({ metric: apiToCanonical[d.apiName] ?? d.apiName, message: d.message }));

export async function fetchMe(token, client = threadsClient) {
  return client.get('/me', { fields: ME_FIELDS }, { token });
}

/** followers_count (total_value; no since/until). Returns null when Threads rejects it. */
export async function fetchFollowersCount(userId, token, client = threadsClient) {
  try {
    const body = await client.get(`/${userId}/threads_insights`, { metric: 'followers_count' }, { token });
    const v = insightValue((body?.data ?? []).find((r) => r.name === 'followers_count'));
    return typeof v === 'number' ? v : null;
  } catch (e) {
    if (e instanceof MetaError && (e.isInvalidParam || e.isPermissionError)) return null;
    throw e;
  }
}

/** The user's own threads since `sinceUnix` (reposts removed). */
export async function fetchThreads(userId, token, { sinceUnix, max = 500 } = {}, client = threadsClient) {
  const items = await client.getAll(`/${userId}/threads`, { fields: THREAD_FIELDS, since: sinceUnix, limit: 50 }, { token, max });
  return items.map(mapPost).filter(Boolean);
}

/** Lifetime post insights with replies stored as comments. */
export async function fetchPostInsights(mediaId, token, client = threadsClient) {
  const map = activeMetrics('media', MEDIA_METRICS);
  const apiToCanonical = invert(map);
  const { body, droppedApi } = await requestDropping(
    Object.values(map),
    (names) => client.get(`/${mediaId}/insights`, { metric: names.join(',') }, { token }),
    client.delay,
  );
  const raw = insightValues(body);
  const values = Object.fromEntries(Object.entries(raw).map(([api, v]) => [apiToCanonical[api] ?? api, v]));
  return { values, dropped: toDropped(droppedApi, apiToCanonical) };
}

/** UTC-midnight aligned, clamped to the earliest date threads_insights accepts. */
export function clampSince(sinceUnix) {
  const aligned = Math.floor(sinceUnix / DAY_SECONDS) * DAY_SECONDS;
  return Math.max(aligned, THREADS_MIN_SINCE_UNIX);
}

const dateOf = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);

/**
 * Daily account insights: `views` as a time series in one call, then likes/replies/reposts/quotes/clicks one day at a
 * time (they only exist as totals) so account_insights_daily stays per-day. `since` is clamped to 2024-04-13.
 */
export async function fetchDailyInsights(userId, token, { sinceUnix, untilUnix }, client = threadsClient) {
  const since = clampSince(sinceUnix);
  const series = {};
  const dropped = [];
  if (since >= untilUnix) return { series, dropped };
  const push = (canonical, date, value) => {
    if (typeof value !== 'number') return;
    series[canonical] = [...(series[canonical] ?? []).filter((p) => p.date !== date), { date, value }];
  };
  const path = `/${userId}/threads_insights`;

  const seriesMap = activeMetrics('account', DAILY_SERIES_METRICS);
  const seriesCanon = invert(seriesMap);
  if (Object.keys(seriesMap).length) {
    const r = await requestDropping(Object.values(seriesMap), (names) => client.get(path, { metric: names.join(','), since, until: untilUnix }, { token }), client.delay);
    for (const row of r.body?.data ?? []) {
      for (const v of row.values ?? []) push(seriesCanon[row.name] ?? row.name, String(v.end_time).slice(0, 10), v.value);
    }
    dropped.push(...toDropped(r.droppedApi, seriesCanon));
    await client.delay();
  }

  const totalMap = activeMetrics('account', DAILY_TOTAL_METRICS);
  const totalCanon = invert(totalMap);
  let names = Object.values(totalMap);
  for (let day = since; day < untilUnix && names.length; day += DAY_SECONDS) {
    const r = await requestDropping(names, (n) => client.get(path, { metric: n.join(','), since: day, until: Math.min(day + DAY_SECONDS, untilUnix) }, { token }), client.delay);
    const values = insightValues(r.body);
    for (const [api, v] of Object.entries(values)) push(totalCanon[api] ?? api, dateOf(day), v);
    dropped.push(...toDropped(r.droppedApi, totalCanon));
    names = r.names;
    await client.delay();
  }
  return { series, dropped };
}

/**
 * follower_demographics, one breakdown per call. A breakdown Threads refuses (e.g. under 100 followers) is skipped,
 * not marked unsupported, so it is retried once the profile grows. Token/other errors are thrown.
 * @returns {Promise<{ dimensions: Record<string, {bucket:string, value:number}[]>, dropped: [], skipped: {dimension:string, message:string}[] }>}
 */
export async function fetchDemographics(userId, token, client = threadsClient) {
  const dimensions = {};
  const skipped = [];
  for (const breakdown of DEMOGRAPHIC_BREAKDOWNS) {
    try {
      const body = await client.get(`/${userId}/threads_insights`, { metric: 'follower_demographics', breakdown }, { token });
      const buckets = mapDemographics(body);
      if (buckets.length) dimensions[breakdown] = buckets;
    } catch (e) {
      if (!(e instanceof MetaError && (e.isInvalidParam || e.isPermissionError))) throw e;
      skipped.push({ dimension: breakdown, message: e.message });
    }
    await client.delay();
  }
  return { dimensions, dropped: [], skipped };
}
