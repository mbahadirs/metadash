import { AiError } from '../errors.js';
import { assertAiEnabled } from '../settings.js';
import { currentLang, msg } from '../../i18n.js';
import { getAccount } from '../../db/queries/accounts.js';
import { getMedia, mediaTypeKey } from '../../db/queries/media.js';
import { getBrandVoice, setPostAiMeta } from '../../db/queries/studio.js';
import { createPost, getPost } from '../../db/queries/planner.js';
import { toTargets } from '../../planner/input.js';
import { LIMITS } from '../../publishing/limits.js';
import { countGraphemes } from '../../publishing/validate.js';
import { progressBus } from '../../sync/progress.js';
import { runGeneration, assertAccountsAllowed } from './runtime.js';
import {
  REPURPOSE_TARGETS, REPURPOSE_SCHEMAS, RP_CAPTION_SENT_MAX, RP_TRANSCRIPT_MAX, RP_BRIEF_MAX, THREADS_CHAIN_MAX, CAROUSEL_SLIDES, STORY_FRAMES,
  repurposeSystemPrompt, repurposeUserText, shortenUserText,
} from './prompts/repurpose.js';

/**
 * Repurpose one post into another format (v1.5 plan §5.5).
 *  runRepurpose       studio:repurpose          { source:{mediaId}|{postId}, to, lang, transcript? } → { draft, usage, costUsd, … }
 *  repurposeToDraft   studio:repurpose:toDraft  { source, to, draft, accountIds } → { postId } (planner draft, lineage kept)
 *  repurposePreview   studio:preview 'repurpose'
 * Threads posts are enforced at ≤ 500 characters: one automatic "shorten" call, then a hard cut as a last resort.
 */
export { REPURPOSE_TARGETS };
const LANGS = ['tr', 'en'];
const TITLE_MAX = 200;
const SLIDE_TITLE_MAX = 120;
const SLIDE_BODY_MAX = 600;
const FRAME_MAX = 300;
const MAX_ACCOUNTS = 10;
/** Publishing platforms and target formats that can carry each repurposed draft. */
export const DRAFT_TARGETS = {
  carousel: { instagram: 'carousel', facebook: 'album' },
  story: { instagram: 'story' },
  threads: { threads: 'text' },
  facebook: { facebook: 'text' },
};

const bad = (field) => new AiError('ai_bad_input', { vars: { field } });
const clip = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const anonymize = (text) => String(text ?? '').replace(/@[\p{L}\p{N}_](?:[\p{L}\p{N}_.]*[\p{L}\p{N}_])?/gu, '@mention');
const pad = (n) => String(n).padStart(2, '0');
const localDate = (ms) => { if (!ms) return null; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Caption limit per repurpose target (graphemes; Meta's exact counting is VERIFY in publishing/limits.js). */
export function limitFor(to) {
  if (to === 'threads') return LIMITS.threads.captionMax;
  if (to === 'facebook') return LIMITS.facebook.captionMax;
  return LIMITS.instagram.captionMax;
}

/** Cuts text to at most `max` graphemes, preferring a word boundary, and ends it with "…". */
export function clampText(text, max) {
  const s = String(text ?? '').trim();
  if (countGraphemes(s) <= max) return s;
  const seg = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : Array.from(s);
  let cut = seg.slice(0, max - 1).join('');
  const space = cut.search(/\s\S*$/);
  if (space > cut.length * 0.8) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

function sourceKey(source) {
  if (source && typeof source === 'object' && typeof source.mediaId === 'string' && source.mediaId && source.mediaId.length <= 128) return { mediaId: source.mediaId };
  if (source && typeof source === 'object' && Number.isInteger(source.postId) && source.postId > 0) return { postId: source.postId };
  throw bad('source');
}

/** The source post as the model will see it (anonymized, truncated) + the accounts involved (for the AI opt-out). */
export function loadSource(source) {
  const key = sourceKey(source);
  if (key.mediaId) {
    const m = getMedia(key.mediaId);
    if (!m) throw new AiError('rp_source_missing');
    return {
      key, accountIds: [m.igId], platform: m.platform ?? 'instagram', type: mediaTypeKey(m), date: localDate(m.postedAt), title: '',
      caption: anonymize(m.caption).slice(0, RP_CAPTION_SENT_MAX),
      metrics: { reach: m.reach, views: m.views, likes: m.likes, comments: m.comments, saved: m.saved, shares: m.shares, erPct: round(m.engagementRate), saveRatePct: round(m.saveRate) },
      label: m.permalink ?? m.mediaId,
    };
  }
  const post = getPost(key.postId);
  if (!post) throw new AiError('rp_source_missing');
  const first = post.targets[0];
  return {
    key, accountIds: post.targets.map((t) => t.accountId), platform: first?.platform ?? 'instagram', type: first?.format ?? 'post',
    date: localDate(post.scheduledAt), title: clip(post.title, TITLE_MAX), caption: anonymize(post.caption).slice(0, RP_CAPTION_SENT_MAX), metrics: null, label: post.ref,
  };
}

/** Validated studio:repurpose payload. */
export function sanitizeRepurposeInput(p = {}) {
  const to = REPURPOSE_TARGETS.includes(p.to) ? p.to : null;
  if (!to) throw bad('to');
  if (p.lang != null && !LANGS.includes(p.lang)) throw bad('lang');
  if (p.transcript != null && typeof p.transcript !== 'string') throw bad('transcript');
  return { source: sourceKey(p.source), to, lang: p.lang ?? currentLang(), transcript: anonymize(p.transcript ?? '').trim().slice(0, RP_TRANSCRIPT_MAX) };
}

function buildPrompt(input, src) {
  const brief = clip(getBrandVoice(src.accountIds[0])?.brief ?? '', RP_BRIEF_MAX);
  return {
    brief,
    system: repurposeSystemPrompt(input.lang, input.to, { limit: limitFor(input.to) }),
    userText: repurposeUserText(src, { brief, transcript: input.transcript }),
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * Normalizes a draft (model output or a renderer edit) for one target: trims, enforces counts and limits.
 * Returns { to, lang, title, caption, slides?, posts?, frames?, truncated }.
 */
export function normalizeDraft(to, raw = {}, { lang = currentLang() } = {}) {
  if (!REPURPOSE_TARGETS.includes(to)) throw bad('to');
  const d = raw && typeof raw === 'object' ? raw : {};
  const limit = limitFor(to);
  let truncated = false;
  const fit = (text, max) => { const out = clampText(text, max); if (out !== String(text ?? '').trim()) truncated = true; return out; };
  const base = { to, lang: LANGS.includes(d.lang) ? d.lang : lang, title: clip(d.title, TITLE_MAX) };
  if (to === 'carousel') {
    const slides = arr(d.slides).slice(0, CAROUSEL_SLIDES.max).map((s) => ({ title: clip(s?.title, SLIDE_TITLE_MAX), body: clip(s?.body, SLIDE_BODY_MAX) })).filter((s) => s.title || s.body);
    return { ...base, slides, caption: fit(d.caption, limit), truncated };
  }
  if (to === 'threads') {
    const posts = arr(d.posts).slice(0, THREADS_CHAIN_MAX).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).map((x) => fit(x, limit));
    return { ...base, posts, caption: posts[0] ?? '', truncated };
  }
  if (to === 'facebook') {
    const text = fit(d.text ?? d.caption, limit);
    return { ...base, text, caption: text, truncated };
  }
  const frames = arr(d.frames).slice(0, STORY_FRAMES.max).map((f) => ({ text: fit(typeof f === 'string' ? f : f?.text, FRAME_MAX) })).filter((f) => f.text);
  return { ...base, frames, caption: '', truncated };
}

const overLimit = (posts, limit) => posts.some((x) => countGraphemes(String(x ?? '')) > limit);
const addUsage = (a, b) => ({ inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0), outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0) });

/** studio:repurpose */
export async function runRepurpose(p = {}, { deps } = {}) {
  const input = sanitizeRepurposeInput(p);
  assertAiEnabled();
  const src = loadSource(input.source);
  assertAccountsAllowed(src.accountIds);
  if (!src.caption && !input.transcript && !src.title) throw new AiError('rp_source_empty');
  const { system, userText, brief } = buildPrompt(input, src);
  const limit = limitFor(input.to);
  const out = await runGeneration(
    {
      feature: 'repurpose', requestId: p.requestId, accountIds: src.accountIds, postId: input.source.postId ?? null,
      sentSummary: { captions: src.caption ? 1 : 0, chars: system.length + userText.length, transcript: !!input.transcript, brief: !!brief },
      output: (res) => ({ draft: res.draft }),
    },
    async ({ structured }) => {
      const schema = REPURPOSE_SCHEMAS[input.to];
      const res = await structured({ system, userText, schema, name: 'emit_repurpose', maxTokens: 4000 });
      let data = res.data ?? {};
      let usage = res.usage;
      let shortened = false;
      if (input.to === 'threads' && overLimit(data.posts ?? [], limit)) {
        const fix = await structured({ system, userText: shortenUserText(data.posts, limit), schema, name: 'emit_repurpose', maxTokens: 3000 });
        usage = addUsage(usage, fix.usage);
        data = { ...data, posts: fix.data?.posts ?? data.posts, title: fix.data?.title || data.title };
        shortened = true;
      }
      return { usage, shortened, draft: normalizeDraft(input.to, data, { lang: input.lang }) };
    },
    deps,
  );
  return { draft: { ...out.draft, shortened: out.shortened }, usage: out.usage, costUsd: out.costUsd, generationId: out.generationId, provider: out.provider, model: out.model };
}

/** studio:preview 'repurpose' */
export function repurposePreview(params = {}) {
  const input = sanitizeRepurposeInput(params);
  const src = loadSource(input.source);
  const { system, userText, brief } = buildPrompt(input, src);
  return {
    items: [
      { kind: 'text', label: 'rp_send_caption', chars: src.caption.length, count: src.caption ? 1 : 0, ids: [input.source.mediaId ?? input.source.postId] },
      { kind: 'table', label: 'rp_send_metrics', count: src.metrics ? Object.values(src.metrics).filter((v) => v != null).length : 0 },
      { kind: 'text', label: 'rp_send_transcript', chars: input.transcript.length },
      { kind: 'text', label: 'rp_send_brief', chars: brief.length },
    ],
    text: `${system}\n${userText}`,
    expectedOutputTokens: input.to === 'carousel' ? 900 : 500,
  };
}

// ---- draft → planner ---------------------------------------------------------------------------------------

function draftNotes(draft, sourceLabel) {
  const L = (key, vars) => msg(key, vars, draft.lang);
  const lines = [];
  if (draft.to === 'carousel' && draft.slides.length) {
    lines.push(L('rp_note_slides'));
    draft.slides.forEach((s, i) => lines.push(`${L('rp_note_slide', { n: i + 1 })}: ${s.title}${s.body ? ` — ${s.body}` : ''}`));
  }
  if (draft.to === 'threads' && draft.posts.length > 1) {
    lines.push(L('rp_note_chain'));
    draft.posts.slice(1).forEach((x, i) => lines.push(`${i + 2}/${draft.posts.length}: ${x}`));
  }
  if (draft.to === 'story' && draft.frames.length) {
    lines.push(L('rp_note_frames'));
    draft.frames.forEach((f, i) => lines.push(`${L('rp_note_frame', { n: i + 1 })}: ${f.text}`));
  }
  if (sourceLabel) lines.push('', L('rp_note_source', { source: sourceLabel }));
  return lines.join('\n').trim().slice(0, 10_000) || null;
}

/** studio:repurpose:toDraft { source, to, draft, accountIds } → { postId } */
export function repurposeToDraft(p = {}, { now = Date.now() } = {}) {
  const source = sourceKey(p.source);
  const to = REPURPOSE_TARGETS.includes(p.to) ? p.to : null;
  if (!to) throw bad('to');
  const draft = normalizeDraft(to, p.draft);
  if (!draft.caption && !draft.slides?.length && !draft.frames?.length) throw bad('draft');
  if (!Array.isArray(p.accountIds) || !p.accountIds.length || p.accountIds.length > MAX_ACCOUNTS) throw bad('accountIds');
  const targets = [...new Set(p.accountIds.map(String))].map((accountId) => {
    const account = getAccount(accountId);
    if (!account) throw bad('accountIds');
    const format = DRAFT_TARGETS[to][account.platform];
    if (!format) throw new AiError('rp_bad_account', { vars: { account: account.username, platform: account.platform, to } });
    return { accountId, format };
  });
  const parentPostId = source.postId && getPost(source.postId) ? source.postId : null;
  const src = parentPostId ? getPost(parentPostId) : source.mediaId ? getMedia(source.mediaId) : null;
  const sourceLabel = parentPostId ? src.ref : src?.permalink ?? source.mediaId ?? null;
  const fallbackTitle = msg('rp_default_title', { title: clip(src?.title || src?.caption || '', 60) || String(sourceLabel ?? '') }, draft.lang);
  const id = createPost({
    title: draft.title || fallbackTitle.slice(0, TITLE_MAX), caption: draft.caption, notes: draftNotes(draft, sourceLabel), source: 'repurpose',
    targets: toTargets(targets, { platformOf: (aid) => getAccount(aid)?.platform ?? null }), assets: [],
  }, { now, actor: 'user' });
  setPostAiMeta(id, { repurposedFrom: source, to, lang: draft.lang }, { parentPostId });
  progressBus.emit('planner:changed', { postIds: [id], reason: 'created' });
  progressBus.emit('studio:changed', { kind: 'ideas', postIds: [id], accountIds: targets.map((t) => t.accountId) });
  return { postId: id };
}
