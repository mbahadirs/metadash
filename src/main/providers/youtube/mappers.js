import meta from './meta.js';
import { STAT_METRICS, SHORTS_MAX_SECONDS } from './metrics.js';

/** YouTube API objects → provider contract shapes (providers/types.js). Pure and unit-tested. */
export const accountKey = (channelId) => `${meta.keyPrefix}${channelId}`;
export const videoKey = (videoId) => `${meta.keyPrefix}${videoId}`;
export const commentKey = (commentId) => `ytc-${commentId}`;
export const channelIdOf = (account) => account?.externalId && account.externalId !== account.igId ? account.externalId : String(account?.igId ?? '').replace(/^yt-/, '');
export const videoIdOf = (post) => post?.externalId && post.externalId !== post.mediaId ? post.externalId : String(post?.mediaId ?? '').replace(/^yt-/, '');
export const rawCommentId = (id) => String(id ?? '').replace(/^ytc-/, '');

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** ISO-8601 duration (videos.contentDetails.duration, e.g. PT1H2M3S, P1DT2S, P0D) → seconds, or null. */
export function parseIsoDuration(value) {
  const m = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(value ?? ''));
  if (!m || value === 'P' || value === 'PT') return null;
  const [w, d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0));
  return Math.round(w * 604_800 + d * 86_400 + h * 3600 + min * 60 + s);
}

/**
 * Product type: live streams (liveStreamingDetails) → YT_LIVE; Analytics creatorContentType when known (SHORTS →
 * YT_SHORT, LIVE_STREAM → YT_LIVE, anything else → YT_VIDEO); otherwise the duration heuristic (≤ 180 s → YT_SHORT).
 * The Data API has no Shorts flag.
 */
export function productTypeOf({ durationS, live = false, contentType = null }) {
  if (live || contentType === 'LIVE_STREAM') return 'YT_LIVE';
  if (contentType === 'SHORTS') return 'YT_SHORT';
  if (contentType && contentType !== 'UNSPECIFIED') return 'YT_VIDEO';
  return durationS != null && durationS > 0 && durationS <= SHORTS_MAX_SECONDS ? 'YT_SHORT' : 'YT_VIDEO';
}

const thumb = (thumbnails) => thumbnails?.medium?.url ?? thumbnails?.high?.url ?? thumbnails?.default?.url ?? null;

/** channels.list item → Profile (+ uploads playlist / publishedAt for the provider cache). */
export function mapChannel(ch) {
  const s = ch?.snippet ?? {};
  const st = ch?.statistics ?? {};
  const handle = s.customUrl ? (s.customUrl.startsWith('@') ? s.customUrl : `@${s.customUrl}`) : null;
  return {
    channelId: String(ch.id),
    username: handle ? handle.slice(1) : s.title ?? String(ch.id), // like other platforms: stored without '@' (UI adds it)
    name: s.title ?? null,
    handle,
    profilePicUrl: thumb(s.thumbnails),
    biography: s.description ?? null,
    website: `https://www.youtube.com/${handle ?? `channel/${ch.id}`}`,
    // Rounded down to three significant figures by the API; hidden counts are unknown, not zero.
    followers: st.hiddenSubscriberCount ? null : num(st.subscriberCount),
    mediaCount: num(st.videoCount),
    uploadsPlaylistId: ch?.contentDetails?.relatedPlaylists?.uploads ?? null,
    publishedAt: s.publishedAt ?? null,
  };
}

/** Profile fields only (what platformAccount.js upserts). */
export function profileOf(channel) {
  const { username, name, profilePicUrl, biography, website, followers, mediaCount } = channel;
  return { username, name, profilePicUrl, biography, website, followers, mediaCount };
}

/** Real-time counts from videos.list statistics, canonical names. */
export function statsOf(video) {
  const out = {};
  for (const [k, c] of Object.entries(STAT_METRICS)) {
    const v = num(video?.statistics?.[k]);
    if (v != null) out[c] = v;
  }
  return out;
}

/** videos.list item → Post. `contentType` = Analytics creatorContentType when known. */
export function mapVideo(v, contentType = null) {
  const sn = v?.snippet ?? {};
  const durationS = parseIsoDuration(v?.contentDetails?.duration);
  const title = sn.title ?? '';
  const description = sn.description ?? '';
  return {
    mediaId: videoKey(v.id),
    externalId: String(v.id),
    mediaType: 'VIDEO',
    mediaProductType: productTypeOf({ durationS, live: !!v.liveStreamingDetails, contentType }),
    caption: description ? `${title}\n${description}` : title,
    permalink: `https://youtu.be/${v.id}`,
    thumbnailUrl: thumb(sn.thumbnails),
    timestamp: sn.publishedAt ?? new Date(0).toISOString(),
    durationS,
    inline: statsOf(v),
  };
}

/** Videos worth tracking: not private, not an upcoming/ongoing live placeholder. */
export const isTrackable = (v) => (v?.status?.privacyStatus ?? 'public') !== 'private' && !['upcoming', 'live'].includes(v?.snippet?.liveBroadcastContent);

function mapComment(c, { mediaId, accountId, channelId, videoId, parentId = null }) {
  const sn = c?.snippet ?? {};
  const authorId = sn.authorChannelId?.value ?? null;
  const id = String(c.id);
  return {
    commentId: commentKey(id),
    externalId: id,
    mediaId,
    accountId,
    platform: 'youtube',
    parentId,
    authorId,
    username: sn.authorDisplayName ?? '',
    text: sn.textOriginal ?? sn.textDisplay ?? '',
    likeCount: num(sn.likeCount) ?? 0,
    createdAt: Date.parse(sn.publishedAt ?? '') || 0,
    isFromOwner: !!authorId && authorId === channelId,
    permalink: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(id)}`,
    isHidden: false,
  };
}

/** commentThreads.list item (+ optional full reply list) → NormalizedComment[] (top-level first, then replies). */
export function mapThread(thread, { mediaId, accountId, channelId, videoId, replies } = {}) {
  const top = thread?.snippet?.topLevelComment;
  if (!top) return [];
  const base = { mediaId, accountId, channelId, videoId: videoId ?? thread.snippet.videoId };
  const first = mapComment(top, base);
  const list = replies ?? thread.replies?.comments ?? [];
  return [first, ...list.map((r) => mapComment(r, { ...base, parentId: first.commentId }))];
}

const GENDERS = Object.freeze({ female: 'F', male: 'M', user_specified: 'U' });

/** ageGroup/gender rows ({ageGroup:'age25-34', gender:'female', viewerPercentage}) + country rows → dimensions. */
export function mapDemographics(ageGender = [], country = []) {
  const dimensions = {};
  const ga = ageGender
    .filter((r) => r.ageGroup && r.gender && Number.isFinite(Number(r.viewerPercentage)))
    .map((r) => ({ bucket: `${GENDERS[r.gender] ?? 'U'}.${String(r.ageGroup).replace(/^age/, '')}`, value: Number(r.viewerPercentage) }));
  if (ga.length) dimensions.gender_age = ga;
  const co = country.filter((r) => r.country && Number.isFinite(Number(r.views))).map((r) => ({ bucket: String(r.country), value: Number(r.views) }));
  if (co.length) dimensions.country = co;
  return dimensions;
}
