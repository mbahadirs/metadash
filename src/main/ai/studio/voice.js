import { isSupportedLang } from '../../locales/catalog.js';
import { listMedia, mediaTypeKey } from '../../db/queries/media.js';
import { getAccount } from '../../db/queries/accounts.js';
import { getBrandVoice, upsertBrandVoice } from '../../db/queries/studio.js';
import { currentLang } from '../../i18n.js';
import { AiError } from '../errors.js';
import { fitWithin } from '../vision.js';
import { progressBus } from '../../sync/progress.js';
import { extractTags, fold } from '../../analytics/hashtags.js';
import { mean, median, round, percentileRank } from '../../analytics/util.js';
import { runGeneration, visionAllowed, studioCapabilities } from './runtime.js';
import { VOICE_SCHEMA, VOICE_TOP_MAX, VOICE_LOW_MAX, VOICE_CAPTION_MAX, BRIEF_MAX, voiceSystemPrompt, voiceUserText } from './prompts/voice.js';

/**
 * Brand voice (v1.5 chunk B): deterministic caption stats (no AI), AI-derived proposals and the stored brief/profile.
 * A derived voice is only a proposal; the user edits and saves it (source ai | ai_edited). Works without AI: the
 * stats-only profile plus a manual brief.
 */
const DAY = 86_400_000;
const WINDOW_DAYS = 365;
const LOW_N = 10;
const N_MAX = 100;
const IMAGES_MAX = 6;
const PROFILE_MAX_CHARS = 20_000;
const THUMB_ASSUMED = { w: 1080, h: 1080 };
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const TRAILING_TAGS_RE = /(?:\s*#[\p{L}\p{N}_]+)+\s*$/u;
const TR_CHARS_RE = /[çğıöşü]/gu;
const TR_WORDS = new Set(['ve', 'bir', 'bu', 'için', 'ile', 'çok', 'da', 'de', 'ne', 'gibi', 'daha', 'mi', 'olan', 'ama', 'şimdi', 'hemen', 'yeni', 'kadar', 'her', 'sizin', 'bizim', 'hadi']);
const EN_WORDS = new Set(['the', 'and', 'you', 'for', 'with', 'this', 'is', 'to', 'of', 'your', 'our', 'in', 'it', 'on', 'are', 'we', 'now', 'new', 'get', 'all', 'what', 'how']);
const SIZ_RE = /\b(siz|sizin|sizi|size|sizler|sizde)\b/u;
const SEN_RE = /\b(sen|senin|seni|sana|sende)\b/u;
/** CTA keywords (folded) → label. Presence per caption; the top 5 are reported. */
const CTA_WORDS = ['link in bio', 'comment', 'save', 'share', 'tag', 'dm', 'shop', 'order', 'click', 'swipe', 'follow', 'link', 'bio', 'yorum', 'kaydet', 'paylas', 'etiketle', 'tikla', 'siparis', 'profil', 'takip', 'kesfet', 'mesaj'];
export const VOICE_SOURCES = ['manual', 'ai', 'ai_edited'];

/** Simple TR/EN heuristic: Turkish letters + stopwords vs English stopwords. null when unclear. */
export function detectLang(text) {
  const lower = String(text ?? '').toLocaleLowerCase('tr');
  const words = lower.split(/[^\p{L}]+/u).filter(Boolean);
  const tr = words.filter((w) => TR_WORDS.has(w)).length + Math.min(5, (lower.match(TR_CHARS_RE) ?? []).length) * 0.5;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  if (tr === en) return null;
  return tr > en ? 'tr' : 'en';
}

function tagPlacement(caption) {
  const tags = extractTags(caption);
  if (!tags.length) return null;
  const trailing = extractTags(caption.match(TRAILING_TAGS_RE)?.[0] ?? '');
  if (trailing.length === tags.length) return 'end';
  return trailing.length ? 'mixed' : 'inline';
}

const share = (n, total) => (total ? round(n / total, 3) : 0);

/** Deterministic caption statistics (same input → same output). posts: [{ caption }]. */
export function voiceStats(posts) {
  const caps = posts.map((p) => String(p.caption ?? '')).filter((c) => c.trim());
  const n = caps.length;
  const lengths = caps.map((c) => Array.from(c).length);
  const emojiCounts = new Map();
  let emojiTotal = 0;
  let emojiPosts = 0;
  const places = { end: 0, inline: 0, mixed: 0 };
  const cta = new Map();
  const langs = { tr: 0, en: 0 };
  let tagTotal = 0;
  let questions = 0;
  let mentions = 0;
  let lineBreaks = 0;
  let sen = 0;
  let siz = 0;
  for (const c of caps) {
    const emojis = c.match(EMOJI_RE) ?? [];
    emojiTotal += emojis.length;
    if (emojis.length) emojiPosts += 1;
    for (const e of emojis) emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);
    tagTotal += extractTags(c).length;
    const place = tagPlacement(c);
    if (place) places[place] += 1;
    if (c.includes('?')) questions += 1;
    if (/@[\p{L}\p{N}_.]+/u.test(c)) mentions += 1;
    if (c.includes('\n')) lineBreaks += 1;
    const folded = fold(c);
    for (const w of CTA_WORDS) if (folded.includes(w)) cta.set(w, (cta.get(w) ?? 0) + 1);
    const lang = detectLang(c);
    if (lang) langs[lang] += 1;
    const lower = c.toLocaleLowerCase('tr');
    if (SIZ_RE.test(lower)) siz += 1;
    if (SEN_RE.test(lower)) sen += 1;
  }
  const tagged = places.end + places.inline + places.mixed;
  const placement = !tagged ? 'none' : places.end / tagged > 0.6 ? 'end' : places.inline / tagged > 0.6 ? 'inline' : 'mixed';
  const byCount = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return {
    posts: n,
    avgLength: round(mean(lengths), 0) ?? 0,
    medianLength: round(median(lengths), 0) ?? 0,
    emojiRate: n ? round(emojiTotal / n, 2) : 0,
    emojiPostShare: share(emojiPosts, n),
    emojiSet: byCount(emojiCounts).slice(0, 8).map(([e]) => e),
    hashtagHabit: { avgCount: n ? round(tagTotal / n, 1) : 0, placement },
    questionRate: share(questions, n),
    mentionRate: share(mentions, n),
    lineBreakRate: share(lineBreaks, n),
    ctaWords: byCount(cta).slice(0, 5).map(([word, c]) => ({ word, share: share(c, n) })),
    languages: Object.entries(langs).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([lang, c]) => ({ lang, share: share(c, n) })),
    pronoun: siz > sen && siz >= 2 ? 'siz' : sen > siz && sen >= 2 ? 'sen' : null,
  };
}

const exposure = (p) => ((p.platform ?? 'instagram') === 'threads' ? p.views : p.reach);

/**
 * Picks the account's top-n captioned posts of the last 12 months by combined exposure/ER percentile, plus up to 10
 * low performers (not in the top set) as a contrast set. Returns { all, top, low } (media rows).
 */
export function selectVoicePosts(accountId, { n = 50, now = Date.now() } = {}) {
  const all = listMedia({ igIds: [accountId], from: now - WINDOW_DAYS * DAY, to: now, sort: 'date' }).filter((p) => String(p.caption ?? '').trim());
  const exp = all.map(exposure);
  const ers = all.map((p) => p.engagementRate);
  const scored = all.map((p) => ({ p, score: percentileRank(exposure(p), exp) + percentileRank(p.engagementRate, ers) }))
    .sort((a, b) => b.score - a.score || b.p.postedAt - a.p.postedAt);
  const top = scored.slice(0, n).map((s) => s.p);
  const topIds = new Set(top.map((p) => p.mediaId));
  const low = scored.filter((s) => !topIds.has(s.p.mediaId)).slice(-LOW_N).reverse().map((s) => s.p);
  return { all, top, low };
}

function requireAccount(accountId) {
  if (typeof accountId !== 'string' || !accountId || accountId.length > 100) throw new AiError('ai_bad_input', { vars: { field: 'accountId' } });
  const account = getAccount(accountId);
  if (!account) throw new AiError('ai_bad_input', { vars: { field: 'accountId' } });
  return account;
}

const pickLang = (lang) => (isSupportedLang(lang) ? lang : currentLang());
const clampN = (n) => (Number.isInteger(n) && n >= 5 ? Math.min(n, N_MAX) : 50);

/** Everything the derive call would send; shared by the real call and the studio:preview builder. */
export function buildVoiceRequest({ accountId, n, lang, useImages = false, now = Date.now() }) {
  const { all, top, low } = selectVoicePosts(accountId, { n: clampN(n), now });
  const stats = voiceStats(all);
  const topSent = top.slice(0, VOICE_TOP_MAX);
  const lowSent = low.slice(0, VOICE_LOW_MAX);
  const imageSources = useImages && visionAllowed()
    ? top.filter((p) => /^https:\/\//i.test(p.thumbnailPath ?? '') && mediaTypeKey(p) !== 'text').slice(0, IMAGES_MAX).map((p) => ({ url: p.thumbnailPath, mediaId: p.mediaId }))
    : [];
  const system = voiceSystemPrompt(pickLang(lang));
  const userText = voiceUserText({ stats, top: topSent, low: lowSent, imageCount: imageSources.length });
  const sentCaptions = [...topSent, ...lowSent];
  return {
    stats, top, system, userText, imageSources,
    sentSummary: { captions: sentCaptions.length, chars: userText.length, images: 0 },
    items: [
      { kind: 'table', label: 'voice_stats', chars: JSON.stringify(stats).length },
      { kind: 'text', label: 'captions', count: sentCaptions.length, chars: sentCaptions.reduce((s, p) => s + Math.min(VOICE_CAPTION_MAX, String(p.caption).length), 0), ids: sentCaptions.map((p) => p.mediaId) },
      ...(imageSources.length ? [{ kind: 'image', label: 'top_post_images', count: imageSources.length, ids: imageSources.map((s) => s.mediaId) }] : []),
    ],
  };
}

/** Model output + deterministic stats → stored profile shape (stats win for the measured fields). */
export function mergeProfile(data, stats, top) {
  return {
    tone: data.tone ?? [],
    formality: data.formality,
    ...(data.pronoun === 'sen' || data.pronoun === 'siz' ? { pronoun: data.pronoun } : {}),
    ctaPatterns: data.ctaPatterns ?? [],
    hooks: data.hooks ?? [],
    doList: data.doList ?? [],
    dontList: data.dontList ?? [],
    ...(data.visualStyle ? { visualStyle: data.visualStyle } : {}),
    avgLength: stats.avgLength,
    emojiRate: stats.emojiRate,
    emojiSet: stats.emojiSet,
    hashtagHabit: stats.hashtagHabit,
    languages: stats.languages.map((l) => l.lang),
    sampleMediaIds: top.slice(0, 10).map((p) => p.mediaId),
  };
}

/** studio:voice:derive → { proposal: { brief, profile }, stats, usage, costUsd, generationId, visionUsed, visionDropped }. */
export async function deriveVoice({ accountId, n, lang, requestId, useImages = false } = {}, deps = {}) {
  requireAccount(accountId);
  const req = buildVoiceRequest({ accountId, n, lang, useImages: useImages === true, now: deps.now });
  if (!req.stats.posts) throw new AiError('voice_no_posts');
  const out = await runGeneration(
    { feature: 'voice', requestId, accountId, sentSummary: req.sentSummary, output: (r) => r.data },
    async ({ structured, images }) => {
      const imgs = req.imageSources.length ? (await images(req.imageSources, { max: IMAGES_MAX, ...(deps.imageOpts ?? {}) })).images : [];
      const res = await structured({ system: req.system, userText: req.userText, images: imgs, schema: VOICE_SCHEMA, name: 'emit_brand_voice', maxTokens: 3000 });
      return { ...res, imageCount: imgs.length };
    },
    deps,
  );
  const profile = mergeProfile(out.data, req.stats, req.top);
  return {
    proposal: { brief: out.data.brief, profile },
    stats: req.stats,
    derivedFrom: req.sentSummary.captions,
    usage: out.usage, costUsd: out.costUsd, generationId: out.generationId, provider: out.provider, model: out.model,
    visionUsed: out.imageCount > 0 && !out.visionDropped, visionDropped: !!out.visionDropped,
  };
}

/** studio:preview 'voice' builder. */
export async function voicePreview(params = {}, deps = {}) {
  requireAccount(params.accountId);
  const caps = params.useImages === true ? deps.caps ?? (await studioCapabilities()) : null;
  const req = buildVoiceRequest({ accountId: params.accountId, n: params.n, lang: params.lang, useImages: params.useImages === true && caps?.vision !== false });
  return { items: req.items, text: `${req.system}\n${req.userText}`, images: req.imageSources.map(() => fitWithin(THUMB_ASSUMED.w, THUMB_ASSUMED.h, 1568)), expectedOutputTokens: 900 };
}

/** studio:voice:get → stored voice (or an empty manual one) with local stats; null for an unknown account. */
export function getVoice({ accountId } = {}, { now = Date.now() } = {}) {
  if (typeof accountId !== 'string' || !getAccount(accountId)) return null;
  const { all } = selectVoicePosts(accountId, { n: 0, now });
  const stats = voiceStats(all);
  const voice = getBrandVoice(accountId) ?? { accountId, brief: '', profile: null, source: 'manual', derivedFrom: null, derivedAt: null, provider: null, model: null, aiDisabled: false, updatedAt: 0 };
  return { ...voice, stats };
}

const stringList = (v, max, itemMax) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, max).map((x) => x.trim().slice(0, itemMax)) : undefined);

/** Validates a profile coming from the renderer: known list/scalar fields only, bounded sizes. */
export function cleanProfile(p) {
  if (p == null) return null;
  if (typeof p !== 'object' || Array.isArray(p)) throw new AiError('ai_bad_input', { vars: { field: 'profile' } });
  const out = {};
  for (const k of ['tone', 'ctaPatterns', 'hooks', 'doList', 'dontList', 'emojiSet', 'languages', 'sampleMediaIds']) {
    const list = stringList(p[k], 20, 200);
    if (list) out[k] = list;
  }
  if (['casual', 'neutral', 'formal'].includes(p.formality)) out.formality = p.formality;
  if (p.pronoun === 'sen' || p.pronoun === 'siz') out.pronoun = p.pronoun;
  if (typeof p.visualStyle === 'string' && p.visualStyle.trim()) out.visualStyle = p.visualStyle.trim().slice(0, 600);
  for (const k of ['avgLength', 'emojiRate']) if (Number.isFinite(p[k])) out[k] = p[k];
  if (p.hashtagHabit && Number.isFinite(p.hashtagHabit.avgCount)) out.hashtagHabit = { avgCount: p.hashtagHabit.avgCount, placement: String(p.hashtagHabit.placement ?? 'none').slice(0, 20) };
  if (JSON.stringify(out).length > PROFILE_MAX_CHARS) throw new AiError('ai_bad_input', { vars: { field: 'profile' } });
  return out;
}

/**
 * studio:voice:save { accountId, brief?, profile?, aiDisabled?, source?, derived?: { provider, model, derivedFrom } }.
 * Omitted fields keep their stored values. Returns the saved voice.
 */
export function saveVoice(payload = {}, { now = Date.now() } = {}) {
  const { accountId } = payload;
  requireAccount(accountId);
  const patch = {};
  if ('brief' in payload) {
    if (typeof payload.brief !== 'string' || payload.brief.length > BRIEF_MAX * 2) throw new AiError('ai_bad_input', { vars: { field: 'brief' } });
    patch.brief = payload.brief;
  }
  if ('profile' in payload) patch.profile = cleanProfile(payload.profile);
  if ('aiDisabled' in payload) patch.aiDisabled = payload.aiDisabled === true;
  if (payload.source !== undefined) {
    if (!VOICE_SOURCES.includes(payload.source)) throw new AiError('ai_bad_input', { vars: { field: 'source' } });
    patch.source = payload.source;
  }
  const d = payload.derived;
  if (d && typeof d === 'object') {
    patch.provider = typeof d.provider === 'string' ? d.provider.slice(0, 40) : null;
    patch.model = typeof d.model === 'string' ? d.model.slice(0, 100) : null;
    patch.derivedFrom = Number.isInteger(d.derivedFrom) ? d.derivedFrom : null;
    patch.derivedAt = now;
  }
  const saved = upsertBrandVoice(accountId, patch, { now });
  progressBus.emit('studio:changed', { kind: 'voice', accountIds: [accountId] });
  return saved;
}

/** Compact voice context for other generators (captions, hashtags): the brief plus a few profile fields. */
export function voiceContext(accountId) {
  const v = getBrandVoice(accountId);
  if (!v || (!v.brief?.trim() && !v.profile)) return null;
  const p = v.profile ?? {};
  const facts = [
    p.tone?.length ? `tone: ${p.tone.join(', ')}` : null,
    p.formality ? `formality: ${p.formality}` : null,
    p.pronoun ? `address the reader with "${p.pronoun}"` : null,
    Number.isFinite(p.avgLength) ? `typical length: ~${p.avgLength} characters` : null,
    Number.isFinite(p.emojiRate) ? `emoji per post: ~${p.emojiRate}${p.emojiSet?.length ? ` (${p.emojiSet.join(' ')})` : ''}` : null,
    p.hashtagHabit ? `hashtags: ~${p.hashtagHabit.avgCount} per post, placed ${p.hashtagHabit.placement}` : null,
    p.doList?.length ? `do: ${p.doList.join('; ')}` : null,
    p.dontList?.length ? `don't: ${p.dontList.join('; ')}` : null,
  ].filter(Boolean);
  return { brief: v.brief ?? '', facts };
}
