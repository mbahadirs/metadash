import { GRAPH_VERSION } from './graph.js';
import { publishError } from './errors.js';
import {
  captionOf, optionsOf, urlOf, blobOf, fileSize, findMatch, CHILDREN_PREFIX, isChildrenRef, childrenOf, combineStatuses,
} from './util.js';

/**
 * Instagram Content Publishing (Facebook Login flavour: graph.facebook.com, IG user id, Meta user token,
 * instagram_content_publish). Verified against developers.facebook.com/docs/instagram-platform/content-publishing and
 * the IG User Media / IG Container / content_publishing_limit references (2026-09-29):
 *  - POST /{ig}/media → container (image_url | media_type=REELS|STORIES|CAROUSEL|VIDEO, upload_type=resumable,
 *    is_carousel_item, children ≤10, caption, alt_text (images only), share_to_feed, thumb_offset, cover_url,
 *    collaborators ≤3, location_id)
 *  - resumable: POST https://rupload.facebook.com/ig-api-upload/<ver>/<container> with Authorization: OAuth <token>,
 *    offset, file_size headers (reels, stories, carousel video items)
 *  - GET /{container}?fields=status_code,status → EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED (24 h lifetime)
 *  - POST /{ig}/media_publish creation_id → media id; GET /{ig}/content_publishing_limit → quota_usage + config
 *  - images must be JPEG on a public URL.
 */
const RUPLOAD_BASE = `https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}`;
const IG_WIDTH_MAX = 1440;
const RECENT_MEDIA = 10;

const tokenOf = (ctx) => ctx.tokenFor('meta');
const igOf = (job) => job.account.externalId;

async function uploadResumable(ctx, created, item) {
  const url = created.uri || `${RUPLOAD_BASE}/${created.id}`;
  const token = tokenOf(ctx);
  await ctx.meta.postBinary(url, await blobOf(item), { headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(fileSize(item)) } });
}

async function createContainer(ctx, job, params) {
  const res = await ctx.meta.post(`/${igOf(job)}/media`, params, { token: tokenOf(ctx) });
  if (!res?.id) throw publishError('pub_no_container');
  return res;
}

const common = (job) => {
  const o = optionsOf(job);
  return {
    ...(o.locationId ? { location_id: o.locationId } : {}),
    ...(Array.isArray(o.collaborators) && o.collaborators.length ? { collaborators: o.collaborators.slice(0, 3) } : {}),
  };
};

async function videoContainer(ctx, job, item, params) {
  const created = await createContainer(ctx, job, { ...params, upload_type: 'resumable' });
  await uploadResumable(ctx, created, item);
  return created.id;
}

async function containerStatus(ctx, id) {
  const body = await ctx.meta.get(`/${id}`, { fields: 'status_code,status' }, { token: tokenOf(ctx), maxRetries: 2 });
  return { status: body?.status_code ?? 'IN_PROGRESS', message: body?.status ?? null };
}

async function createChildren(ctx, job) {
  const ids = [];
  for (const item of job.media) {
    if (item.asset.kind === 'video') ids.push(await videoContainer(ctx, job, item, { media_type: 'VIDEO', is_carousel_item: true }));
    else ids.push((await createContainer(ctx, job, { image_url: urlOf(item), is_carousel_item: true })).id);
  }
  return ids;
}

async function carousel(ctx, job) {
  const ref = job.target.containerId;
  let ids = childrenOf(ref);
  if (!ids.length) {
    ids = await createChildren(ctx, job);
    if (job.media.some((m) => m.asset.kind === 'video')) return { containerId: CHILDREN_PREFIX + ids.join(','), pending: true };
  } else {
    const st = combineStatuses(await Promise.all(ids.map((id) => containerStatus(ctx, id))));
    if (st.status === 'ERROR') throw publishError('pub_container_error', { detail: st.message ?? 'ERROR' }, { kind: 'media', code: 'container_error' });
    if (st.status === 'EXPIRED') throw publishError('pub_container_expired', {}, { kind: 'expired', code: 'container_expired' });
    if (st.status !== 'FINISHED') return { containerId: ref, pending: true };
  }
  const parent = await createContainer(ctx, job, { media_type: 'CAROUSEL', children: ids.join(','), caption: captionOf(job), ...common(job) });
  return { containerId: parent.id };
}

const instagram = {
  platform: 'instagram',
  nativeSchedule: false,
  direct: false,
  firstPollDelayMs: 10_000,

  /** Image variant needed before hosting: non-JPEG or wider than 1440 px → converted JPEG (q=90). */
  imageVariant(item) {
    const a = item.asset;
    if (a.kind !== 'image') return null;
    if (a.format !== 'jpeg' || (a.width ?? 0) > IG_WIDTH_MAX) return { variant: `ig${IG_WIDTH_MAX}`, maxWidth: IG_WIDTH_MAX, format: 'jpeg' };
    return null;
  },

  /** Media that need a public URL: images (videos use resumable upload). The reel cover is optional. */
  hostedItems: (job) => job.media.filter((m) => m.asset.kind === 'image' && job.target.format !== 'reel'),
  optionalHosted: (job) => (job.target.format === 'reel' && job.cover?.asset.kind === 'image' ? [job.cover] : []),

  needsPrepare: (target) => !target.containerId || isChildrenRef(target.containerId),

  async prepare(ctx, job) {
    const { format, containerId } = job.target;
    if (containerId && !isChildrenRef(containerId)) return { containerId };
    const o = optionsOf(job);
    const [first] = job.media;
    if (format === 'carousel') return carousel(ctx, job);
    if (!first) throw publishError('pub_no_media');
    if (format === 'image') {
      const altText = first.altText || o.altText?.[first.assetId];
      const created = await createContainer(ctx, job, { image_url: urlOf(first), caption: captionOf(job), ...(altText ? { alt_text: altText } : {}), ...common(job) });
      return { containerId: created.id };
    }
    if (format === 'reel') {
      const params = {
        media_type: 'REELS', caption: captionOf(job), share_to_feed: o.shareToFeed !== false, ...common(job),
        ...(Number.isFinite(o.thumbOffsetMs) ? { thumb_offset: Math.max(0, Math.round(o.thumbOffsetMs)) } : {}),
        ...(job.cover?.url ? { cover_url: job.cover.url } : {}),
      };
      return { containerId: await videoContainer(ctx, job, first, params) };
    }
    if (format === 'story') {
      if (first.asset.kind === 'video') return { containerId: await videoContainer(ctx, job, first, { media_type: 'STORIES' }) };
      return { containerId: (await createContainer(ctx, job, { media_type: 'STORIES', image_url: urlOf(first) })).id };
    }
    throw publishError('pub_unsupported_format', { format });
  },

  status: (ctx, job) => containerStatus(ctx, job.target.containerId),

  async publish(ctx, job) {
    const res = await ctx.meta.post(`/${igOf(job)}/media_publish`, { creation_id: job.target.containerId }, { token: tokenOf(ctx) });
    if (!res?.id) throw publishError('pub_no_remote_id');
    let permalink = null;
    try { permalink = (await ctx.meta.get(`/${res.id}`, { fields: 'permalink' }, { token: tokenOf(ctx) }))?.permalink ?? null; } catch { permalink = null; }
    return { remoteId: res.id, permalink, mediaKey: res.id };
  },

  /**
   * After an interrupted media_publish: PUBLISHED → find the media (caption + time) or accept it without an id;
   * FINISHED/ERROR/EXPIRED → not published; anything else → null (inconclusive).
   */
  async recover(ctx, job, { since }) {
    const id = job.target.containerId;
    if (!id || isChildrenRef(id)) return { notPublished: true };
    const st = await containerStatus(ctx, id);
    if (st.status !== 'PUBLISHED') return st.status === 'IN_PROGRESS' ? null : { notPublished: true, status: st.status };
    if (job.target.format === 'story') return { found: { remoteId: null, permalink: null, mediaKey: null } };
    const recent = await ctx.meta.get(`/${igOf(job)}/media`, { fields: 'id,caption,timestamp,permalink', limit: RECENT_MEDIA }, { token: tokenOf(ctx) });
    const hit = findMatch({ items: recent?.data, text: captionOf(job), since, textField: 'caption', timeField: 'timestamp' });
    return { found: hit ? { remoteId: hit.id, permalink: hit.permalink ?? null, mediaKey: hit.id } : { remoteId: null, permalink: null, mediaKey: null } };
  },

  async firstComment(ctx, job, text) {
    const res = await ctx.meta.post(`/${job.target.remoteId}/comments`, { message: text }, { token: tokenOf(ctx) });
    return { id: res?.id ?? null };
  },

  async quota(ctx, account) {
    const body = await ctx.meta.get(`/${account.externalId}/content_publishing_limit`, { fields: 'config,quota_usage' }, { token: tokenOf(ctx) });
    const row = body?.data?.[0] ?? {};
    return { used: row.quota_usage ?? null, total: row.config?.quota_total ?? null, windowSec: row.config?.quota_duration ?? null };
  },
};

export default instagram;
