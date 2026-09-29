import { LIMITS } from './limits.js';
import { PUBLISH_CAPABILITIES, formatRule, needsPublicUrl, displayRatio } from './capabilities.js';

/**
 * Pure pre-publish validation. See plan §4.
 * @typedef {{ level: 'error'|'warn'|'info', code: string, platform: string|null, targetId?: number|null, accountId?: string|null,
 *   assetId?: number|null, field: string, params: object }} Issue
 *
 * validate({ post, targets, assets, now, context }) → Issue[]
 *  post     { id?, caption, firstComment?, scheduledAt? (UTC ms | null) }
 *  targets  [{ id?, accountId, platform, format, captionOverride?, firstCommentOverride?, options?, mode? ('app'|'native') }]
 *  assets   ordered post assets [{ id, kind, format ('jpeg'|'png'|…|'mp4'|'mov'), mime, bytes, width, height, rotation,
 *           durationMs, videoCodec, audioCodec, fps, role? ('media'|'cover') }]
 *  context  { mediaHostType ('none'|'s3'|'fbpage'|'url'), missingScopes?: { [platform]: string[] } (omit when unknown),
 *           quota?: { [accountId]: { used, total } }, existing?: [{ postId, ref?, accountId, scheduledAt }], minGapHours? }
 * Codes are i18n keys (renderer locales/<lang>/planner.json); `params` fill the {placeholders}.
 */
export const ISSUE_CODES = Object.freeze([
  'v_no_targets', 'v_format_unsupported', 'v_caption_too_long', 'v_caption_near_limit', 'v_hashtags_too_many', 'v_mentions_too_many',
  'v_links_not_clickable', 'v_topic_tags_many', 'v_links_too_many', 'v_text_required', 'v_link_required', 'v_story_caption_ignored',
  'v_first_comment_unsupported', 'v_first_comment_native', 'v_media_count', 'v_media_kind', 'v_image_format', 'v_image_converted',
  'v_image_too_large', 'v_image_resized', 'v_aspect_ratio', 'v_carousel_crop', 'v_video_format', 'v_video_codec', 'v_video_duration',
  'v_video_too_large', 'v_video_fps', 'v_video_ratio_recommended', 'v_video_unprobed', 'v_schedule_past', 'v_native_window',
  'v_native_unsupported', 'v_media_host_missing', 'v_missing_scope', 'v_quota_near', 'v_min_gap',
]);

const MB = 1024 * 1024;
const RATIO_EPS = 0.001;
const QUOTA_WARN_RATIO = 0.9;
const RECOMMENDED_RATIO_TOLERANCE = 0.02;

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** User-perceived characters (emoji with modifiers/ZWJ sequences count as one). */
export function countGraphemes(text) {
  if (!text) return 0;
  if (!segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1; // eslint-disable-line no-unused-vars
  return n;
}

const HASHTAG_RE = /(^|[^\p{L}\p{N}_&#])#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /(^|[^\p{L}\p{N}_.@])@[\p{L}\p{N}_.]+/gu;
const LINK_RE = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/giu;
const count = (re, text) => (text ? (text.match(re) ?? []).length : 0);
export const countHashtags = (text) => count(HASHTAG_RE, text);
export const countMentions = (text) => count(MENTION_RE, text);
export const countLinks = (text) => count(LINK_RE, text);

const round2 = (n) => Math.round(n * 100) / 100;
const mb = (bytes) => round2(bytes / MB);
const isHttpUrl = (s) => { try { return ['http:', 'https:'].includes(new URL(String(s)).protocol); } catch { return false; } };

/** Builds the issue list for one target; `base` holds platform/target/account. */
function makeSink(base) {
  const issues = [];
  const add = (level, code, field, params = {}, extra = {}) => issues.push({ level, code, ...base, assetId: null, field, params, ...extra });
  return { issues, add };
}

function checkText(add, platform, text, field) {
  const L = LIMITS[platform];
  const n = countGraphemes(text);
  if (n > L.captionMax) add('error', 'v_caption_too_long', field, { max: L.captionMax, actual: n });
  else if (n >= L.captionMax * LIMITS.common.captionWarnRatio) add('warn', 'v_caption_near_limit', field, { max: L.captionMax, actual: n });
  if (platform === 'instagram') {
    const tags = countHashtags(text);
    if (tags > L.hashtagsMax) add('error', 'v_hashtags_too_many', field, { max: L.hashtagsMax, actual: tags });
    const mentions = countMentions(text);
    if (mentions > L.mentionsMax) add('error', 'v_mentions_too_many', field, { max: L.mentionsMax, actual: mentions });
    if (field === 'caption' && countLinks(text) > 0) add('info', 'v_links_not_clickable', field);
  }
  if (platform === 'threads') {
    const tags = countHashtags(text);
    if (tags > L.topicTagsMax) add('warn', 'v_topic_tags_many', field, { max: L.topicTagsMax, actual: tags });
    const links = countLinks(text);
    if (links > L.linksMax) add('error', 'v_links_too_many', field, { max: L.linksMax, actual: links });
  }
}

function checkImage(add, platform, format, a) {
  const L = LIMITS[platform];
  const at = { assetId: a.id };
  const fmt = a.format ?? String(a.mime ?? '').replace('image/', '');
  const convertible = L.convertibleImageFormats.includes(fmt);
  const willResize = L.widthMax != null && (a.width ?? 0) > L.widthMax;
  if (!L.imageFormats.includes(fmt) && !convertible) add('error', 'v_image_format', 'media', { format: fmt, allowed: L.imageFormats.join(', ') }, at);
  if (convertible) add('info', 'v_image_converted', 'media', { format: fmt }, at);
  if (a.bytes > L.imageMaxBytes && !(convertible || willResize)) add('error', 'v_image_too_large', 'media', { maxMb: mb(L.imageMaxBytes), actualMb: mb(a.bytes) }, at);
  const ratio = displayRatio(a);
  if (ratio != null && format !== 'story') {
    if (L.aspectMin != null && (ratio < L.aspectMin - RATIO_EPS || ratio > L.aspectMax + RATIO_EPS)) {
      add('error', 'v_aspect_ratio', 'media', { min: L.aspectMin, max: L.aspectMax, actual: round2(ratio) }, at);
    } else if (L.aspectMin == null && L.aspectMax != null && Math.max(ratio, 1 / ratio) > L.aspectMax + RATIO_EPS) {
      add('error', 'v_aspect_ratio', 'media', { min: round2(1 / L.aspectMax), max: L.aspectMax, actual: round2(ratio) }, at);
    }
  }
  if (L.widthMin != null && a.width && (a.width < L.widthMin || a.width > L.widthMax)) {
    add('info', 'v_image_resized', 'media', { min: L.widthMin, max: L.widthMax, actual: a.width }, at);
  }
}

/** Duration/size limits for a video in this platform/format. */
function videoLimits(platform, format) {
  const L = LIMITS[platform];
  if (platform === 'instagram') {
    if (format === 'story') return { minSec: L.storyVideoMinSec, maxSec: L.storyVideoMaxSec, maxBytes: L.storyVideoMaxBytes, ratio: L.reelAspect };
    if (format === 'carousel') return { minSec: L.reelMinSec, maxSec: L.carouselVideoMaxSec, maxBytes: L.reelMaxBytes };
    return { minSec: L.reelMinSec, maxSec: L.reelMaxSec, maxBytes: L.reelMaxBytes, ratio: L.reelAspect };
  }
  if (platform === 'facebook') {
    if (format === 'reel') return { minSec: L.reelMinSec, maxSec: L.reelMaxSec, maxBytes: L.videoMaxBytes, ratio: L.reelAspect };
    return { minSec: 0, maxSec: L.videoMaxSec, maxBytes: L.videoMaxBytes };
  }
  return { minSec: 0, maxSec: L.videoMaxSec, maxBytes: L.videoMaxBytes };
}

function checkVideo(add, platform, format, a) {
  const L = LIMITS[platform];
  const at = { assetId: a.id };
  const lim = videoLimits(platform, format);
  const container = a.format ?? (a.mime === 'video/quicktime' ? 'mov' : 'mp4');
  if (L.videoContainers && !L.videoContainers.includes(container)) add('error', 'v_video_format', 'media', { format: container, allowed: L.videoContainers.join(', ') }, at);
  if (L.videoCodecs && a.videoCodec && !L.videoCodecs.includes(a.videoCodec)) add('error', 'v_video_codec', 'media', { codec: a.videoCodec, allowed: L.videoCodecs.join(', ') }, at);
  if (L.audioCodecs && a.audioCodec && !L.audioCodecs.includes(a.audioCodec)) add('error', 'v_video_codec', 'media', { codec: a.audioCodec, allowed: L.audioCodecs.join(', ') }, at);
  if (a.durationMs == null) add('warn', 'v_video_unprobed', 'media', {}, at);
  else if (a.durationMs < lim.minSec * 1000 || a.durationMs > lim.maxSec * 1000) {
    add('error', 'v_video_duration', 'media', { minSec: lim.minSec, maxSec: lim.maxSec, actualSec: round2(a.durationMs / 1000) }, at);
  }
  if (a.bytes > lim.maxBytes) add('error', 'v_video_too_large', 'media', { maxMb: mb(lim.maxBytes), actualMb: mb(a.bytes) }, at);
  if (L.fpsMin != null && a.fps != null && (a.fps < L.fpsMin - 0.5 || a.fps > L.fpsMax + 0.5)) add('warn', 'v_video_fps', 'media', { min: L.fpsMin, max: L.fpsMax, actual: round2(a.fps) }, at);
  const ratio = displayRatio(a);
  if (lim.ratio && ratio != null && Math.abs(ratio - lim.ratio) > RECOMMENDED_RATIO_TOLERANCE) add('warn', 'v_video_ratio_recommended', 'media', { recommended: '9:16', actual: round2(ratio) }, at);
}

function checkMedia(add, platform, format, rule, media) {
  if (media.length < rule.min || media.length > rule.max) add('error', 'v_media_count', 'media', { min: rule.min, max: rule.max, actual: media.length });
  for (const a of media) {
    if (!rule.kinds.includes(a.kind)) { add('error', 'v_media_kind', 'media', { kind: a.kind, format }, { assetId: a.id }); continue; }
    if (a.kind === 'image') checkImage(add, platform, format, a);
    else checkVideo(add, platform, format, a);
  }
  const ratios = media.map(displayRatio);
  if ((format === 'carousel' || format === 'album') && ratios[0] != null && ratios.some((r) => r != null && Math.abs(r - ratios[0]) > 0.01)) {
    add('warn', 'v_carousel_crop', 'media', { ratio: round2(ratios[0]) });
  }
}

function checkSchedule(add, platform, target, scheduledAt, now, firstComment) {
  if (target.mode !== 'native') return;
  if (!PUBLISH_CAPABILITIES[platform].nativeSchedule) { add('error', 'v_native_unsupported', 'mode'); return; }
  if (firstComment) add('warn', 'v_first_comment_native', 'firstComment');
  if (scheduledAt == null) return;
  const L = LIMITS[platform];
  const lead = scheduledAt - now;
  if (lead < L.nativeMinLeadMin * 60_000 || lead > L.nativeMaxLeadDays * 86_400_000) {
    add('error', 'v_native_window', 'scheduledAt', { minMinutes: L.nativeMinLeadMin, maxDays: L.nativeMaxLeadDays });
  }
}

function checkContext(add, platform, target, { post, media, context, firstComment }) {
  const caps = PUBLISH_CAPABILITIES[platform];
  if (needsPublicUrl(platform, target.format, media) && (context.mediaHostType ?? 'none') === 'none') add('error', 'v_media_host_missing', 'mediaHost');
  const missing = context.missingScopes?.[platform];
  if (missing?.length) {
    const publish = missing.filter((s) => caps.publishScopes.includes(s));
    if (publish.length) add('error', 'v_missing_scope', 'account', { scopes: publish.join(', ') });
    if (firstComment && missing.includes(caps.firstCommentScope)) add('warn', 'v_missing_scope', 'firstComment', { scopes: caps.firstCommentScope });
  }
  const quota = context.quota?.[target.accountId];
  if (quota?.total && quota.used >= quota.total * QUOTA_WARN_RATIO) add('warn', 'v_quota_near', 'account', { used: quota.used, total: quota.total });
  const gapMs = (context.minGapHours ?? 0) * 3_600_000;
  if (gapMs > 0 && post.scheduledAt != null) {
    const clash = (context.existing ?? []).find((e) => e.accountId === target.accountId && e.postId !== post.id && e.scheduledAt != null && Math.abs(e.scheduledAt - post.scheduledAt) < gapMs);
    if (clash) add('warn', 'v_min_gap', 'scheduledAt', { hours: context.minGapHours, ref: clash.ref ?? null, at: clash.scheduledAt });
  }
}

function validateTarget(target, { post, media, now, context }) {
  const platform = target.platform;
  const { issues, add } = makeSink({ platform, targetId: target.id ?? null, accountId: target.accountId ?? null });
  const caps = PUBLISH_CAPABILITIES[platform];
  const rule = formatRule(platform, target.format);
  if (!caps || !rule) { add('error', 'v_format_unsupported', 'format', { format: target.format ?? null }); return issues; }
  const caption = target.captionOverride ?? post.caption ?? '';
  const firstComment = target.firstCommentOverride ?? post.firstComment ?? null;

  if (rule.captionIgnored) { if (caption.trim()) add('info', 'v_story_caption_ignored', 'caption'); }
  else checkText(add, platform, caption, 'caption');
  if (rule.requiresText && !caption.trim()) add('error', 'v_text_required', 'caption');
  if (rule.requiresLink && !isHttpUrl(target.options?.link)) add('error', 'v_link_required', 'options.link');
  if (firstComment) {
    if (rule.noComments || !caps.firstComment) add('warn', 'v_first_comment_unsupported', 'firstComment');
    else checkText(add, platform, firstComment, 'firstComment');
  }
  checkMedia(add, platform, target.format, rule, media);
  checkSchedule(add, platform, target, post.scheduledAt ?? null, now, firstComment);
  checkContext(add, platform, target, { post, media, context, firstComment });
  return issues;
}

/** @returns {Issue[]} post-level issues first, then per target in order. */
export function validate({ post = {}, targets = [], assets = [], now = Date.now(), context = {} }) {
  const out = [];
  const postIssue = (level, code, field, params = {}) => out.push({ level, code, platform: null, targetId: null, accountId: null, assetId: null, field, params });
  if (!targets.length) postIssue('error', 'v_no_targets', 'targets');
  if (post.scheduledAt != null && post.scheduledAt < now - LIMITS.common.pastGraceMs) postIssue('error', 'v_schedule_past', 'scheduledAt', { at: post.scheduledAt });
  const media = assets.filter((a) => (a.role ?? 'media') === 'media');
  for (const target of targets) out.push(...validateTarget(target, { post, media, now, context }));
  return out;
}

/** Convenience: true when there is at least one error. */
export function hasErrors(issues) {
  return issues.some((i) => i.level === 'error');
}
