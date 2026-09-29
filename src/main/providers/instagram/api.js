import { graphGet, graphGetAll, graphDelay } from '../../meta/client.js';
import { MetaError } from '../../meta/errors.js';
import { mediaMetricsFor, accountMetricsFor, metricFromErrorMessage, normalizeMetricName } from './metrics.js';
import { fetchInsightsDaily } from '../shared/insights.js';
import { discoverMetaPages } from '../shared/metaPages.js';

const IG_FIELDS = 'id,username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website';

const PAGE_FIELDS = `id,name,instagram_business_account{${IG_FIELDS}}`;

function mapIg(ig) {
  if (!ig) return null;
  return {
    igId: ig.id, username: ig.username, name: ig.name, profilePicUrl: ig.profile_picture_url,
    followers: ig.followers_count, follows: ig.follows_count, mediaCount: ig.media_count, biography: ig.biography, website: ig.website,
  };
}

/**
 * Discovers Instagram business accounts from every place the token can see them:
 *  1. /me/accounts — Pages where the user has a personal role
 *  2. /me/businesses → owned_pages + client_pages — Pages managed through Business Manager
 *  3. business → owned_instagram_accounts + client_instagram_accounts — IG accounts assigned to the business
 * Page traversal (1–2) is shared with Facebook Pages (providers/shared/metaPages.js). Results are merged by igId.
 * `sources` tells the UI where each account came from; `warnings` lists endpoints that failed
 * (e.g. missing business_management) without aborting discovery.
 */
export async function discoverAccounts(token) {
  const standalone = [];
  const standaloneIds = new Set();
  const onBusiness = async (b, pages) => {
    const warnings = [];
    const known = new Set([...standaloneIds]);
    for (const entry of pages.values()) if (entry.page.instagram_business_account?.id) known.add(entry.page.instagram_business_account.id);
    for (const edge of ['owned_instagram_accounts', 'client_instagram_accounts']) {
      try {
        const igs = await graphGetAll(`/${b.id}/${edge}`, { fields: IG_FIELDS, limit: 100 }, { token });
        for (const raw of igs) {
          const ig = mapIg(raw);
          if (!ig || known.has(ig.igId)) continue;
          known.add(ig.igId);
          standaloneIds.add(ig.igId);
          standalone.push({ pageId: null, pageName: `${b.name} (Business Manager)`, ig, sources: [`${b.name} · ${edge}`], noPage: true });
        }
      } catch (e) {
        warnings.push({ endpoint: `/${b.id}/${edge}`, code: e.code ?? null, message: e.message, business: b.name });
      }
      await graphDelay();
    }
    return warnings;
  };
  const { pages, businesses, warnings } = await discoverMetaPages({ token, fields: PAGE_FIELDS, onBusiness });
  const list = [
    ...pages.map((e) => ({ pageId: e.id, pageName: e.page.name, ig: mapIg(e.page.instagram_business_account), sources: e.sources })),
    ...standalone,
  ];
  return Object.assign(list, { warnings, businesses });
}

export async function fetchAccountProfile(igId, token) {
  const d = await graphGet(`/${igId}`, { fields: IG_FIELDS }, { token });
  return {
    igId: d.id, username: d.username, name: d.name, profilePicUrl: d.profile_picture_url,
    followers: d.followers_count, follows: d.follows_count, mediaCount: d.media_count,
    biography: d.biography, website: d.website,
  };
}

const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url,children{media_url,media_type}';

export async function fetchMedia(igId, token, { sinceUnix, max = 500 } = {}) {
  const items = await graphGetAll(`/${igId}/media`, { fields: MEDIA_FIELDS, since: sinceUnix, limit: 50 }, { token, max });
  return items.map((m) => ({
    mediaId: m.id,
    caption: m.caption ?? '',
    mediaType: m.media_type,
    mediaProductType: m.media_product_type ?? 'FEED',
    permalink: m.permalink,
    timestamp: m.timestamp,
    likeCount: m.like_count ?? 0,
    commentsCount: m.comments_count ?? 0,
    thumbnailUrl: m.thumbnail_url ?? m.media_url ?? m.children?.data?.[0]?.media_url ?? null,
  }));
}

/**
 * Fetches media insights, dropping unsupported metrics one at a time.
 * Returns { values: {metric: number}, dropped: [{metric, message}] }.
 */
export async function fetchMediaInsights(media, token, { disabled = [], overrides = null } = {}) {
  let metrics = mediaMetricsFor(media.mediaProductType, media.mediaType, { disabled, overrides });
  const dropped = [];
  for (let attempt = 0; attempt < 8 && metrics.length; attempt += 1) {
    try {
      const body = await graphGet(`/${media.mediaId}/insights`, { metric: metrics.join(',') }, { token });
      const values = {};
      for (const row of body.data ?? []) {
        const name = normalizeMetricName(row.name);
        const v = row.values?.[0]?.value ?? row.total_value?.value ?? null;
        values[name] = typeof v === 'object' && v !== null ? Object.values(v).reduce((a, b) => a + b, 0) : v;
      }
      return { values, dropped };
    } catch (e) {
      if (e instanceof MetaError && e.isInvalidParam) {
        const bad = metricFromErrorMessage(e.message, metrics) ?? metrics[metrics.length - 1];
        if (!metrics.includes(bad)) throw e;
        dropped.push({ metric: bad, message: e.message });
        metrics = metrics.filter((m) => m !== bad);
        await graphDelay();
        continue;
      }
      throw e;
    }
  }
  return { values: {}, dropped };
}

// The generic loop lives in providers/shared/insights.js; built lazily from the imported functions so test mocks of
// meta/client.js keep applying.
const igClient = { get: (...args) => graphGet(...args), delay: () => graphDelay() };

/**
 * Daily account insights. Metrics that support `metric_type=time_series` come back as per-day values in one call;
 * metrics Meta only serves as `total_value` (e.g. profile_views, accounts_engaged) are fetched one day at a time
 * so the stored series stays daily. Unsupported metrics are dropped, never the whole request.
 */
export async function fetchAccountInsightsDaily(igId, token, { sinceUnix, untilUnix, disabled = [], overrides = null }) {
  return fetchInsightsDaily(igClient, `/${igId}/insights`, accountMetricsFor('daily', { disabled, overrides }), {
    sinceUnix, untilUnix, token, normalize: normalizeMetricName,
  });
}

export async function fetchFollowerCountSeries(igId, token, { sinceUnix, untilUnix }) {
  const body = await graphGet(`/${igId}/insights`, { metric: 'follower_count', period: 'day', since: sinceUnix, until: untilUnix }, { token });
  const row = body.data?.[0];
  return (row?.values ?? []).map((v) => ({ date: String(v.end_time).slice(0, 10), value: v.value }));
}

export async function fetchDemographics(igId, token, { disabled = [], overrides = null } = {}) {
  const metrics = accountMetricsFor('lifetime', { disabled, overrides });
  const result = { city: [], genderAge: [], country: [] };
  const dropped = [];
  for (const metric of metrics) {
    try {
      const body = await graphGet(`/${igId}/insights`, {
        metric, period: 'lifetime', metric_type: 'total_value', breakdown: metric.replace('audience_', ''),
      }, { token });
      const row = body.data?.[0];
      const breakdowns = row?.total_value?.breakdowns?.[0]?.results ?? [];
      const legacy = row?.values?.[0]?.value ?? null;
      const buckets = breakdowns.length
        ? breakdowns.map((r) => ({ bucket: r.dimension_values.join('.'), value: r.value }))
        : legacy ? Object.entries(legacy).map(([bucket, value]) => ({ bucket, value })) : [];
      const key = metric === 'audience_city' ? 'city' : metric === 'audience_country' ? 'country' : 'genderAge';
      result[key] = buckets;
    } catch (e) {
      if (e instanceof MetaError && e.isInvalidParam) {
        dropped.push({ metric, message: e.message });
        continue;
      }
      throw e;
    }
    await graphDelay();
  }
  return { ...result, dropped };
}

export async function fetchComments(mediaId, token, { max = 200 } = {}) {
  const items = await graphGetAll(`/${mediaId}/comments`, {
    fields: 'id,text,timestamp,like_count,username,replies{id,timestamp,username,text}', limit: 50,
  }, { token, max });
  return items;
}
