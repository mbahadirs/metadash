import { GRAPH_VERSION, isGone } from './graph.js';
import { publishError } from './errors.js';
import { captionOf, optionsOf, blobOf, fileSize, findMatch, toUnix, absoluteFbUrl } from './util.js';

/**
 * Facebook Page publishing with the Page access token (pages_manage_posts + pages_read_engagement, CREATE_CONTENT task).
 * Verified (developers.facebook.com/docs/pages-api/posts, graph-api/reference/page/photos + /feed, video-api reels
 * publishing, 2026-09-29):
 *  - text/link: POST /{page}/feed message, link, published, scheduled_publish_time (unix s)
 *  - photo: POST /{page}/photos multipart `source`, `caption` (message is deprecated) → { id, post_id }
 *  - album: photos with published=false (+ temporary=true when scheduling, VERIFY) → POST /{page}/feed attached_media[i]
 *  - video: POST graph-video.facebook.com/{page}/videos multipart `source`, description (single request; files > 1 GB
 *    would need the chunked upload_phase flow, not implemented)
 *  - reel: /{page}/video_reels upload_phase=start → rupload video-upload → upload_phase=finish, video_state
 *    PUBLISHED|SCHEDULED (+ scheduled_publish_time). Reels: 3–90 s, 9:16.
 *  - scheduling window: 10 min … 30 days (Pages API guide; the /feed reference says 75 days — the lower value is used)
 *  - update: POST /{post-id}; delete: DELETE /{post-id}; is_published on the post (reconcile).
 *  Reconciling scheduled videos through `published` and rescheduling videos via POST /{video} are VERIFY.
 */
const VIDEO_BASE = `https://graph-video.facebook.com/${GRAPH_VERSION}`;
const RUPLOAD_REELS = `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`;
const SIMPLE_VIDEO_MAX_BYTES = 1024 ** 3;
const RECENT_POSTS = 10;
const VIDEO_FORMATS = new Set(['video', 'reel']);

const pageOf = (job) => job.account.externalId;
const pageToken = (ctx, job) => ctx.pageToken(pageOf(job));
const postKey = (pageId, id) => (String(id).includes('_') ? String(id) : `${pageId}_${id}`);

function scheduleParams(when) {
  if (when == null) return {};
  return { published: false, scheduled_publish_time: toUnix(when) };
}

async function photoUpload(ctx, job, item, token, extra) {
  const form = new FormData();
  form.set('source', await blobOf(item), item.asset.fileName ?? 'photo');
  for (const [k, v] of Object.entries(extra)) if (v != null) form.set(k, String(v));
  return ctx.meta.postForm(`/${pageOf(job)}/photos`, form, { token });
}

async function postFeed(ctx, job, token, when) {
  const o = optionsOf(job);
  const params = { message: captionOf(job), ...(job.target.format === 'link' ? { link: o.link } : {}), ...scheduleParams(when) };
  if (job.target.format === 'album') {
    for (const [i, item] of job.media.entries()) {
      const alt = item.altText || o.altText?.[item.assetId];
      const photo = await photoUpload(ctx, job, item, token, { published: 'false', ...(when != null ? { temporary: 'true' } : {}), ...(alt ? { alt_text_custom: alt } : {}) });
      params[`attached_media[${i}]`] = { media_fbid: photo.id };
    }
  }
  const res = await ctx.meta.post(`/${pageOf(job)}/feed`, params, { token });
  if (!res?.id) throw publishError('pub_no_remote_id');
  return { id: postKey(pageOf(job), res.id), kind: 'post' };
}

async function postPhoto(ctx, job, token, when) {
  const [item] = job.media;
  const alt = item.altText || optionsOf(job).altText?.[item.assetId];
  const res = await photoUpload(ctx, job, item, token, { caption: captionOf(job), ...(alt ? { alt_text_custom: alt } : {}), ...scheduleParams(when) });
  if (!res?.id) throw publishError('pub_no_remote_id');
  return { id: postKey(pageOf(job), res.post_id ?? res.id), kind: 'post' };
}

async function postVideo(ctx, job, token, when) {
  const [item] = job.media;
  if (fileSize(item) > SIMPLE_VIDEO_MAX_BYTES) throw publishError('pub_fb_video_too_large');
  const form = new FormData();
  form.set('source', await blobOf(item), item.asset.fileName ?? 'video.mp4');
  form.set('description', captionOf(job));
  for (const [k, v] of Object.entries(scheduleParams(when))) form.set(k, String(v));
  const res = await ctx.meta.postForm(`/${pageOf(job)}/videos`, form, { token, base: VIDEO_BASE });
  if (!res?.id) throw publishError('pub_no_remote_id');
  return { id: String(res.id), kind: 'video' };
}

async function postReel(ctx, job, token, when) {
  const [item] = job.media;
  const page = pageOf(job);
  const start = await ctx.meta.post(`/${page}/video_reels`, { upload_phase: 'start' }, { token });
  if (!start?.video_id) throw publishError('pub_no_container');
  const url = start.upload_url || `${RUPLOAD_REELS}/${start.video_id}`;
  await ctx.meta.postBinary(url, await blobOf(item), { headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(fileSize(item)) } });
  const finish = { upload_phase: 'finish', video_id: start.video_id, description: captionOf(job), video_state: when == null ? 'PUBLISHED' : 'SCHEDULED', ...(when == null ? {} : { scheduled_publish_time: toUnix(when) }) };
  await ctx.meta.post(`/${page}/video_reels`, finish, { token });
  return { id: String(start.video_id), kind: 'video' };
}

async function create(ctx, job, when) {
  const token = await pageToken(ctx, job);
  const { format } = job.target;
  if (format === 'text' || format === 'link' || format === 'album') return postFeed(ctx, job, token, when);
  if (format === 'photo') return postPhoto(ctx, job, token, when);
  if (format === 'video') return postVideo(ctx, job, token, when);
  if (format === 'reel') return postReel(ctx, job, token, when);
  throw publishError('pub_unsupported_format', { format });
}

async function details(ctx, job, id, token) {
  const video = VIDEO_FORMATS.has(job.target.format);
  const fields = video ? 'permalink_url,published,post_id' : 'permalink_url,is_published';
  const body = await ctx.meta.get(`/${id}`, { fields }, { token, maxRetries: 2 });
  const published = video ? body?.published !== false : body?.is_published !== false;
  const mediaKey = video ? (body?.post_id ? postKey(pageOf(job), body.post_id) : null) : id;
  return { published, permalink: absoluteFbUrl(body?.permalink_url), mediaKey };
}


const facebook = {
  platform: 'facebook',
  nativeSchedule: true,
  direct: true, // no container step: the publish call uploads and posts

  imageVariant: () => null,
  hostedItems: () => [],
  optionalHosted: () => [],
  needsPrepare: () => false,

  async prepare() {
    return { containerId: null };
  },

  async publish(ctx, job) {
    const token = await pageToken(ctx, job);
    const res = await create(ctx, job, null);
    let info = { permalink: null, mediaKey: res.kind === 'post' ? res.id : null };
    try { info = await details(ctx, job, res.id, token); } catch { /* permalink is optional */ }
    return { remoteId: res.id, permalink: info.permalink, mediaKey: info.mediaKey ?? (res.kind === 'post' ? res.id : null) };
  },

  /** Hands the post to Facebook's own scheduler. @returns {{ containerId: string }} (the scheduled post/video id) */
  async scheduleNative(ctx, job, when) {
    const res = await create(ctx, job, when);
    return { containerId: res.id };
  },

  async reconcile(ctx, job) {
    const token = await pageToken(ctx, job);
    const info = await details(ctx, job, job.target.containerId, token);
    return { published: info.published, remoteId: job.target.containerId, permalink: info.permalink, mediaKey: info.mediaKey };
  },

  async reschedule(ctx, job, when) {
    const token = await pageToken(ctx, job);
    await ctx.meta.post(`/${job.target.containerId}`, { scheduled_publish_time: toUnix(when) }, { token, maxRetries: 2 });
  },

  async cancelNative(ctx, job) {
    if (!job.target.containerId) return;
    const token = await pageToken(ctx, job);
    try {
      await ctx.meta.del(`/${job.target.containerId}`, {}, { token, maxRetries: 2 });
    } catch (e) {
      if (!isGone(e)) throw e;
    }
  },

  /** After an interrupted publish call: look for a matching post created since `since`; otherwise inconclusive. */
  async recover(ctx, job, { since }) {
    const token = await pageToken(ctx, job);
    const video = VIDEO_FORMATS.has(job.target.format);
    const edge = video ? 'videos' : 'posts';
    const fields = video ? 'id,description,created_time,permalink_url' : 'id,message,created_time,permalink_url';
    const recent = await ctx.meta.get(`/${pageOf(job)}/${edge}`, { fields, limit: RECENT_POSTS }, { token });
    const hit = findMatch({ items: recent?.data, text: captionOf(job), since, textField: video ? 'description' : 'message', timeField: 'created_time' });
    if (!hit) return null;
    return { found: { remoteId: String(hit.id), permalink: absoluteFbUrl(hit.permalink_url), mediaKey: video ? null : postKey(pageOf(job), hit.id) } };
  },

  async firstComment(ctx, job, text) {
    const token = await pageToken(ctx, job);
    const res = await ctx.meta.post(`/${job.target.remoteId}/comments`, { message: text }, { token });
    return { id: res?.id ?? null };
  },
};

export default facebook;
