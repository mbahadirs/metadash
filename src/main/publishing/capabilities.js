import { LIMITS } from './limits.js';

/**
 * What each platform can publish (separate from the analytics capabilities in providers/capabilities.js).
 *  formats            publishable formats (planner_targets.format)
 *  nativeSchedule     platform-side scheduling exists (FB scheduled_publish_time → target mode 'native')
 *  needsPublicUrl     media kinds Meta must fetch from a public URL (→ a media host is required)
 *  firstComment       first-comment support and the scope it needs (VERIFY for FB/Threads)
 *  publishScopes      scopes required to publish at all
 */
export const PUBLISH_CAPABILITIES = Object.freeze({
  instagram: Object.freeze({
    formats: Object.freeze(['image', 'carousel', 'reel', 'story']),
    nativeSchedule: false,
    needsPublicUrl: Object.freeze({ image: true, video: false }), // video uses resumable upload (rupload)
    firstComment: true,
    firstCommentScope: 'instagram_manage_comments',
    publishScopes: Object.freeze(['instagram_content_publish']),
  }),
  facebook: Object.freeze({
    formats: Object.freeze(['text', 'link', 'photo', 'album', 'video', 'reel']),
    nativeSchedule: true,
    needsPublicUrl: Object.freeze({ image: false, video: false }), // multipart `source` upload
    firstComment: true,
    firstCommentScope: 'pages_manage_engagement',
    publishScopes: Object.freeze(['pages_manage_posts']),
  }),
  threads: Object.freeze({
    formats: Object.freeze(['text', 'image', 'video', 'carousel']),
    nativeSchedule: false,
    needsPublicUrl: Object.freeze({ image: true, video: true }), // VERIFY: no resumable upload
    firstComment: true, // published as a reply
    firstCommentScope: 'threads_manage_replies',
    publishScopes: Object.freeze(['threads_content_publish']),
  }),
});

export const PUBLISH_PLATFORMS = Object.freeze(Object.keys(PUBLISH_CAPABILITIES));

/**
 * Media rules per platform/format: allowed asset kinds and item count.
 * `captionIgnored` = the platform drops the caption (IG stories). `requiresText` = text is the whole post.
 */
export const FORMAT_RULES = Object.freeze({
  instagram: {
    image: { kinds: ['image'], min: 1, max: 1 },
    carousel: { kinds: ['image', 'video'], min: LIMITS.instagram.carouselMin, max: LIMITS.instagram.carouselMax },
    reel: { kinds: ['video'], min: 1, max: 1 },
    story: { kinds: ['image', 'video'], min: 1, max: 1, captionIgnored: true, noComments: true },
  },
  facebook: {
    text: { kinds: [], min: 0, max: 0, requiresText: true },
    link: { kinds: [], min: 0, max: 0, requiresLink: true },
    photo: { kinds: ['image'], min: 1, max: 1 },
    album: { kinds: ['image'], min: LIMITS.facebook.albumMin, max: LIMITS.facebook.albumMax },
    video: { kinds: ['video'], min: 1, max: 1 },
    reel: { kinds: ['video'], min: 1, max: 1 },
  },
  threads: {
    text: { kinds: [], min: 0, max: 0, requiresText: true },
    image: { kinds: ['image'], min: 1, max: 1 },
    video: { kinds: ['video'], min: 1, max: 1 },
    carousel: { kinds: ['image', 'video'], min: LIMITS.threads.carouselMin, max: LIMITS.threads.carouselMax },
  },
});

export function publishCapabilitiesFor(platform) {
  return PUBLISH_CAPABILITIES[platform] ?? null;
}

export function formatRule(platform, format) {
  return FORMAT_RULES[platform]?.[format] ?? null;
}

/** Display aspect ratio (width / height after rotation) or null when unknown. */
export const displayRatio = (a) => {
  if (!a?.width || !a?.height) return null;
  const swap = a.rotation === 90 || a.rotation === 270;
  return swap ? a.height / a.width : a.width / a.height;
};

const isVertical = (a) => { const r = displayRatio(a); return r != null && r < 0.7; };

/**
 * Default format for a platform given the media (composer auto-inference; the user can override).
 * 0 media → text (IG: null, IG always needs media); 1 image → image/photo; n → carousel/album;
 * 1 video → IG reel, FB reel when vertical else video, Threads video.
 * @param {'instagram'|'facebook'|'threads'} platform
 * @param {{ kind: 'image'|'video', width?: number, height?: number, rotation?: number }[]} media
 */
export function inferFormat(platform, media = []) {
  const n = media.length;
  if (platform === 'instagram') {
    if (!n) return null;
    if (n > 1) return 'carousel';
    return media[0].kind === 'video' ? 'reel' : 'image';
  }
  if (platform === 'facebook') {
    if (!n) return 'text';
    if (n > 1) return 'album';
    if (media[0].kind === 'video') return isVertical(media[0]) ? 'reel' : 'video';
    return 'photo';
  }
  if (platform === 'threads') {
    if (!n) return 'text';
    if (n > 1) return 'carousel';
    return media[0].kind === 'video' ? 'video' : 'image';
  }
  return null;
}

/** True when publishing this format needs at least one media file on a public URL. */
export function needsPublicUrl(platform, format, media = []) {
  const caps = PUBLISH_CAPABILITIES[platform];
  if (!caps) return false;
  return media.some((a) => caps.needsPublicUrl[a.kind] === true) && (formatRule(platform, format)?.max ?? 0) > 0;
}
