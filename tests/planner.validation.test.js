import { describe, it, expect } from 'vitest';
import { validate, countGraphemes, countHashtags, countMentions, countLinks, ISSUE_CODES } from '../src/main/publishing/validate.js';
import { LIMITS, listLimits, isVerify, limit } from '../src/main/publishing/limits.js';
import { inferFormat, needsPublicUrl, displayRatio } from '../src/main/publishing/capabilities.js';

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);
const HOUR = 3_600_000;
const MB = 1024 * 1024;

const img = (id, w = 1080, h = 1350, extra = {}) => ({ id, kind: 'image', mime: 'image/jpeg', format: 'jpeg', bytes: 500_000, width: w, height: h, rotation: 0, ...extra });
const vid = (id, extra = {}) => ({ id, kind: 'video', mime: 'video/mp4', format: 'mp4', bytes: 20 * MB, width: 1080, height: 1920, rotation: 0, durationMs: 15_000, videoCodec: 'avc1', audioCodec: 'mp4a', fps: 30, ...extra });
const ig = (format = 'image', extra = {}) => ({ id: 1, accountId: '17840000', platform: 'instagram', format, mode: 'app', ...extra });
const fb = (format = 'photo', extra = {}) => ({ id: 2, accountId: 'fb-1', platform: 'facebook', format, mode: 'app', ...extra });
const th = (format = 'text', extra = {}) => ({ id: 3, accountId: 'th-1', platform: 'threads', format, mode: 'app', ...extra });
const S3 = { mediaHostType: 's3' };

function run({ caption = 'Hello', firstComment = null, scheduledAt = NOW + 2 * HOUR, targets, assets = [], context = S3 }) {
  return validate({ post: { id: 10, caption, firstComment, scheduledAt }, targets, assets, now: NOW, context });
}
const codes = (issues, level) => issues.filter((i) => !level || i.level === level).map((i) => i.code);

describe('counters', () => {
  it('counts graphemes, not UTF-16 units', () => {
    expect(countGraphemes('abc')).toBe(3);
    expect(countGraphemes('👍🏽')).toBe(1);
    expect(countGraphemes('👨‍👩‍👧‍👦x')).toBe(2);
    expect(countGraphemes('')).toBe(0);
  });
  it('counts hashtags, mentions and links', () => {
    expect(countHashtags('#a #b c#d #ç_1 ##')).toBe(3);
    expect(countMentions('@brand hi @other.name mail@x.com')).toBe(2);
    expect(countLinks('see https://a.com and www.b.com, http://c.io/x')).toBe(3);
  });
});

describe('caption length boundaries (graphemes)', () => {
  const max = LIMITS.instagram.captionMax;
  it.each([
    [max, []],
    [max + 1, ['v_caption_too_long']],
  ])('instagram %i chars', (n, errs) => {
    expect(codes(run({ caption: 'a'.repeat(n), targets: [ig()], assets: [img(1)] }), 'error')).toEqual(errs);
  });
  it('emoji count as one character each', () => {
    const caption = '👍🏽'.repeat(max);
    expect(codes(run({ caption, targets: [ig()], assets: [img(1)] }), 'error')).toEqual([]);
    expect(codes(run({ caption: caption + '👍🏽', targets: [ig()], assets: [img(1)] }), 'error')).toEqual(['v_caption_too_long']);
  });
  it('warns at 98 % of the limit', () => {
    const n = Math.ceil(max * 0.98);
    expect(codes(run({ caption: 'a'.repeat(n), targets: [ig()], assets: [img(1)] }), 'warn')).toContain('v_caption_near_limit');
    expect(codes(run({ caption: 'a'.repeat(n - 30), targets: [ig()], assets: [img(1)] }), 'warn')).not.toContain('v_caption_near_limit');
  });
  it('threads 500 and per-target caption override', () => {
    const issues = run({ caption: 'a'.repeat(100), targets: [th('text', { captionOverride: 'b'.repeat(501) })] });
    const err = issues.find((i) => i.code === 'v_caption_too_long');
    expect(err).toMatchObject({ platform: 'threads', targetId: 3, field: 'caption', params: { max: 500, actual: 501 } });
  });
  it('reports params with max/actual', () => {
    const [issue] = run({ caption: 'a'.repeat(max + 5), targets: [ig()], assets: [img(1)] }).filter((i) => i.code === 'v_caption_too_long');
    expect(issue).toMatchObject({ level: 'error', platform: 'instagram', targetId: 1, accountId: '17840000', params: { max, actual: max + 5 } });
  });
});

describe('hashtags, mentions and links', () => {
  const tags = (n) => Array.from({ length: n }, (_, i) => `#t${i}`).join(' ');
  it.each([[30, false], [31, true]])('instagram %i hashtags → error %s', (n, isErr) => {
    expect(codes(run({ caption: tags(n), targets: [ig()], assets: [img(1)] }), 'error').includes('v_hashtags_too_many')).toBe(isErr);
  });
  it('instagram mentions > 20 is an error', () => {
    const at = (n) => Array.from({ length: n }, (_, i) => `@u${i}`).join(' ');
    expect(codes(run({ caption: at(20), targets: [ig()], assets: [img(1)] }), 'error')).toEqual([]);
    expect(codes(run({ caption: at(21), targets: [ig()], assets: [img(1)] }), 'error')).toEqual(['v_mentions_too_many']);
  });
  it('instagram links are not clickable (info)', () => {
    expect(codes(run({ caption: 'go to https://x.com', targets: [ig()], assets: [img(1)] }), 'info')).toContain('v_links_not_clickable');
  });
  it('threads: >1 hashtag warns (topic tag), >5 links errors', () => {
    expect(codes(run({ caption: '#a #b', targets: [th()] }), 'warn')).toContain('v_topic_tags_many');
    const links = Array.from({ length: 6 }, (_, i) => `https://x${i}.com`).join(' ');
    expect(codes(run({ caption: links, targets: [th()] }), 'error')).toContain('v_links_too_many');
  });
  it('first comment is checked against the caption limit too', () => {
    const issues = run({ firstComment: tags(31), targets: [ig()], assets: [img(1)] });
    expect(issues.find((i) => i.code === 'v_hashtags_too_many')).toMatchObject({ field: 'firstComment' });
  });
});

describe('media count per format', () => {
  const imgs = (n) => Array.from({ length: n }, (_, i) => img(i + 1));
  it.each([
    [1, true], [2, false], [10, false], [11, true],
  ])('instagram carousel with %i items → error %s', (n, isErr) => {
    expect(codes(run({ targets: [ig('carousel')], assets: imgs(n) }), 'error').includes('v_media_count')).toBe(isErr);
  });
  it('rejects the wrong media kind and missing media', () => {
    expect(codes(run({ targets: [ig('image')], assets: [vid(1)] }), 'error')).toContain('v_media_kind');
    expect(codes(run({ targets: [ig('image')], assets: [] }), 'error')).toContain('v_media_count');
    expect(codes(run({ targets: [fb('album')], assets: [img(1), vid(2)] }), 'error')).toContain('v_media_kind');
    expect(codes(run({ targets: [th('text')], assets: [img(1)] }), 'error')).toContain('v_media_count');
  });
  it('ignores cover assets when counting', () => {
    expect(codes(run({ targets: [ig('reel')], assets: [vid(1), { ...img(2), role: 'cover' }] }), 'error')).toEqual([]);
  });
  it('rejects unsupported formats and requires at least one target', () => {
    expect(codes(run({ targets: [ig('album')], assets: [img(1)] }), 'error')).toEqual(['v_format_unsupported']);
    expect(codes(run({ targets: [] }), 'error')).toEqual(['v_no_targets']);
  });
  it('carousel ratio differences warn about cropping', () => {
    expect(codes(run({ targets: [ig('carousel')], assets: [img(1, 1080, 1080), img(2, 1080, 1350)] }), 'warn')).toContain('v_carousel_crop');
  });
});

describe('image rules', () => {
  it.each([
    [0.79, true], [0.8, false], [1.91, false], [1.92, true],
  ])('instagram aspect %f → error %s', (ratio, isErr) => {
    const a = img(1, Math.round(1000 * ratio), 1000);
    expect(codes(run({ targets: [ig()], assets: [a] }), 'error').includes('v_aspect_ratio')).toBe(isErr);
  });
  it('uses the display ratio after EXIF rotation', () => {
    expect(codes(run({ targets: [ig()], assets: [img(1, 1920, 1080, { rotation: 90 })] }), 'error')).toContain('v_aspect_ratio');
    expect(displayRatio({ width: 1350, height: 1080, rotation: 90 })).toBeCloseTo(0.8);
  });
  it('instagram converts PNG/WebP (info) and rejects GIF; big JPEG errors', () => {
    expect(codes(run({ targets: [ig()], assets: [img(1, 1080, 1080, { format: 'png', mime: 'image/png' })] }), 'info')).toContain('v_image_converted');
    expect(codes(run({ targets: [ig()], assets: [img(1, 1080, 1080, { format: 'gif', mime: 'image/gif' })] }), 'error')).toContain('v_image_format');
    expect(codes(run({ targets: [ig()], assets: [img(1, 1080, 1080, { bytes: 9 * MB })] }), 'error')).toContain('v_image_too_large');
    expect(codes(run({ targets: [ig()], assets: [img(1, 2160, 2160, { bytes: 9 * MB })] }), 'error')).not.toContain('v_image_too_large');
    expect(codes(run({ targets: [ig()], assets: [img(1, 2160, 2160)] }), 'info')).toContain('v_image_resized');
  });
  it('facebook accepts any ratio; threads ≤ 10:1', () => {
    expect(codes(run({ targets: [fb('photo')], assets: [img(1, 4000, 500)] }), 'error')).toEqual([]);
    expect(codes(run({ targets: [th('image')], assets: [img(1, 4000, 300)] }), 'error')).toContain('v_aspect_ratio');
    expect(codes(run({ targets: [fb('photo')], assets: [img(1, 1000, 1000, { bytes: 11 * MB })] }), 'error')).toContain('v_image_too_large');
  });
});

describe('video rules', () => {
  it.each([
    [2_000, true], [3_000, false], [900_000, false], [901_000, true],
  ])('instagram reel of %i ms → error %s', (ms, isErr) => {
    expect(codes(run({ targets: [ig('reel')], assets: [vid(1, { durationMs: ms })] }), 'error').includes('v_video_duration')).toBe(isErr);
  });
  it('reel codec, size, fps and 9:16 recommendation', () => {
    expect(codes(run({ targets: [ig('reel')], assets: [vid(1, { videoCodec: 'vp09' })] }), 'error')).toContain('v_video_codec');
    expect(codes(run({ targets: [ig('reel')], assets: [vid(1, { bytes: 301 * MB })] }), 'error')).toContain('v_video_too_large');
    expect(codes(run({ targets: [ig('reel')], assets: [vid(1, { fps: 15 })] }), 'warn')).toContain('v_video_fps');
    expect(codes(run({ targets: [ig('reel')], assets: [vid(1, { width: 1920, height: 1080 })] }), 'warn')).toContain('v_video_ratio_recommended');
  });
  it('unprobed video warns "duration not verified"', () => {
    const issues = run({ targets: [ig('reel')], assets: [vid(1, { durationMs: null })] });
    expect(codes(issues, 'warn')).toContain('v_video_unprobed');
    expect(codes(issues, 'error')).toEqual([]);
  });
  it('facebook reel 3–90 s, threads video ≤ 5 min', () => {
    expect(codes(run({ targets: [fb('reel')], assets: [vid(1, { durationMs: 91_000 })] }), 'error')).toContain('v_video_duration');
    expect(codes(run({ targets: [fb('video')], assets: [vid(1, { durationMs: 91_000 })] }), 'error')).toEqual([]);
    expect(codes(run({ targets: [th('video')], assets: [vid(1, { durationMs: 301_000 })] }), 'error')).toContain('v_video_duration');
  });
  it('instagram story: caption ignored, no first comment, video ≤ 60 s', () => {
    const issues = run({ caption: 'hi', firstComment: 'x', targets: [ig('story')], assets: [vid(1, { durationMs: 61_000 })] });
    expect(codes(issues, 'info')).toContain('v_story_caption_ignored');
    expect(codes(issues, 'warn')).toContain('v_first_comment_unsupported');
    expect(codes(issues, 'error')).toContain('v_video_duration');
  });
});

describe('text/link formats', () => {
  it('text formats need text; FB link needs a valid URL', () => {
    expect(codes(run({ caption: '  ', targets: [th('text')] }), 'error')).toContain('v_text_required');
    expect(codes(run({ caption: '', targets: [fb('text')] }), 'error')).toContain('v_text_required');
    expect(codes(run({ targets: [fb('link')] }), 'error')).toContain('v_link_required');
    expect(codes(run({ targets: [fb('link', { options: { link: 'javascript:alert(1)' } })] }), 'error')).toContain('v_link_required');
    expect(codes(run({ targets: [fb('link', { options: { link: 'https://example.com' } })] }), 'error')).toEqual([]);
  });
});

describe('cross-cutting checks', () => {
  it('scheduled time in the past is an error (1 min grace)', () => {
    expect(codes(run({ scheduledAt: NOW - 5 * 60_000, targets: [th()] }), 'error')).toEqual(['v_schedule_past']);
    expect(codes(run({ scheduledAt: NOW - 30_000, targets: [th()] }), 'error')).toEqual([]);
    expect(codes(run({ scheduledAt: null, targets: [th()] }), 'error')).toEqual([]);
  });
  it('no media host → error for IG images and Threads media, not for IG reels or FB', () => {
    const none = { mediaHostType: 'none' };
    expect(codes(run({ targets: [ig()], assets: [img(1)], context: none }), 'error')).toEqual(['v_media_host_missing']);
    expect(codes(run({ targets: [th('image')], assets: [img(1)], context: none }), 'error')).toEqual(['v_media_host_missing']);
    expect(codes(run({ targets: [th('video')], assets: [vid(1)], context: none }), 'error')).toEqual(['v_media_host_missing']);
    expect(codes(run({ targets: [ig('reel')], assets: [vid(1)], context: none }), 'error')).toEqual([]);
    expect(codes(run({ targets: [fb('photo')], assets: [img(1)], context: none }), 'error')).toEqual([]);
    expect(codes(run({ targets: [th('text')], context: {} }), 'error')).toEqual([]);
    expect(needsPublicUrl('instagram', 'carousel', [vid(1), img(2)])).toBe(true);
  });
  it('FB native scheduling window', () => {
    const min = LIMITS.facebook.nativeMinLeadMin * 60_000;
    const max = LIMITS.facebook.nativeMaxLeadDays * 86_400_000;
    const native = (scheduledAt) => codes(run({ scheduledAt, targets: [fb('photo', { mode: 'native' })], assets: [img(1)] }), 'error');
    expect(native(NOW + min - 60_000)).toEqual(['v_native_window']);
    expect(native(NOW + min + 60_000)).toEqual([]);
    expect(native(NOW + max - 60_000)).toEqual([]);
    expect(native(NOW + max + 60_000)).toEqual(['v_native_window']);
    expect(codes(run({ targets: [ig('image', { mode: 'native' })], assets: [img(1)] }), 'error')).toContain('v_native_unsupported');
  });
  it('first comment on FB native warns that it needs the app running', () => {
    expect(codes(run({ firstComment: 'x', targets: [fb('photo', { mode: 'native' })], assets: [img(1)] }), 'warn')).toContain('v_first_comment_native');
  });
  it('missing publish scope → error (only when readiness is known)', () => {
    const issues = run({ targets: [ig()], assets: [img(1)], context: { ...S3, missingScopes: { instagram: ['instagram_content_publish'] } } });
    expect(issues.find((i) => i.code === 'v_missing_scope')).toMatchObject({ level: 'error', params: { scopes: 'instagram_content_publish' } });
    const fc = run({ firstComment: 'hi', targets: [ig()], assets: [img(1)], context: { ...S3, missingScopes: { instagram: ['instagram_manage_comments'] } } });
    expect(fc.find((i) => i.code === 'v_missing_scope')).toMatchObject({ level: 'warn', field: 'firstComment' });
  });
  it('quota nearly exhausted and min gap warnings', () => {
    const context = { ...S3, quota: { '17840000': { used: 95, total: 100 } }, minGapHours: 3, existing: [{ postId: 99, ref: 'P-0099', accountId: '17840000', scheduledAt: NOW + 3 * HOUR }, { postId: 10, accountId: '17840000', scheduledAt: NOW + 2 * HOUR }] };
    const issues = run({ targets: [ig()], assets: [img(1)], context });
    expect(codes(issues, 'warn')).toEqual(expect.arrayContaining(['v_quota_near', 'v_min_gap']));
    expect(issues.find((i) => i.code === 'v_min_gap').params).toMatchObject({ hours: 3, ref: 'P-0099' });
    expect(issues.filter((i) => i.code === 'v_min_gap')).toHaveLength(1);
  });
  it('every emitted code is listed in ISSUE_CODES', () => {
    const all = [
      run({ caption: '#a '.repeat(40) + 'https://x.com', targets: [ig('carousel'), th('text'), fb('link')], assets: [img(1, 100, 1000, { format: 'gif' }), vid(2, { durationMs: null })], context: { mediaHostType: 'none' }, scheduledAt: NOW - HOUR }),
    ].flat();
    for (const i of all) expect(ISSUE_CODES).toContain(i.code);
  });
});

describe('limits table and format inference', () => {
  it('flags unverified limits and exposes plain values', () => {
    expect(isVerify('instagram', 'carouselMax')).toBe(true);
    expect(isVerify('instagram', 'captionMax')).toBe(false);
    expect(limit('threads', 'captionMax')).toBe(500);
    expect(() => limit('threads', 'nope')).toThrow();
    expect(listLimits().some((r) => r.platform === 'facebook' && r.key === 'nativeMaxLeadDays' && r.verify)).toBe(true);
  });
  it('infers formats from media', () => {
    expect(inferFormat('instagram', [img(1)])).toBe('image');
    expect(inferFormat('instagram', [img(1), img(2)])).toBe('carousel');
    expect(inferFormat('instagram', [vid(1)])).toBe('reel');
    expect(inferFormat('instagram', [])).toBeNull();
    expect(inferFormat('facebook', [])).toBe('text');
    expect(inferFormat('facebook', [vid(1)])).toBe('reel');
    expect(inferFormat('facebook', [vid(1, { width: 1920, height: 1080 })])).toBe('video');
    expect(inferFormat('facebook', [img(1), img(2)])).toBe('album');
    expect(inferFormat('threads', [vid(1)])).toBe('video');
  });
});
