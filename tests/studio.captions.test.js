import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tempDb, addAccount, addPosts, fakeProvider, CAPS } from './fixtures/studioData.js';
import { setConfig } from '../src/main/config/store.js';
import { createPost, insertAsset } from '../src/main/db/queries/planner.js';
import { listCaptionVariants, upsertBrandVoice } from '../src/main/db/queries/studio.js';
import { captionConstraints, checkVariant, normalizeCaptionInput, generateCaptions, saveCaptions, captionPreview } from '../src/main/ai/studio/captions.js';
import { suggestTags, applyAiOrder, cleanUntested } from '../src/main/ai/studio/hashtags.js';

const NOW = Date.UTC(2026, 8, 15, 12);
const LONG = `${'Uzun bir açıklama cümlesi. '.repeat(100)}#kahve`; // > 2200 chars
const variants = (list) => ({ variants: list });

let cleanup;
let postId;
let assetId;
beforeAll(() => {
  cleanup = tempDb('metadash-captions-');
  addAccount('ig1', { platform: 'instagram' });
  addAccount('fb1', { platform: 'facebook' });
  addAccount('th1', { platform: 'threads' });
  addPosts('ig1', Array.from({ length: 12 }, (_, i) => ({ id: `ig1_${i}`, caption: `Great coffee story number ${i} for you #kahve #latte${i % 2}`, reach: 1000 + i * 100, daysAgo: 3 + i * 4 })), NOW);
  postId = createPost({ caption: '', targets: [] }, { now: NOW });
  assetId = insertAsset({ sha256: 'abc', fileName: 'autumn-latte-art.jpg', storedPath: '/nowhere/a.jpg', mime: 'image/jpeg', kind: 'image', width: 3000, height: 2000 }, { now: NOW }).id;
  upsertBrandVoice('ig1', { brief: 'Warm and short. Use "sen".', profile: { tone: ['warm'] } });
  setConfig('ai.enabled', true);
});
afterAll(() => cleanup());

describe('platform constraints', () => {
  it('uses the strictest selected platform, and a separate Threads text when Threads is mixed in', () => {
    expect(captionConstraints(['threads'])).toMatchObject({ maxChars: 500, hashtagMax: 1, withThreads: false });
    expect(captionConstraints(['instagram', 'facebook'])).toMatchObject({ maxChars: 2200, hashtagMax: 30, withThreads: false, hashtagRecommended: 3 });
    expect(captionConstraints(['instagram', 'threads'])).toMatchObject({ maxChars: 2200, withThreads: true, threadsMax: 500 });
  });

  it('checks each variant with validate() per platform', () => {
    const c = captionConstraints(['instagram', 'threads']);
    const { charCounts, issues } = checkVariant({ text: LONG, threadsText: 'kısa #a #b' }, c);
    expect(charCounts.instagram).toBeGreaterThan(2200);
    expect(charCounts.threads).toBe(10);
    expect(issues.map((i) => `${i.platform}:${i.code}`)).toEqual(['instagram:v_caption_too_long', 'threads:v_topic_tags_many']);
  });

  it('validates the payload', () => {
    expect(() => normalizeCaptionInput({ accountIds: [] })).toThrow();
    expect(() => normalizeCaptionInput({ accountIds: ['ig1'], platforms: ['myspace'] })).toThrow();
    expect(() => normalizeCaptionInput({ accountIds: ['ig1'], variants: 9 })).toThrow();
    expect(() => normalizeCaptionInput({ accountIds: ['ig1'], postId: 999 })).toThrow();
    expect(normalizeCaptionInput({ accountIds: ['ig1', 'th1'], langs: ['tr', 'en'], variants: 3 })).toMatchObject({ platforms: ['instagram', 'threads'], perLang: 3 });
  });
});

describe('generateCaptions', () => {
  it('returns labelled variants with char counts, saves them and records the call', async () => {
    const p = fakeProvider([variants([
      { lang: 'tr', angle: 'question-hook', text: 'Sonbahar geldi mi? ☕️ #kahve' },
      { lang: 'tr', angle: 'story', text: 'Bu sabah... #latte0' },
      { lang: 'tr', angle: 'benefit', text: 'Daha lezzetli bir mola için.' },
    ])]);
    const out = await generateCaptions({ accountIds: ['ig1'], postId, langs: ['tr'], notes: 'Yeni sonbahar menüsü', assetIds: [assetId] }, { provider: p, caps: { ...CAPS, vision: false }, now: NOW });
    expect(out.variants.map((v) => v.label)).toEqual(['A', 'B', 'C']);
    expect(out.variants[0]).toMatchObject({ lang: 'tr', angle: 'question-hook', hashtags: ['#kahve'], charCounts: { instagram: 27 }, issues: [] });
    expect(out).toMatchObject({ visionUsed: false, visionUnavailable: true, shortened: 0 });
    const text = p.calls[0].messages[0].content;
    expect(text).toContain('<brief>');
    expect(text).toContain('Warm and short');
    expect(text).toContain('<notes>\nYeni sonbahar menüsü');
    expect(text).toContain('file name: autumn-latte-art'); // no vision → the file name describes the image
    expect(text).toContain('<tested_hashtags');
    expect(text).toContain('<examples');
    expect(text).not.toContain('ig1');
    expect(p.calls[0].system).toContain('at most 2200 characters');
    expect(listCaptionVariants(postId).map((v) => v.label)).toEqual(['A', 'B', 'C']);
    expect(listCaptionVariants(postId)[0].generationId).toBe(out.generationId);
  });

  it('makes one shorten call for over-limit variants (Threads only → 500 chars)', async () => {
    const p = fakeProvider([
      variants([{ lang: 'en', angle: 'story', text: 'x'.repeat(620) }, { lang: 'en', angle: 'benefit', text: 'Short and sweet.' }]),
      (req) => ({ items: [{ id: 'A:text', text: `${'y'.repeat(400)} ${req.messages[0].content.includes('max_chars="475"') ? 'ok' : 'bad'}` }] }),
    ]);
    const out = await generateCaptions({ accountIds: ['th1'], langs: ['en'], variants: 2 }, { provider: p, caps: CAPS, now: NOW });
    expect(p.calls).toHaveLength(2);
    expect(p.calls[1].system).toContain('shorten');
    expect(out.variants[0]).toMatchObject({ shortened: true, issues: [] });
    expect(out.variants[0].text.endsWith('ok')).toBe(true);
    expect(out.variants[1].shortened).toBeUndefined();
    expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 100 });
  });

  it('adds a Threads text per variant when Threads is mixed with other platforms; labels per language', async () => {
    const p = fakeProvider([variants([
      { lang: 'tr', angle: 'story', text: 'Uzun IG metni', threadsText: 'Kısa Threads' },
      { lang: 'en', angle: 'story', text: 'Long IG text', threadsText: 'Short Threads' },
    ])]);
    const out = await generateCaptions({ accountIds: ['ig1', 'th1'], langs: ['tr', 'en'], variants: 1 }, { provider: p, caps: CAPS, now: NOW });
    expect(out.variants.map((v) => v.label)).toEqual(['TR-A', 'EN-A']);
    expect(out.variants[0]).toMatchObject({ threadsText: 'Kısa Threads', charCounts: { instagram: 13, threads: 12 } });
    expect(p.calls[0].system).toContain('threadsText');
  });

  it('never calls the provider for an opted-out account', async () => {
    upsertBrandVoice('fb1', { aiDisabled: true });
    const p = fakeProvider([variants([])]);
    await expect(generateCaptions({ accountIds: ['ig1', 'fb1'], langs: ['en'] }, { provider: p, caps: CAPS })).rejects.toMatchObject({ key: 'ai_account_disabled' });
    expect(p.calls).toHaveLength(0);
  });

  it('preview lists what will be sent without calling a model', async () => {
    const prev = await captionPreview({ accountIds: ['ig1'], langs: ['tr'], notes: 'n', assetIds: [assetId] }, { caps: CAPS });
    expect(prev.items.map((i) => i.label)).toEqual(expect.arrayContaining(['brief', 'notes', 'example_captions', 'hashtag_stats']));
    expect(prev.text).toContain('<notes>');
    expect(prev.images).toEqual([{ w: 1568, h: 1045 }]);
    const noVision = await captionPreview({ accountIds: ['ig1'], langs: ['tr'], assetIds: [assetId] }, { caps: { ...CAPS, vision: false } });
    expect(noVision.images).toEqual([]);
    expect(noVision.text).toContain('file name: autumn-latte-art');
  });

  it('studio:captions:save stores variants and marks the chosen one', () => {
    const rows = saveCaptions({ postId, variants: [{ label: 'A', lang: 'en', angle: 'story', text: 'one' }, { label: 'B', text: 'two' }], chosenLabel: 'B' });
    expect(rows.map((r) => [r.label, r.chosen])).toEqual([['A', false], ['B', true]]);
    expect(saveCaptions({ postId, chosenLabel: 'A' }).map((r) => r.chosen)).toEqual([true, false]);
    expect(() => saveCaptions({ postId: 12345, variants: [] })).toThrow();
    expect(() => saveCaptions({ postId, variants: [{ label: '', text: 'x' }] })).toThrow();
  });
});

describe('studio:hashtags:suggest', () => {
  it('works without AI from the account history', async () => {
    const res = await suggestTags({ accountId: 'ig1', platform: 'instagram', caption: 'coffee' }, { now: NOW });
    expect(res.tested.map((t) => t.tag)).toEqual(expect.arrayContaining(['#kahve', '#latte0', '#latte1']));
    expect(res.usage).toBeUndefined();
  });

  it('with AI the model may only re-order tested tags and add ≤ 3 labelled untested ones', async () => {
    const p = fakeProvider([{ order: ['#latte1', 'kahve', '#invented', '#latte1'], untested: [{ tag: 'fallcoffee', reason: 'seasonal' }, { tag: '#kahve', reason: 'dup' }, { tag: '#a b', reason: 'bad' }, { tag: '#x1', reason: '' }, { tag: '#x2', reason: '' }, { tag: '#x3', reason: '' }] }]);
    const res = await suggestTags({ accountId: 'ig1', platform: 'instagram', useAi: true }, { provider: p, caps: CAPS, now: NOW });
    expect(res.tested.map((t) => t.tag)).toEqual(['#latte1', '#kahve']);
    expect(res.untested).toEqual([{ tag: '#fallcoffee', reason: 'seasonal' }, { tag: '#x1', reason: '' }, { tag: '#x2', reason: '' }]);
    expect(res.aiRanked).toBe(true);
    expect(res.generationId).toBeGreaterThan(0);
    expect(p.calls[0].messages[0].content).toContain('<tested_hashtags>');
  });

  it('helpers keep only known tags and valid new ones', () => {
    const tested = [{ tag: '#a' }, { tag: '#b' }];
    expect(applyAiOrder(tested, ['#b', '#zzz', 'a'], 5).map((t) => t.tag)).toEqual(['#b', '#a']);
    expect(applyAiOrder(tested, ['#b', '#a'], 1).map((t) => t.tag)).toEqual(['#b']);
    expect(cleanUntested([{ tag: '#a', reason: 'x' }, { tag: '#new_one', reason: 'y' }], new Set(['#a']))).toEqual([{ tag: '#new_one', reason: 'y' }]);
  });
});
