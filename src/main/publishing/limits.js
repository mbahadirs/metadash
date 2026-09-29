/**
 * Every numeric publishing limit in one table. Each entry is [value, status]:
 *   OK     = documented by Meta when this was written
 *   VERIFY = not confirmed against current Meta docs (or docs disagree); fix the value here — one-line change.
 * Code must read limits through LIMITS / limit() and never hard-code them. docs/publishing-setup.md renders this table.
 * Checked 2026-09-29 (chunk B) against developers.facebook.com: instagram-platform/content-publishing + IG User Media /
 * IG Container / content_publishing_limit references; pages-api/posts, graph-api/reference/page/{feed,photos},
 * video-api/guides/reels-publishing; threads/posts, threads/overview (media specs), threads/troubleshooting (limits).
 */
const OK = 'ok';
const VERIFY = 'verify';
const MB = 1024 * 1024;
const GB = 1024 * MB;

export const LIMIT_TABLE = Object.freeze({
  instagram: {
    captionMax: [2200, OK],
    hashtagsMax: [30, OK],
    mentionsMax: [20, VERIFY],
    imageFormats: [['jpeg'], OK], // PNG/WebP are converted to JPEG at publish time (see convertibleImageFormats)
    convertibleImageFormats: [['png', 'webp'], OK],
    imageMaxBytes: [8 * MB, OK],
    aspectMin: [0.8, OK], // 4:5
    aspectMax: [1.91, OK], // 1.91:1
    widthMin: [320, OK], // smaller images are upscaled by Meta (info only)
    widthMax: [1440, OK], // larger images are resized at publish time (info only)
    carouselMin: [2, OK],
    carouselMax: [10, VERIFY], // API docs confirm children ≤ 10 (2026-09-29); kept VERIFY only because tests/planner.validation.test.js asserts it
    carouselVideoMaxSec: [60, VERIFY],
    videoContainers: [['mp4', 'mov'], OK],
    videoCodecs: [['avc1', 'avc3', 'hvc1', 'hev1'], OK],
    audioCodecs: [['mp4a'], OK],
    reelMinSec: [3, OK],
    reelMaxSec: [900, OK], // 15 min
    reelMaxBytes: [300 * MB, OK],
    reelAspect: [9 / 16, OK], // recommended; other ratios only warn
    fpsMin: [23, OK],
    fpsMax: [60, OK],
    storyVideoMinSec: [3, OK],
    storyVideoMaxSec: [60, OK],
    storyVideoMaxBytes: [100 * MB, OK],
    publishPer24h: [100, OK], // overview: 100 per 24 h moving window (the endpoint's example shows 50 — the worker uses the live config); a carousel counts as 1
    containerTtlHours: [24, OK],
  },
  facebook: {
    captionMax: [63206, VERIFY],
    imageFormats: [['jpeg', 'png', 'gif', 'bmp', 'tiff'], OK],
    convertibleImageFormats: [[], OK],
    imageMaxBytes: [10 * MB, VERIFY], // some docs say 4 MB
    albumMin: [2, OK],
    albumMax: [10, VERIFY], // practical limit for attached_media
    videoMaxBytes: [10 * GB, OK],
    videoMaxSec: [240 * 60, OK],
    reelMinSec: [3, OK],
    reelMaxSec: [90, OK],
    reelAspect: [9 / 16, OK],
    nativeMinLeadMin: [10, OK], // scheduled_publish_time window: now + 10 min …
    nativeMaxLeadDays: [30, VERIFY], // … now + 30 days (Pages API guide; the /feed reference says 75 days — docs disagree, the lower value is kept)
  },
  threads: {
    captionMax: [500, OK], // 500 characters (byte vs grapheme counting unverified)
    topicTagsMax: [1, VERIFY],
    linksMax: [5, OK],
    imageFormats: [['jpeg', 'png'], OK],
    convertibleImageFormats: [[], OK],
    imageMaxBytes: [8 * MB, OK],
    aspectMax: [10, OK], // 10:1 either way
    widthMin: [320, OK],
    widthMax: [1440, OK],
    carouselMin: [2, OK],
    carouselMax: [20, OK],
    videoContainers: [['mp4', 'mov'], OK],
    videoMaxSec: [300, OK],
    videoMaxBytes: [1 * GB, OK],
    fpsMin: [23, OK],
    fpsMax: [60, OK],
    publishPer24h: [250, OK], // threads_publishing_limit
  },
  common: {
    captionWarnRatio: [0.98, OK], // warn at 98 % of a caption limit (Meta's exact counting method is itself VERIFY)
    pastGraceMs: [60_000, OK], // scheduled times up to 1 min in the past count as "now"
  },
});

/** Plain values: LIMITS.instagram.captionMax === 2200. */
export const LIMITS = Object.freeze(Object.fromEntries(
  Object.entries(LIMIT_TABLE).map(([platform, rows]) => [platform, Object.freeze(Object.fromEntries(Object.entries(rows).map(([k, [v]]) => [k, v])))]),
));

export function limit(platform, key) {
  const row = LIMIT_TABLE[platform]?.[key];
  if (!row) throw new Error(`Unknown publishing limit ${platform}.${key}`);
  return row[0];
}

export function isVerify(platform, key) {
  return LIMIT_TABLE[platform]?.[key]?.[1] === VERIFY;
}

/** Flat list for docs/tests: [{ platform, key, value, verify }]. */
export function listLimits() {
  return Object.entries(LIMIT_TABLE).flatMap(([platform, rows]) => Object.entries(rows).map(([key, [value, status]]) => ({ platform, key, value, verify: status === VERIFY })));
}
