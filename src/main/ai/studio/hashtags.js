import { getAccount } from '../../db/queries/accounts.js';
import { currentLang } from '../../i18n.js';
import { AiError } from '../errors.js';
import { suggestHashtags, hashtagPerformance, extractTags } from '../../analytics/hashtags.js';
import { runGeneration } from './runtime.js';
import { HASHTAG_RANK_SCHEMA, hashtagSystemPrompt, hashtagUserText, NOTES_MAX } from './prompts/captions.js';

/**
 * Hashtag suggestions (v1.5 chunk B). The ranking is local and deterministic (analytics/hashtags.js); with useAi the
 * model may only choose and re-order tags from the tested list, plus propose at most 3 labelled "untested" tags.
 */
const PLATFORMS = ['instagram', 'facebook', 'threads'];
const CANDIDATES = 25;
const UNTESTED_MAX = 3;
const TAG_RE = /^#[\p{L}\p{N}_]{2,60}$/u;

const bad = (field) => new AiError('ai_bad_input', { vars: { field } });

export function normalizeHashtagInput(p = {}) {
  if (typeof p.accountId !== 'string' || !getAccount(p.accountId)) throw bad('accountId');
  const platform = p.platform ?? getAccount(p.accountId).platform ?? 'instagram';
  if (!PLATFORMS.includes(platform)) throw bad('platform');
  if (p.caption != null && (typeof p.caption !== 'string' || p.caption.length > 70_000)) throw bad('caption');
  if (p.notes != null && (typeof p.notes !== 'string' || p.notes.length > NOTES_MAX * 2)) throw bad('notes');
  if (p.count != null && (!Number.isInteger(p.count) || p.count < 1 || p.count > 30)) throw bad('count');
  return { accountId: p.accountId, platform, caption: p.caption ?? '', notes: p.notes ?? '', count: p.count, useAi: p.useAi === true, requestId: p.requestId, lang: p.lang };
}

/** The model's order, restricted to tags from the tested pool (unknown or repeated tags are ignored; dropped tags stay out). */
export function applyAiOrder(tested, order, count) {
  const byTag = new Map(tested.map((t) => [t.tag, t]));
  const seen = new Set();
  const out = [];
  for (const raw of order ?? []) {
    const tag = String(raw).trim().toLowerCase().replace(/^#?/, '#');
    if (!byTag.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(byTag.get(tag));
  }
  return out.slice(0, count);
}

/** Model-proposed new tags: valid syntax, not already tested/in the caption, at most 3. */
export function cleanUntested(list, known) {
  const out = [];
  for (const u of list ?? []) {
    const tag = String(u.tag ?? '').trim().toLowerCase().replace(/^#?/, '#');
    if (!TAG_RE.test(tag) || known.has(tag) || out.some((o) => o.tag === tag)) continue;
    out.push({ tag, reason: String(u.reason ?? '').trim().slice(0, 200) });
  }
  return out.slice(0, UNTESTED_MAX);
}

/** studio:hashtags:suggest → { tested, overused, stale, untested, count, platformMax, recommended, usage?, costUsd?, generationId? }. */
export async function suggestTags(payload = {}, deps = {}) {
  const input = normalizeHashtagInput(payload);
  const now = deps.now ?? Date.now();
  const perf = hashtagPerformance({ accountId: input.accountId, now });
  const base = suggestHashtags({ ...input, now, perf });
  if (!input.useAi) return base;
  const pool = suggestHashtags({ ...input, count: 30, now, perf }).tested.slice(0, CANDIDATES);
  const lang = input.lang === 'tr' || input.lang === 'en' ? input.lang : currentLang();
  const userText = hashtagUserText({ caption: input.caption, notes: input.notes, tags: pool });
  const out = await runGeneration(
    { feature: 'hashtags', requestId: input.requestId, accountId: input.accountId, sentSummary: { tags: pool.length, chars: userText.length } },
    ({ structured }) => structured({ system: hashtagSystemPrompt(lang, input.platform), userText, schema: HASHTAG_RANK_SCHEMA, name: 'emit_hashtags', maxTokens: 1200 }),
    deps,
  );
  const known = new Set([...perf.tags.map((t) => t.tag), ...extractTags(input.caption)]);
  const ordered = applyAiOrder(pool, out.data.order, base.count);
  const untested = cleanUntested(out.data.untested, known).slice(0, Math.max(0, base.platformMax - ordered.length));
  return { ...base, tested: ordered.length ? ordered : base.tested, untested, aiRanked: ordered.length > 0, usage: out.usage, costUsd: out.costUsd, generationId: out.generationId, provider: out.provider, model: out.model };
}

/** studio:preview 'hashtags' builder. */
export function hashtagsPreview(params = {}) {
  const input = normalizeHashtagInput(params);
  const pool = suggestHashtags({ ...input, count: 30 }).tested.slice(0, CANDIDATES);
  const lang = input.lang === 'tr' || input.lang === 'en' ? input.lang : currentLang();
  const userText = hashtagUserText({ caption: input.caption, notes: input.notes, tags: pool });
  return {
    items: [
      { kind: 'text', label: 'caption', chars: input.caption.length },
      { kind: 'text', label: 'notes', chars: input.notes.length },
      { kind: 'table', label: 'hashtag_stats', count: pool.length },
    ],
    text: `${hashtagSystemPrompt(lang, input.platform)}\n${userText}`,
    expectedOutputTokens: 300,
  };
}
