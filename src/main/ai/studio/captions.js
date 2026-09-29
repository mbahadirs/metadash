import { getAccount } from '../../db/queries/accounts.js';
import { listMedia } from '../../db/queries/media.js';
import { getAsset, getPost } from '../../db/queries/planner.js';
import { insertCaptionVariants, chooseCaptionVariant } from '../../db/queries/studio.js';
import { getConfig } from '../../config/store.js';
import { limit } from '../../publishing/limits.js';
import { validate, countGraphemes } from '../../publishing/validate.js';
import { extractTags, suggestHashtags, RECOMMENDED_TAGS } from '../../analytics/hashtags.js';
import { AiError } from '../errors.js';
import { fitWithin } from '../vision.js';
import { progressBus } from '../../sync/progress.js';
import { runGeneration, studioCapabilities } from './runtime.js';
import { voiceContext } from './voice.js';
import {
  captionSchema, captionSystemPrompt, captionUserText, shortenSystemPrompt, shortenUserText, SHORTEN_SCHEMA, EXAMPLES_MAX, NOTES_MAX,
} from './prompts/captions.js';

/**
 * Caption variants (v1.5 chunk B). Platform constraints come from publishing/limits.js (strictest selected platform;
 * when Threads is mixed with others each variant also gets a ≤ 500-char threadsText). Every variant is checked with
 * publishing/validate.js; over-limit variants get one automatic "shorten to N" call.
 */
export const CAPTION_PLATFORMS = ['instagram', 'facebook', 'threads'];
const LANGS = ['tr', 'en'];
const MAX_TOTAL = 6;
const MAX_ACCOUNTS = 10;
const MAX_ASSETS = 10;
const IMAGES_MAX = 4;
const EXAMPLE_DAYS = 365;
const DAY = 86_400_000;
const TAGS_IN_PROMPT = 10;
/** Representative caption-bearing format per platform, used only to run the caption checks of validate(). */
const CHECK_FORMAT = { instagram: 'image', facebook: 'text', threads: 'text' };
const LETTERS = 'ABCDEF';

const bad = (field) => new AiError('ai_bad_input', { vars: { field } });

/** Normalizes and validates a studio:captions:generate payload. */
export function normalizeCaptionInput(p = {}) {
  const accountIds = Array.isArray(p.accountIds) ? [...new Set(p.accountIds.filter((x) => typeof x === 'string' && x))] : [];
  if (!accountIds.length || accountIds.length > MAX_ACCOUNTS) throw bad('accountIds');
  const accounts = accountIds.map((id) => getAccount(id));
  if (accounts.some((a) => !a)) throw bad('accountIds');
  const platforms = p.platforms == null ? [...new Set(accounts.map((a) => a.platform ?? 'instagram'))] : p.platforms;
  if (!Array.isArray(platforms) || !platforms.length || platforms.some((x) => !CAPTION_PLATFORMS.includes(x))) throw bad('platforms');
  const cfgLangs = (() => { try { return getConfig('studio.captionLangs'); } catch { return null; } })();
  const langs = [...new Set(p.langs ?? cfgLangs ?? ['tr'])].filter((l) => LANGS.includes(l));
  if (!langs.length) throw bad('langs');
  const variants = p.variants == null ? 3 : p.variants;
  if (!Number.isInteger(variants) || variants < 1 || variants > 5) throw bad('variants');
  if (p.notes != null && (typeof p.notes !== 'string' || p.notes.length > NOTES_MAX * 2)) throw bad('notes');
  const assetIds = p.assetIds == null ? [] : p.assetIds;
  if (!Array.isArray(assetIds) || assetIds.length > MAX_ASSETS || assetIds.some((x) => !Number.isInteger(x) || x <= 0)) throw bad('assetIds');
  if (p.postId != null && (!Number.isInteger(p.postId) || !getPost(p.postId))) throw bad('postId');
  const altTexts = p.altTexts && typeof p.altTexts === 'object' ? p.altTexts : {};
  return {
    accountIds, platforms: CAPTION_PLATFORMS.filter((x) => platforms.includes(x)), langs, perLang: Math.max(1, Math.min(variants, Math.floor(MAX_TOTAL / langs.length))),
    notes: (p.notes ?? '').trim(), assetIds, postId: p.postId ?? null, altTexts, requestId: p.requestId,
  };
}

/** Strictest limits over the selected platforms; Threads mixed with others gets its own threadsText. */
export function captionConstraints(platforms) {
  const nonThreads = platforms.filter((x) => x !== 'threads');
  const withThreads = platforms.includes('threads') && nonThreads.length > 0;
  const main = nonThreads.length ? nonThreads : ['threads'];
  const maxChars = Math.min(...main.map((x) => limit(x, 'captionMax')));
  const hashtagMax = main.includes('threads') ? limit('threads', 'topicTagsMax') : main.includes('instagram') ? limit('instagram', 'hashtagsMax') : 30;
  const hashtagRecommended = Math.min(...main.map((x) => RECOMMENDED_TAGS[x] ?? 5));
  return { platforms, maxChars, hashtagMax, hashtagRecommended, withThreads, threadsMax: limit('threads', 'captionMax'), mainPlatforms: main };
}

/** Caption-level issues for one variant (validate() with a synthetic target per platform; media checks ignored). */
export function checkVariant(v, c) {
  const issues = [];
  const charCounts = {};
  for (const platform of c.platforms) {
    const text = platform === 'threads' && c.withThreads ? v.threadsText ?? '' : v.text;
    charCounts[platform] = countGraphemes(text);
    const found = validate({ post: { caption: text }, targets: [{ platform, accountId: null, format: CHECK_FORMAT[platform] }] })
      .filter((i) => i.field === 'caption' && i.code !== 'v_links_not_clickable');
    issues.push(...found);
  }
  return { charCounts, issues };
}

const overLimit = (issues) => issues.some((i) => i.code === 'v_caption_too_long');

/** Alt texts, file names (only when the model can't see the images) → image notes. */
function imageNotes(assetIds, altTexts, { visionOn }) {
  const out = [];
  for (const id of assetIds) {
    const a = getAsset(id);
    if (!a) continue;
    const alt = String(altTexts[id] ?? '').trim().slice(0, 300);
    const name = visionOn ? null : String(a.fileName ?? '').replace(/\.[a-z0-9]+$/i, '').slice(0, 80);
    const bits = [`${a.kind === 'video' ? 'video' : 'image'} ${out.length + 1}`, alt ? `alt text: ${alt}` : null, name ? `file name: ${name}` : null].filter(Boolean);
    out.push(bits.join(' — '));
  }
  return out;
}

/** The account's best past captions (style examples) and tested hashtags, from local data only. */
function accountContext(accountId, notes, platform, now) {
  const examples = listMedia({ igIds: [accountId], from: now - EXAMPLE_DAYS * DAY, to: now, sort: 'reach', limit: 30 })
    .filter((p) => String(p.caption ?? '').trim().length > 20).slice(0, EXAMPLES_MAX);
  const tags = suggestHashtags({ accountId, caption: '', notes, platform, count: TAGS_IN_PROMPT, now }).tested;
  return { examples, tags };
}

/** Everything the generate call would send (shared with the studio:preview builder). */
export function buildCaptionRequest(input, { visionOn, now = Date.now() }) {
  const c = captionConstraints(input.platforms);
  const primary = input.accountIds[0];
  const voice = voiceContext(primary);
  const { examples, tags } = accountContext(primary, input.notes, c.mainPlatforms[0], now);
  const imgIds = input.assetIds.filter((id) => getAsset(id));
  const notesForImages = imageNotes(imgIds, input.altTexts, { visionOn });
  const imageCount = visionOn ? Math.min(IMAGES_MAX, imgIds.length) : 0;
  const system = captionSystemPrompt(c);
  const userText = captionUserText({
    notes: input.notes, brief: voice?.brief, facts: voice?.facts, examples, imageNotes: notesForImages, tags, langs: input.langs, perLang: input.perLang, imageCount,
  });
  return {
    c, system, userText, imageIds: visionOn ? imgIds.slice(0, IMAGES_MAX) : [], total: input.perLang * input.langs.length,
    sentSummary: { captions: examples.length, chars: userText.length, notesChars: input.notes.length, briefChars: voice?.brief?.length ?? 0, tags: tags.length, variants: input.perLang * input.langs.length },
    items: [
      ...(voice ? [{ kind: 'text', label: 'brief', chars: (voice.brief ?? '').length }] : []),
      { kind: 'text', label: 'notes', chars: input.notes.length },
      ...(examples.length ? [{ kind: 'text', label: 'example_captions', count: examples.length, chars: examples.reduce((s, e) => s + Math.min(500, e.caption.length), 0), ids: examples.map((e) => e.mediaId) }] : []),
      ...(tags.length ? [{ kind: 'table', label: 'hashtag_stats', count: tags.length }] : []),
      ...(notesForImages.length ? [{ kind: 'text', label: 'image_notes', count: notesForImages.length }] : []),
      ...(imageCount ? [{ kind: 'image', label: 'images', count: imageCount, ids: imgIds.slice(0, IMAGES_MAX) }] : []),
    ],
  };
}

function labelFor(lang, i, multi) {
  return multi ? `${lang.toUpperCase()}-${LETTERS[i]}` : LETTERS[i];
}

/** Model variants → labelled, checked variants (at most perLang per language, in language order). */
export function shapeVariants(raw, input, c) {
  const out = [];
  for (const lang of input.langs) {
    raw.filter((v) => v.lang === lang).slice(0, input.perLang).forEach((v, i) => {
      const text = v.text.trim();
      const threadsText = c.withThreads ? String(v.threadsText ?? '').trim() : undefined;
      const variant = { label: labelFor(lang, i, input.langs.length > 1), lang, angle: v.angle.trim().slice(0, 40), text, ...(c.withThreads ? { threadsText } : {}) };
      out.push({ ...variant, hashtags: extractTags(text), ...checkVariant(variant, c) });
    });
  }
  return out;
}

/** One "shorten to N" call for every over-limit text (main text and/or threadsText). */
async function shortenOverLimit(variants, c, structured) {
  const jobs = [];
  for (const v of variants) {
    if (!overLimit(v.issues)) continue;
    const mainOver = v.issues.some((i) => i.code === 'v_caption_too_long' && i.platform !== 'threads') || (!c.withThreads && overLimit(v.issues));
    const threadsOver = c.withThreads && v.issues.some((i) => i.code === 'v_caption_too_long' && i.platform === 'threads');
    if (mainOver) jobs.push({ id: `${v.label}:text`, text: v.text, max: Math.floor(c.maxChars * 0.95) });
    if (threadsOver) jobs.push({ id: `${v.label}:threadsText`, text: v.threadsText, max: Math.floor(c.threadsMax * 0.95) });
  }
  if (!jobs.length) return { variants, usage: null, shortened: 0 };
  const res = await structured({ system: shortenSystemPrompt(), userText: shortenUserText(jobs), schema: SHORTEN_SCHEMA, name: 'emit_shortened', maxTokens: 4000 });
  const byId = new Map(res.data.items.map((i) => [i.id, i.text.trim()]));
  const next = variants.map((v) => {
    const text = byId.get(`${v.label}:text`) ?? v.text;
    const threadsText = byId.get(`${v.label}:threadsText`) ?? v.threadsText;
    if (text === v.text && threadsText === v.threadsText) return v;
    const patched = { ...v, text, ...(c.withThreads ? { threadsText } : {}) };
    return { ...patched, hashtags: extractTags(text), ...checkVariant(patched, c), shortened: true };
  });
  return { variants: next, usage: res.usage, shortened: jobs.length };
}

const addUsage = (a, b) => (b ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens } : a);

/**
 * studio:captions:generate → { variants, generationId, usage, costUsd, visionUsed, visionDropped, skippedImages, shortened }.
 * When postId is given the variants are stored in caption_variants (replacing earlier ones).
 */
export async function generateCaptions(payload = {}, deps = {}) {
  const input = normalizeCaptionInput(payload);
  const now = deps.now ?? Date.now();
  // runGeneration reads meta.sentSummary lazily when it records the call; the request is built inside fn (needs caps).
  let summary = {};
  const meta = {
    feature: 'caption', requestId: input.requestId, accountIds: input.accountIds, postId: input.postId,
    get sentSummary() { return summary; },
    output: (r) => r.variants.map(({ label, lang, angle, text }) => ({ label, lang, angle, text })),
  };
  const out = await runGeneration(
    meta,
    async ({ caps, structured, images }) => {
      const visionOn = caps.vision !== false && input.assetIds.length > 0;
      const req = buildCaptionRequest(input, { visionOn, now });
      summary = req.sentSummary;
      const prepared = req.imageIds.length ? await images(req.imageIds, { max: IMAGES_MAX, ...(deps.imageOpts ?? {}) }) : { images: [], skipped: [] };
      const res = await structured({ system: req.system, userText: req.userText, images: prepared.images, schema: captionSchema(input.langs, req.total, req.c.withThreads), name: 'emit_captions', maxTokens: 4000 });
      const shaped = shapeVariants(res.data.variants, input, req.c);
      const short = await shortenOverLimit(shaped, req.c, structured);
      return {
        variants: short.variants, usage: addUsage(res.usage, short.usage), shortened: short.shortened,
        visionUsed: prepared.images.length > 0 && !res.visionDropped, visionDropped: !!res.visionDropped,
        visionUnavailable: caps.vision === false && input.assetIds.length > 0,
        skippedImages: prepared.skipped.length,
      };
    },
    deps,
  );
  if (input.postId != null && out.variants.length) insertCaptionVariants(input.postId, out.variants, { generationId: out.generationId, now });
  return out;
}

/** studio:preview 'caption' builder (same prompt builder, no call). */
export async function captionPreview(params = {}, deps = {}) {
  const input = normalizeCaptionInput(params);
  const caps = deps.caps ?? (await studioCapabilities());
  const visionOn = caps.vision !== false && input.assetIds.length > 0;
  const req = buildCaptionRequest(input, { visionOn });
  const images = req.imageIds.map((id) => {
    const a = getAsset(id);
    return fitWithin(a?.width || 1080, a?.height || 1080, 1568);
  });
  return { items: req.items, text: `${req.system}\n${req.userText}`, images, expectedOutputTokens: 350 * req.total };
}

/** studio:captions:save { postId, variants:[{label, lang?, angle?, text}], chosenLabel? } → stored rows. */
export function saveCaptions({ postId, variants, chosenLabel } = {}) {
  if (!Number.isInteger(postId) || !getPost(postId)) throw bad('postId');
  if (chosenLabel != null && typeof chosenLabel !== 'string') throw bad('chosenLabel');
  if (variants == null && chosenLabel) return chooseCaptionVariant(postId, chosenLabel);
  if (!Array.isArray(variants) || variants.length > 20) throw bad('variants');
  const clean = variants.map((v) => {
    if (!v || typeof v.label !== 'string' || !v.label || v.label.length > 10 || typeof v.text !== 'string' || v.text.length > 70_000) throw bad('variants');
    return { label: v.label, lang: LANGS.includes(v.lang) ? v.lang : null, angle: typeof v.angle === 'string' ? v.angle.slice(0, 40) : null, text: v.text };
  });
  const rows = insertCaptionVariants(postId, clean, { chosenLabel: chosenLabel ?? null });
  progressBus.emit('studio:changed', { kind: 'captions', postIds: [postId] });
  return rows;
}
