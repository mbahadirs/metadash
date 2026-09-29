/** Pure mappers: Graph API Page / post / insights payloads → MetaDash shapes. */

export const KEY_PREFIX = 'fb-';
export const accountKey = (pageId) => `${KEY_PREFIX}${pageId}`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** picture{url} comes back as { data: { url } }; tolerate { url } too. */
export const pictureUrl = (picture) => picture?.data?.url ?? picture?.url ?? null;

/** True when the user's Page role includes the ANALYZE task. Pages seen only via Business Manager edges carry no
 * `tasks`; they are assumed analyzable (sync reports a clear error otherwise). */
export function canAnalyze(tasks) {
  if (!Array.isArray(tasks)) return true;
  return tasks.includes('ANALYZE');
}

/**
 * discoverMetaPages entry → setup candidate.
 * @param {{ id: string, page: object, sources?: string[] }} entry
 */
export function mapDiscoveredPage(entry) {
  const p = entry.page ?? {};
  return {
    accountId: accountKey(entry.id),
    externalId: String(entry.id),
    pageId: String(entry.id),
    name: p.name ?? String(entry.id),
    username: p.username ?? p.name ?? String(entry.id),
    pictureUrl: pictureUrl(p.picture),
    followers: num(p.followers_count) ?? num(p.fan_count),
    linkedIgId: p.instagram_business_account?.id ?? null,
    canAnalyze: canAnalyze(p.tasks),
    sources: entry.sources ?? [],
  };
}

/** GET /{pageId}?fields=PAGE_PROFILE_FIELDS → Profile. */
export function mapProfile(raw) {
  return {
    username: raw.username ?? raw.name ?? String(raw.id),
    name: raw.name ?? null,
    profilePicUrl: pictureUrl(raw.picture),
    biography: raw.about ?? null,
    website: raw.website ?? raw.link ?? null,
    followers: num(raw.followers_count) ?? num(raw.fan_count),
    follows: null,
    mediaCount: null,
  };
}

const STATUS_TYPE = { added_photos: 'IMAGE', added_video: 'VIDEO', shared_story: 'LINK', mobile_status_update: 'TEXT', created_note: 'TEXT' };

/** Post attachments/status_type → IMAGE | VIDEO | CAROUSEL_ALBUM | LINK | TEXT. */
export function mapMediaType(post) {
  const att = post.attachments?.data?.[0];
  const mt = String(att?.media_type ?? '').toLowerCase();
  const type = String(att?.type ?? '').toLowerCase();
  if (mt === 'album' || type === 'album') return 'CAROUSEL_ALBUM';
  if (mt === 'video' || type.startsWith('video') || type === 'animated_image_video') return 'VIDEO';
  if (mt === 'photo' || type === 'photo' || type === 'cover_photo' || type === 'profile_media') return 'IMAGE';
  if (mt === 'link' || type === 'share' || type === 'link') return 'LINK';
  if (att) return mt === 'event' ? 'LINK' : 'IMAGE';
  return STATUS_TYPE[post.status_type] ?? 'TEXT';
}

/** Counts from reactions/comments summaries and shares (undefined when a summary is missing). */
export function inlineCounts(raw) {
  return {
    likes: num(raw.reactions?.summary?.total_count) ?? undefined,
    comments: num(raw.comments?.summary?.total_count) ?? undefined,
    shares: num(raw.shares?.count) ?? 0, // Graph omits `shares` when a post has none
  };
}

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** /{pageId}/posts item → Post. Post ids are already 'pageid_postid' and are used as media keys as-is. */
export function mapPost(raw) {
  return {
    mediaId: String(raw.id),
    externalId: String(raw.id),
    mediaType: mapMediaType(raw),
    mediaProductType: 'FB_POST',
    caption: raw.message ?? '',
    permalink: raw.permalink_url ?? null,
    thumbnailUrl: raw.full_picture ?? null,
    timestamp: normalizeTime(raw.created_time),
    inline: defined(inlineCounts(raw)),
  };
}

/** '2026-09-01T10:00:00+0000' → ISO string (Date parses both, but normalize for storage). */
export function normalizeTime(t) {
  const d = new Date(String(t ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/** Sum of a post_reactions_by_type_total value ({ like: 3, love: 1 }) or a plain number. */
export function sumReactions(value) {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return null;
  return Object.values(value).reduce((n, v) => n + (typeof v === 'number' ? v : 0), 0);
}

/**
 * Page insights rows ({ name, values: [{ value, end_time }] }) → { canonical: [{ date, value }] }.
 * Dates use end_time's calendar date, the same convention as Instagram.
 */
export function parseDailyRows(rows, apiToCanonical) {
  const out = {};
  for (const row of rows ?? []) {
    const canonical = apiToCanonical[row.name];
    if (!canonical) continue;
    const points = (row.values ?? [])
      .filter((v) => typeof v.value === 'number' && v.end_time)
      .map((v) => ({ date: String(v.end_time).slice(0, 10), value: v.value }));
    out[canonical] = [...(out[canonical] ?? []), ...points];
  }
  return out;
}

/** Lifetime post insights rows → { views, reach, likes, clicks } (canonical; reactions summed into likes). */
export function parsePostInsightRows(rows, apiToCanonical) {
  const out = {};
  for (const row of rows ?? []) {
    const canonical = apiToCanonical[row.name];
    if (!canonical) continue;
    const raw = row.values?.[0]?.value ?? row.total_value?.value;
    const value = canonical === 'likes' ? sumReactions(raw) : num(raw);
    if (value !== null) out[canonical] = value;
  }
  return out;
}
