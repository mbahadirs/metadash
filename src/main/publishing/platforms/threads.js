import { publishError } from '../errors.js';
import { threadsKey } from '../../providers/threads/mappers.js';
import {
  captionOf, optionsOf, urlOf, findMatch, CHILDREN_PREFIX, isChildrenRef, childrenOf, combineStatuses,
} from './shared.js';

/**
 * Threads publishing (graph.threads.net/v1.0, Threads token, threads_basic + threads_content_publish). Verified against
 * developers.facebook.com/docs/threads/posts, /troubleshooting and /overview (2026-09-29):
 *  - POST /{uid}/threads → container: media_type TEXT|IMAGE|VIDEO|CAROUSEL, text (≤500), image_url|video_url (public
 *    URL, no resumable upload), is_carousel_item, children (2–20), link_attachment (TEXT), topic_tag, reply_to_id
 *  - GET /{container}?fields=status,error_message → EXPIRED|ERROR|FINISHED|IN_PROGRESS|PUBLISHED (24 h lifetime)
 *  - "wait on average 30 seconds before publishing" → firstPollDelayMs
 *  - POST /{uid}/threads_publish creation_id → id; GET /{uid}/threads_publishing_limit (250 posts / 86400 s)
 *  - first comment = a reply (reply_to_id); the replies quota endpoint needs threads_manage_replies.
 *  alt_text on image/video containers is VERIFY.
 */
const RECENT_THREADS = 10;

const tokenOf = (ctx) => ctx.tokenFor('threads');
const uidOf = (job) => job.account.externalId;

async function createContainer(ctx, job, params) {
  const res = await ctx.threads.post(`/${uidOf(job)}/threads`, params, { token: tokenOf(ctx) });
  if (!res?.id) throw publishError('pub_no_container');
  return res.id;
}

async function containerStatus(ctx, id) {
  const body = await ctx.threads.get(`/${id}`, { fields: 'status,error_message' }, { token: tokenOf(ctx), maxRetries: 2 });
  return { status: body?.status ?? 'IN_PROGRESS', message: body?.error_message ?? null };
}

const altOf = (job, item) => item.altText || optionsOf(job).altText?.[item.assetId] || null;

function mediaParams(job, item) {
  const alt = altOf(job, item);
  const base = item.asset.kind === 'video' ? { media_type: 'VIDEO', video_url: urlOf(item) } : { media_type: 'IMAGE', image_url: urlOf(item) };
  return alt ? { ...base, alt_text: alt } : base;
}

const topic = (job) => (optionsOf(job).topicTag ? { topic_tag: String(optionsOf(job).topicTag).replace(/^#/, '') } : {});

async function carousel(ctx, job) {
  const ref = job.target.containerId;
  let ids = childrenOf(ref);
  if (!ids.length) {
    ids = [];
    for (const item of job.media) ids.push(await createContainer(ctx, job, { ...mediaParams(job, item), is_carousel_item: true }));
    return { containerId: CHILDREN_PREFIX + ids.join(','), pending: true };
  }
  const st = combineStatuses(await Promise.all(ids.map((id) => containerStatus(ctx, id))));
  if (st.status === 'ERROR') throw publishError('pub_container_error', { detail: st.message ?? 'ERROR' }, { kind: 'media', code: 'container_error' });
  if (st.status === 'EXPIRED') throw publishError('pub_container_expired', {}, { kind: 'expired', code: 'container_expired' });
  if (st.status !== 'FINISHED') return { containerId: ref, pending: true };
  return { containerId: await createContainer(ctx, job, { media_type: 'CAROUSEL', children: ids.join(','), text: captionOf(job), ...topic(job) }) };
}

async function publishContainer(ctx, job, creationId) {
  const res = await ctx.threads.post(`/${uidOf(job)}/threads_publish`, { creation_id: creationId }, { token: tokenOf(ctx) });
  if (!res?.id) throw publishError('pub_no_remote_id');
  return res.id;
}

const threads = {
  platform: 'threads',
  nativeSchedule: false,
  direct: false,
  firstPollDelayMs: 30_000,

  imageVariant: () => null,
  hostedItems: (job) => job.media,
  optionalHosted: () => [],
  needsPrepare: (target) => !target.containerId || isChildrenRef(target.containerId),

  async prepare(ctx, job) {
    const { format, containerId } = job.target;
    if (containerId && !isChildrenRef(containerId)) return { containerId };
    if (format === 'carousel') return carousel(ctx, job);
    if (format === 'text') {
      const link = optionsOf(job).link;
      return { containerId: await createContainer(ctx, job, { media_type: 'TEXT', text: captionOf(job), ...(link ? { link_attachment: link } : {}), ...topic(job) }) };
    }
    const [first] = job.media;
    if (!first) throw publishError('pub_no_media');
    if (format === 'image' || format === 'video') return { containerId: await createContainer(ctx, job, { ...mediaParams(job, first), text: captionOf(job), ...topic(job) }) };
    throw publishError('pub_unsupported_format', { format });
  },

  status: (ctx, job) => containerStatus(ctx, job.target.containerId),

  async publish(ctx, job) {
    const id = await publishContainer(ctx, job, job.target.containerId);
    let permalink = null;
    try { permalink = (await ctx.threads.get(`/${id}`, { fields: 'permalink' }, { token: tokenOf(ctx) }))?.permalink ?? null; } catch { permalink = null; }
    return { remoteId: id, permalink, mediaKey: threadsKey(id) };
  },

  async recover(ctx, job, { since }) {
    const id = job.target.containerId;
    if (!id || isChildrenRef(id)) return { notPublished: true };
    const st = await containerStatus(ctx, id);
    if (st.status !== 'PUBLISHED') return st.status === 'IN_PROGRESS' ? null : { notPublished: true, status: st.status };
    const recent = await ctx.threads.get(`/${uidOf(job)}/threads`, { fields: 'id,text,timestamp,permalink', limit: RECENT_THREADS }, { token: tokenOf(ctx) });
    const hit = findMatch({ items: recent?.data, text: captionOf(job), since, textField: 'text', timeField: 'timestamp' });
    return { found: hit ? { remoteId: hit.id, permalink: hit.permalink ?? null, mediaKey: threadsKey(hit.id) } : { remoteId: null, permalink: null, mediaKey: null } };
  },

  /** Reply to the published post (TEXT container with reply_to_id, then threads_publish). */
  async firstComment(ctx, job, text) {
    const creation = await createContainer(ctx, job, { media_type: 'TEXT', text, reply_to_id: job.target.remoteId });
    return { id: await publishContainer(ctx, job, creation) };
  },

  async quota(ctx, account) {
    const body = await ctx.threads.get(`/${account.externalId}/threads_publishing_limit`, { fields: 'quota_usage,config' }, { token: tokenOf(ctx) });
    const row = body?.data?.[0] ?? {};
    return { used: row.quota_usage ?? null, total: row.config?.quota_total ?? null, windowSec: row.config?.quota_duration ?? null };
  },
};

export default threads;
