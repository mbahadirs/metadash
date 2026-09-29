import { isSupportedLang } from '../../locales/catalog.js';
import { AiError } from '../errors.js';
import { currentLang, msg, locale } from '../../i18n.js';
import { getConfig, setConfig } from '../../config/store.js';
import { getAccount } from '../../db/queries/accounts.js';
import { listMedia, mediaTypeKey } from '../../db/queries/media.js';
import { getBrandVoice, setPostAiMeta } from '../../db/queries/studio.js';
import { createPost } from '../../db/queries/planner.js';
import { suggestSlots } from '../../planner/suggest.js';
import { toTargets } from '../../planner/input.js';
import { specialDaysFor, validateCustomDays } from '../../data/specialDays.js';
import { progressBus } from '../../sync/progress.js';
import { runGeneration, assertAccountsAllowed } from './runtime.js';
import { assertAiEnabled } from '../settings.js';
import {
  ideasSchema, ideasSystemPrompt, ideasUserText, IDEA_FORMATS, PLATFORM_IDEA_FORMATS, IDEA_CAPTION_SENT_MAX, IDEA_BRIEF_MAX,
} from './prompts/ideas.js';

/**
 * Monthly content ideas (v1.5 plan §5.4).
 *  generateIdeas   studio:ideas:generate  → { ideas, usage, costUsd, generationId, provider, model }
 *  ideasToDrafts   studio:ideas:toDrafts  → { postIds } (planner drafts, source 'ai_idea', optional best-time slots)
 *  ideasPreview    studio:preview 'ideas' (same builders, no model call)
 * Every model call goes through runGeneration (AI on, per-account opt-out, cancel, usage recording).
 */
const DAY_MS = 86_400_000;
const HISTORY_DAYS = 180;
const TOP_POSTS = 10;
const MAX_IDEAS = 31;
const DEFAULT_COUNT = 12;
const MAX_PILLARS = 8;
const PILLAR_MAX = 60;
const MONTHS_AHEAD = 12;
const BEST_TIME_SLOTS = 8;
const LIMITS = { id: 64, title: 200, pillar: PILLAR_MAX, hook: 500, caption: 5000, rationale: 1000, basedOn: 10 };
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LANGS = ['tr', 'en'];

/** Idea format → planner target format per platform (story/text fall back where the platform has no such format). */
export const TARGET_FORMAT = {
  instagram: { reel: 'reel', carousel: 'carousel', image: 'image', story: 'story', text: 'image' },
  facebook: { reel: 'reel', carousel: 'album', image: 'photo', story: 'photo', text: 'text' },
  threads: { reel: 'video', carousel: 'carousel', image: 'image', story: 'image', text: 'text' },
};

const bad = (field) => new AiError('ai_bad_input', { vars: { field } });
const clip = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const pad = (n) => String(n).padStart(2, '0');
const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const anonymize = (text) => String(text ?? '').replace(/@[\p{L}\p{N}_](?:[\p{L}\p{N}_.]*[\p{L}\p{N}_])?/gu, '@mention');
const round = (v, d = 0) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const mean = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const emit = (name, payload) => progressBus.emit(name, payload);

/** 'YYYY-MM' → { year, month, start, end, days } in local time; only this month … +12 months. */
export function parseMonth(value, { now = Date.now() } = {}) {
  const m = MONTH_RE.exec(String(value ?? ''));
  if (!m) throw new AiError('ideas_bad_month');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const today = new Date(now);
  const offset = (year - today.getFullYear()) * 12 + (month - 1 - today.getMonth());
  if (month < 1 || month > 12 || offset < 0 || offset > MONTHS_AHEAD) throw new AiError('ideas_bad_month');
  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 1).getTime();
  return { year, month, key: `${year}-${pad(month)}`, start, end, days: new Date(year, month, 0).getDate() };
}

function requireAccount(accountId) {
  if (typeof accountId !== 'string' || !accountId || accountId.length > 64) throw bad('accountId');
  const account = getAccount(accountId);
  if (!account) throw bad('accountId');
  return account;
}

/** The user's special days (config 'studio.specialDays'); invalid stored data is ignored rather than breaking ideas. */
export function customSpecialDays() {
  try { return validateCustomDays(getConfig('studio.specialDays') ?? []); } catch { return []; }
}

/** studio:ideas:days:save { custom } → the saved list (validated; replaces the whole list). */
export function saveCustomSpecialDays(list) {
  let clean;
  try { clean = validateCustomDays(list); } catch (err) {
    throw new AiError('ideas_special_days_invalid', { vars: { field: err.field ?? 'specialDays' } });
  }
  setConfig('studio.specialDays', clean);
  return clean;
}

/** Validated generate payload. */
export function sanitizeGenerateInput(p = {}, { now = Date.now() } = {}) {
  const account = requireAccount(p.accountId);
  const month = parseMonth(p.month, { now });
  const count = p.count == null ? DEFAULT_COUNT : Math.floor(Number(p.count));
  if (!Number.isFinite(count) || count < 1 || count > MAX_IDEAS) throw bad('count');
  if (p.pillars != null && (!Array.isArray(p.pillars) || p.pillars.length > MAX_PILLARS)) throw bad('pillars');
  const pillars = [...new Set((p.pillars ?? []).map((x) => clip(String(x ?? ''), PILLAR_MAX)).filter(Boolean))];
  const langs = Array.isArray(p.langs) ? p.langs.filter((l) => LANGS.includes(l)) : [];
  if (Array.isArray(p.langs) && p.langs.length && !langs.length) throw bad('langs');
  return { account, month, count, pillars, lang: langs[0] ?? currentLang(), includeSpecialDays: p.includeSpecialDays !== false };
}

/** Per-type performance of the account over the last 180 days. */
function formatMix(posts) {
  const groups = new Map();
  for (const p of posts) {
    const k = mediaTypeKey(p);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.entries()].map(([type, list]) => ({
    type, posts: list.length, sharePct: round((list.length / posts.length) * 100),
    avgReach: round(mean(list.map((x) => x.reach))), avgViews: round(mean(list.map((x) => x.views))),
    avgEr: round(mean(list.map((x) => x.engagementRate)), 2), avgSaveRate: round(mean(list.map((x) => x.saveRate)), 2),
  })).sort((a, b) => b.posts - a.posts);
}

/**
 * Everything the model sees, gathered locally (deterministic, shared by the real call and the preview).
 * refMap maps the short refs (p1…) back to media ids; nothing identifying the account is included.
 */
export function buildIdeasContext(input, { now = Date.now() } = {}) {
  const { account, month, count, pillars, lang, includeSpecialDays } = input;
  const platform = account.platform ?? 'instagram';
  const history = listMedia({ igIds: [account.igId], from: now - HISTORY_DAYS * DAY_MS, to: now });
  const top = listMedia({ igIds: [account.igId], from: now - 365 * DAY_MS, to: now, sort: platform === 'threads' ? 'views' : 'reach', limit: TOP_POSTS });
  const refMap = {};
  const topPosts = top.map((m, i) => {
    const ref = `p${i + 1}`;
    refMap[ref] = m.mediaId;
    return {
      ref, type: mediaTypeKey(m), date: localDate(m.postedAt), reach: m.reach, views: m.views, erPct: round(m.engagementRate, 2), saveRatePct: round(m.saveRate, 2),
      caption: anonymize(m.caption).slice(0, IDEA_CAPTION_SENT_MAX),
    };
  });
  let bestTimes = [];
  try {
    const from = Math.max(month.start, now);
    const slots = suggestSlots({ accountIds: [account.igId], from, days: 28, count: BEST_TIME_SLOTS }, { now });
    const seen = new Set();
    bestTimes = slots.filter((s) => { const k = `${s.weekday}-${s.hour}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((s) => ({ weekday: s.weekday, hour: s.hour, source: s.source }));
  } catch { bestTimes = []; }
  const days = includeSpecialDays ? specialDaysFor(month.year, month.month, { custom: customSpecialDays(), lang }) : [];
  const specialDays = days.map((d) => ({ date: d.date, name: d.name, region: d.region, ...(d.approx ? { approx: true } : {}), ...(d.solemn ? { solemn: true } : {}), ...(d.days > 1 ? { days: d.days } : {}) }));
  const brief = clip(getBrandVoice(account.igId)?.brief ?? '', IDEA_BRIEF_MAX);
  const monthLabel = new Date(month.start).toLocaleDateString(locale(lang), { month: 'long', year: 'numeric' });
  return {
    platform, formats: PLATFORM_IDEA_FORMATS[platform] ?? IDEA_FORMATS, month: month.key, monthLabel, count, pillars, lang, brief,
    historyDays: HISTORY_DAYS, formatMix: formatMix(history), topPosts, bestTimes, specialDays, refMap,
  };
}

/** Normalizes model output: allowed format, date inside the month, refs → media ids, trimmed strings, stable ids. */
export function normalizeIdeas(raw, ctx, { idPrefix = Date.now().toString(36) } = {}) {
  const allowed = new Set(ctx.formats);
  const prefix = `${ctx.month}-`;
  return (Array.isArray(raw) ? raw : []).slice(0, ctx.count).map((it, i) => {
    const date = typeof it?.suggestedDate === 'string' && DATE_RE.test(it.suggestedDate) && it.suggestedDate.startsWith(prefix) ? it.suggestedDate : null;
    const basedOn = [...new Set((Array.isArray(it?.basedOn) ? it.basedOn : []).map((r) => ctx.refMap[String(r).trim().toLowerCase()]).filter(Boolean))];
    return {
      id: `idea-${idPrefix}-${i + 1}`,
      title: clip(it?.title, LIMITS.title),
      format: allowed.has(it?.format) ? it.format : ctx.formats[0],
      pillar: clip(it?.pillar, LIMITS.pillar),
      hook: clip(it?.hook, LIMITS.hook),
      captionDraft: clip(it?.captionDraft, LIMITS.caption),
      suggestedDate: date,
      rationale: clip(it?.rationale, LIMITS.rationale),
      basedOn,
    };
  }).filter((it) => it.title || it.captionDraft);
}

function promptFor(ctx) {
  return { system: ideasSystemPrompt(ctx.lang), userText: ideasUserText(ctx) };
}

const expectedTokens = (count) => Math.min(16_000, 600 + count * 380);

/** studio:ideas:generate */
export async function generateIdeas(p = {}, { now = Date.now(), deps } = {}) {
  const input = sanitizeGenerateInput(p, { now });
  const accountId = input.account.igId;
  assertAiEnabled();
  assertAccountsAllowed([accountId]); // fail fast before reading captions (runGeneration checks again)
  const ctx = buildIdeasContext(input, { now });
  const { system, userText } = promptFor(ctx);
  const out = await runGeneration(
    {
      feature: 'ideas', requestId: p.requestId, accountId,
      sentSummary: { captions: ctx.topPosts.length, chars: system.length + userText.length, specialDays: ctx.specialDays.length, ideas: ctx.count, brief: !!ctx.brief },
      output: (res) => ({ ideas: res.ideas }),
    },
    async ({ structured }) => {
      const res = await structured({ system, userText, schema: ideasSchema(ctx.formats), name: 'emit_ideas', maxTokens: expectedTokens(ctx.count) + 1000 });
      return { usage: res.usage, ideas: normalizeIdeas(res.data?.ideas, ctx) };
    },
    deps,
  );
  emit('studio:changed', { kind: 'ideas', accountIds: [accountId] });
  return { ideas: out.ideas, usage: out.usage, costUsd: out.costUsd, generationId: out.generationId, provider: out.provider, model: out.model };
}

/** studio:preview 'ideas' — same context and prompt builders, no model call. */
export function ideasPreview(params = {}, { now = Date.now() } = {}) {
  const ctx = buildIdeasContext(sanitizeGenerateInput(params, { now }), { now });
  const { system, userText } = promptFor(ctx);
  const items = [
    { kind: 'text', label: 'ideas_send_brief', chars: ctx.brief.length },
    { kind: 'text', label: 'ideas_send_captions', count: ctx.topPosts.length, chars: ctx.topPosts.reduce((s, x) => s + x.caption.length, 0), ids: Object.values(ctx.refMap) },
    { kind: 'table', label: 'ideas_send_formats', count: ctx.formatMix.length },
    { kind: 'table', label: 'ideas_send_best_times', count: ctx.bestTimes.length },
    { kind: 'table', label: 'ideas_send_special_days', count: ctx.specialDays.length },
    { kind: 'text', label: 'ideas_send_pillars', count: ctx.pillars.length },
  ];
  return { items, text: `${system}\n${userText}`, expectedOutputTokens: expectedTokens(ctx.count) };
}

// ---- ideas → planner drafts ----------------------------------------------------------------------------------

/** Validates ideas coming back from the renderer (they may have been edited). */
export function sanitizeIdeas(list) {
  if (!Array.isArray(list) || !list.length) throw new AiError('ideas_no_ideas');
  if (list.length > MAX_IDEAS) throw bad('ideas');
  return list.map((it, i) => {
    if (!it || typeof it !== 'object') throw bad(`ideas[${i}]`);
    const title = clip(it.title, LIMITS.title);
    const captionDraft = clip(it.captionDraft, LIMITS.caption);
    if (!title && !captionDraft) throw bad(`ideas[${i}].title`);
    return {
      id: clip(String(it.id ?? ''), LIMITS.id) || null,
      title, captionDraft,
      format: IDEA_FORMATS.includes(it.format) ? it.format : 'image',
      pillar: clip(it.pillar, LIMITS.pillar),
      hook: clip(it.hook, LIMITS.hook),
      rationale: clip(it.rationale, LIMITS.rationale),
      suggestedDate: typeof it.suggestedDate === 'string' && DATE_RE.test(it.suggestedDate) ? it.suggestedDate : null,
      basedOn: (Array.isArray(it.basedOn) ? it.basedOn : []).filter((x) => typeof x === 'string' && x.length <= 64).slice(0, LIMITS.basedOn),
    };
  });
}

const dayStart = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

/**
 * Target day (local midnight ms) for each idea: its suggested date, or an even spread over the rest of the month
 * for undated ideas. Days in the past move to today.
 */
export function planDays(ideas, { month, now = Date.now() }) {
  const today = new Date(now);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const from = Math.max(month?.start ?? todayStart, todayStart);
  const to = month?.end ?? todayStart + 30 * DAY_MS;
  const spanDays = Math.max(1, Math.round((to - from) / DAY_MS));
  const undated = ideas.filter((it) => !it.suggestedDate).length;
  let k = 0;
  return ideas.map((it) => {
    if (it.suggestedDate) return Math.max(dayStart(it.suggestedDate), todayStart);
    const offset = Math.floor(((k++ + 0.5) * spanDays) / Math.max(1, undated));
    const d = new Date(from);
    d.setDate(d.getDate() + offset);
    return d.getTime();
  });
}

function draftNotes(idea, lang) {
  const lines = [];
  if (idea.hook) lines.push(`${msg('ideas_note_hook', null, lang)}: ${idea.hook}`);
  if (idea.rationale) lines.push(`${msg('ideas_note_why', null, lang)}: ${idea.rationale}`);
  if (idea.pillar) lines.push(`${msg('ideas_note_pillar', null, lang)}: ${idea.pillar}`);
  if (idea.basedOn.length) lines.push(msg('ideas_note_based_on', { n: idea.basedOn.length }, lang));
  return lines.join('\n') || null;
}

const platformOf = (id) => getAccount(id)?.platform ?? null;
const machineTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { return null; } };

/**
 * studio:ideas:toDrafts { accountId, ideas, schedule: 'suggested'|'none', month? } → { postIds }.
 * With 'suggested', each draft gets the best slot on its day from planner/suggest (the same engine as the calendar),
 * one after another, so the planner's min gap between posts of the account is respected.
 */
export function ideasToDrafts(p = {}, { now = Date.now() } = {}) {
  const account = requireAccount(p.accountId);
  const ideas = sanitizeIdeas(p.ideas);
  const schedule = p.schedule === 'suggested' ? 'suggested' : 'none';
  let month = null;
  if (p.month != null) { try { month = parseMonth(p.month, { now }); } catch { month = null; } }
  const platform = account.platform ?? 'instagram';
  const lang = currentLang();
  const days = schedule === 'suggested' ? planDays(ideas, { month, now }) : [];
  const timezone = machineTimezone();
  const postIds = [];
  ideas.forEach((idea, i) => {
    let scheduledAt = null;
    if (schedule === 'suggested') {
      const from = Math.max(days[i], now);
      const slot = suggestSlots({ accountIds: [account.igId], from, days: 1, count: 1 }, { now })[0]
        ?? suggestSlots({ accountIds: [account.igId], from, days: 3, count: 1 }, { now })[0];
      scheduledAt = slot?.at ?? null;
    }
    const targets = toTargets([{ accountId: account.igId, format: TARGET_FORMAT[platform]?.[idea.format] }], { platformOf });
    const id = createPost({
      title: idea.title || null, caption: idea.captionDraft, notes: draftNotes(idea, lang), source: 'ai_idea',
      scheduledAt, timezone: scheduledAt != null ? timezone : null, labels: idea.pillar ? [idea.pillar.slice(0, 50)] : [], targets, assets: [],
    }, { now, actor: 'user' });
    setPostAiMeta(id, { ideaId: idea.id, pillar: idea.pillar || null, rationale: idea.rationale || null, hook: idea.hook || null, format: idea.format, basedOn: idea.basedOn });
    postIds.push(id);
  });
  emit('planner:changed', { postIds, reason: 'created' });
  emit('studio:changed', { kind: 'ideas', accountIds: [account.igId], postIds });
  return { postIds };
}

/** studio:ideas:days { month } → { days (built-in + custom in that month), custom (the full user list) }. */
export function ideasSpecialDays(p = {}) {
  const custom = customSpecialDays();
  let days = [];
  if (p.month != null) {
    const m = MONTH_RE.exec(String(p.month));
    if (!m) throw new AiError('ideas_bad_month');
    days = specialDaysFor(Number(m[1]), Number(m[2]), { custom, lang: isSupportedLang(p.lang) ? p.lang : currentLang() });
  }
  return { days, custom };
}
