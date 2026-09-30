import { PUBLISH_PLATFORMS, TOKEN_KEY_RE, isSha256 } from './shared.js';
import { firstAttemptAt, DEFAULT_MAX_LATE_MIN } from './scheduler.js';
import { isAllowedMime } from './media.js';

/**
 * Queue items: validation of pushed items, the upsert rule, recall and the change feed shape.
 * The desktop owns content (revision); the worker owns execution state (status/step/attempts).
 * An upsert is accepted only when the incoming revision is greater than the stored one and the stored item has not
 * started publishing (status queued with no step, failed or missed).
 */
export const MAX_BATCH = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATS = new Set(['image', 'carousel', 'reel', 'story', 'text', 'link', 'photo', 'album', 'video']);
const EXTERNAL_ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const MAX_CAPTION = 64_000;
const MAX_OPTIONS_JSON = 16_384;
const MAX_MEDIA = 20;

export const isItemId = (s) => typeof s === 'string' && UUID_RE.test(s);

const str = (v, max) => typeof v === 'string' && v.length <= max;
const optStr = (v, max) => v == null || str(v, max);

function validRef(ref) {
  if (!ref || typeof ref !== 'object') return false;
  if (ref.sha256 != null && !isSha256(ref.sha256)) return false;
  if (ref.url != null) {
    if (!str(ref.url, 2048)) return false;
    try { if (new URL(ref.url).protocol !== 'https:') return false; } catch { return false; }
  }
  if (ref.sha256 == null && ref.url == null) return false;
  if (!['image', 'video'].includes(ref.kind)) return false;
  if (ref.mime != null && !isAllowedMime(ref.mime)) return false;
  if (ref.bytes != null && !(Number.isInteger(ref.bytes) && ref.bytes >= 0)) return false;
  if (ref.width != null && !(Number.isInteger(ref.width) && ref.width >= 0)) return false;
  return optStr(ref.fileName, 255) && optStr(ref.altText, 1000) && optStr(ref.format, 16);
}

/** @returns {string|null} a reason code, or null when the item is valid */
export function invalidReason(raw) {
  if (!raw || typeof raw !== 'object') return 'invalid';
  if (!isItemId(raw.id)) return 'invalid_id';
  if (!Number.isInteger(raw.revision) || raw.revision < 1) return 'invalid_revision';
  if (!PUBLISH_PLATFORMS.includes(raw.platform)) return 'invalid_platform';
  if (!str(raw.accountId, 80) || !TOKEN_KEY_RE.test(String(raw.tokenKey ?? '')) || !raw.tokenKey.startsWith(`${raw.platform}:`)) return 'invalid_token_key';
  if (!Number.isFinite(raw.scheduledAt)) return 'invalid_time';
  const p = raw.payload;
  if (!p || typeof p !== 'object' || !FORMATS.has(p.format)) return 'invalid_format';
  if (!optStr(p.caption, MAX_CAPTION) || !optStr(p.firstComment, 8000) || !EXTERNAL_ID_RE.test(String(p.externalId ?? ''))) return 'invalid_payload';
  if (p.options != null && (typeof p.options !== 'object' || JSON.stringify(p.options).length > MAX_OPTIONS_JSON)) return 'invalid_options';
  if (!Array.isArray(p.media ?? []) || (p.media ?? []).length > MAX_MEDIA || !(p.media ?? []).every(validRef)) return 'invalid_media';
  if (p.cover != null && !validRef(p.cover)) return 'invalid_media';
  const policy = raw.policy ?? {};
  if (policy.maxLateMinutes != null && !(Number.isInteger(policy.maxLateMinutes) && policy.maxLateMinutes >= 0 && policy.maxLateMinutes <= 10_080)) return 'invalid_policy';
  return null;
}

const upsertable = (cur) => (cur.status === 'queued' && !cur.step) || cur.status === 'failed' || cur.status === 'missed';

/** Copies only the known fields (never stores unexpected input). */
function sanitize(raw) {
  const p = raw.payload;
  const ref = (r) => (r ? {
    sha256: r.sha256 ?? null, url: r.url ?? null, kind: r.kind, mime: r.mime ?? null, bytes: r.bytes ?? null, fileName: r.fileName ?? null,
    format: r.format ?? null, width: r.width ?? null, altText: r.altText ?? null, assetId: r.assetId != null ? String(r.assetId).slice(0, 64) : null,
  } : null);
  return {
    id: raw.id.toLowerCase(), revision: raw.revision, platform: raw.platform, accountId: String(raw.accountId), tokenKey: raw.tokenKey,
    scheduledAt: raw.scheduledAt,
    policy: { maxLateMinutes: raw.policy?.maxLateMinutes ?? DEFAULT_MAX_LATE_MIN, publishNow: raw.policy?.publishNow === true },
    payload: {
      format: p.format, caption: p.caption ?? '', firstComment: p.firstComment ?? null, options: p.options ?? {}, externalId: String(p.externalId),
      media: (p.media ?? []).map(ref), cover: ref(p.cover),
    },
  };
}

/**
 * POST /v1/items:batch.
 * @returns {{ id, result: 'accepted'|'conflict'|'rejected', workerRevision: number|null, status: string|null, reason?: string }[]}
 */
export function upsertItems({ store, tokens, media, now }, list) {
  return list.map((raw) => {
    const reason = invalidReason(raw);
    const id = typeof raw?.id === 'string' ? raw.id.toLowerCase() : null;
    if (reason) return { id, result: 'rejected', workerRevision: null, status: null, reason };
    const cur = store.getItem(id);
    if (cur && (raw.revision <= cur.revision || !upsertable(cur))) {
      return { id, result: 'conflict', workerRevision: cur.revision, status: cur.status, reason: raw.revision <= cur.revision ? 'stale_revision' : 'in_progress' };
    }
    if (!tokens.has(raw.tokenKey)) return { id, result: 'rejected', workerRevision: cur?.revision ?? null, status: cur?.status ?? null, reason: 'token_missing' };
    const clean = sanitize(raw);
    const missing = [...clean.payload.media, clean.payload.cover].filter((r) => r?.sha256 && !r.url && !media.has(r.sha256));
    if (missing.length) return { id, result: 'rejected', workerRevision: cur?.revision ?? null, status: cur?.status ?? null, reason: 'media_missing' };
    const acceptedAt = now();
    const dueAt = clean.policy.publishNow ? Math.max(clean.scheduledAt, acceptedAt) : clean.scheduledAt;
    const item = {
      ...clean, dueAt, acceptedAt, status: 'queued', step: null, containerId: null, containerAt: null, startedAt: null, attempts: 0,
      recreated: false, lastError: null, remoteId: null, permalink: null, mediaKey: null, publishedAt: null, completedAt: null,
    };
    const stored = store.putItem({ ...item, nextAttemptAt: Math.max(acceptedAt, firstAttemptAt(item)) });
    return { id, result: 'accepted', workerRevision: stored.revision, status: stored.status };
  });
}

/** DELETE /v1/items/:id?revision= → { status, body }. 409 once publishing started or published. */
export function recallItem(store, id, revision) {
  const cur = store.getItem(id);
  if (!cur) return { status: 404, body: { error: { code: 'not_found' } } };
  if (revision != null && Number(revision) < cur.revision) return { status: 409, body: { error: { code: 'stale_revision' }, workerRevision: cur.revision, itemStatus: cur.status } };
  if (cur.status === 'published' || cur.status === 'publishing' || (cur.status === 'queued' && cur.step)) {
    return { status: 409, body: { error: { code: cur.status === 'published' ? 'published' : 'publishing' }, workerRevision: cur.revision, itemStatus: cur.status } };
  }
  store.deleteItem(id);
  return { status: 200, body: { recalled: true } };
}

/** Change-feed entry (execution state only; never the payload). */
export const toChange = (i) => ({
  id: i.id, revision: i.revision, status: i.status, step: i.step ?? null, attempts: i.attempts ?? 0, lastError: i.lastError ?? null,
  remoteId: i.remoteId ?? null, permalink: i.permalink ?? null, mediaKey: i.mediaKey ?? null, publishedAt: i.publishedAt ?? null, seq: i.seq,
});

export function queueCounts(store) {
  const counts = { queued: 0, publishing: 0, failed: 0 };
  for (const i of store.listItems()) {
    if (i.status === 'queued') counts.queued += 1;
    else if (i.status === 'publishing') counts.publishing += 1;
    else if (i.status === 'failed' || i.status === 'missed') counts.failed += 1;
  }
  return counts;
}
