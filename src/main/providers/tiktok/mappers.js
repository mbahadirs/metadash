import meta from './meta.js';

/** Pure TikTok → MetaDash mappers. */
export const tiktokKey = (openId) => `${meta.keyPrefix}${openId}`;
export const tiktokMediaId = (videoId) => `${meta.keyPrefix}${videoId}`;
export const PRODUCT_TYPE = 'TIKTOK';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** user/info user object → Profile (stats undefined when user.info.stats was not granted). */
export function mapProfile(u = {}) {
  return {
    username: u.username || u.display_name || String(u.open_id ?? ''),
    name: u.display_name ?? null,
    profilePicUrl: u.avatar_url ?? null,
    biography: u.bio_description ?? null,
    website: u.profile_deep_link ?? null,
    followers: num(u.follower_count),
    follows: num(u.following_count),
    mediaCount: num(u.video_count),
  };
}

/** Canonical post metrics of a video object (only those present). */
export function videoValues(v = {}) {
  const out = {};
  for (const [from, to] of [['view_count', 'views'], ['like_count', 'likes'], ['comment_count', 'comments'], ['share_count', 'shares']]) {
    const n = num(v[from]);
    if (n !== undefined) out[to] = n;
  }
  return out;
}

/** video/list video → Post. Caption: the description (the post text), else the title. */
export function mapVideo(v) {
  const id = String(v.id);
  return {
    mediaId: tiktokMediaId(id),
    externalId: id,
    mediaType: 'VIDEO',
    mediaProductType: PRODUCT_TYPE,
    caption: v.video_description || v.title || '',
    permalink: v.share_url ?? v.embed_link ?? null,
    thumbnailUrl: v.cover_image_url ?? null,
    timestamp: new Date(Number(v.create_time) * 1000).toISOString(),
    durationS: num(v.duration) ?? null,
    inline: videoValues(v),
  };
}
