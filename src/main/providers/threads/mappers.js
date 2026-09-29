/** Pure mappers from Threads API payloads to MetaDash shapes. */

export const THREADS_KEY_PREFIX = 'th-';
export const THREADS_PRODUCT_TYPE = 'THREADS';
/** A repost of someone else's thread: not the account's own content, and /insights returns nothing for it. */
export const REPOST_FACADE = 'REPOST_FACADE';

export const threadsKey = (id) => `${THREADS_KEY_PREFIX}${id}`;

/** GET /me payload → Profile (followers come from threads_insights followers_count). */
export function mapProfile(me, followers) {
  return {
    username: me?.username ?? String(me?.id ?? ''),
    name: me?.name ?? null,
    profilePicUrl: me?.threads_profile_picture_url ?? null,
    biography: me?.threads_biography ?? null,
    ...(typeof followers === 'number' ? { followers } : {}),
  };
}

/** One /threads item → Post, or null for reposts (REPOST_FACADE) and malformed rows. */
export function mapPost(t) {
  if (!t?.id || t.media_type === REPOST_FACADE) return null;
  const child = t.children?.data?.[0];
  return {
    mediaId: threadsKey(t.id),
    externalId: String(t.id),
    mediaType: t.media_type ?? 'TEXT_POST',
    mediaProductType: THREADS_PRODUCT_TYPE,
    caption: t.text ?? '',
    permalink: t.permalink ?? null,
    thumbnailUrl: t.thumbnail_url ?? (t.media_type === 'IMAGE' ? t.media_url : null) ?? child?.thumbnail_url ?? child?.media_url ?? null,
    timestamp: t.timestamp,
  };
}

/**
 * Value of one insights row: time-series/lifetime `values[0].value`, `total_value.value`, or the sum of
 * `link_total_values[].value` (clicks). Returns undefined when absent.
 */
export function insightValue(row) {
  if (!row) return undefined;
  if (Array.isArray(row.link_total_values)) return row.link_total_values.reduce((s, l) => s + (Number(l.value) || 0), 0);
  if (typeof row.total_value?.value === 'number') return row.total_value.value;
  const v = row.values?.[0]?.value;
  return typeof v === 'number' ? v : undefined;
}

/** { data: [rows] } → { apiName: number } */
export function insightValues(body) {
  const out = {};
  for (const row of body?.data ?? []) {
    const v = insightValue(row);
    if (typeof v === 'number') out[row.name] = v;
  }
  return out;
}

/** follower_demographics payload → [{ bucket, value }] */
export function mapDemographics(body) {
  const row = (body?.data ?? []).find((r) => r.name === 'follower_demographics') ?? body?.data?.[0];
  const results = row?.total_value?.breakdowns?.[0]?.results ?? [];
  return results
    .map((r) => ({ bucket: String(r.dimension_values?.[0] ?? ''), value: Number(r.value) }))
    .filter((b) => b.bucket && Number.isFinite(b.value));
}
