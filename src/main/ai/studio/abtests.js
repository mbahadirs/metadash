import { isSupportedLang, LANGUAGE } from '../../locales/catalog.js';
import { msg } from '../../i18n.js';
import { AiError } from '../errors.js';
import { runGeneration } from './runtime.js';
import { CONTENT_DATA_RULES } from '../prompts.js';
import { analyzeAbTest, AB_METRICS, AB_VARIABLES } from '../../analytics/abtests.js';
import { typeBenchmarks, mediaTypeKey } from '../../db/queries/media.js';
import {
  listAbTests, getAbTest, createAbTest, insertAbItem, removeAbItem, concludeAbTest, reopenAbTest, deleteAbTest, abItemsWithMedia,
  targetsForCaptionVariant, captionVariantExists, targetExists, mediaExists, abCandidates,
} from '../../db/queries/abtests.js';
import { progressBus } from '../../sync/progress.js';

/**
 * A/B caption experiments (v1.5 chunk D): variant tagging across separately published posts. Results come from
 * analytics/abtests.js (pure). The AI step is optional: "summarize learnings" writes ab_tests.conclusion.
 */
const DAY = 86_400_000;
const BENCH_DAYS = 90;
const ARM_RE = /^[A-Z]$/;
const NAME_MAX = 120;
const TEXT_MAX = 2000;
const ITEMS_MAX = 100;
const CANDIDATE_DAYS_DEFAULT = 120;

const bad = (field) => new AiError('ai_bad_input', { vars: { field } });
const abError = (key, vars) => Object.assign(new Error(msg(key, vars)), { key, code: key.toUpperCase() });
const changed = (ids) => { try { progressBus.emit('studio:changed', { kind: 'ab', ids }); } catch { /* no listeners */ } };

const posInt = (v, field) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(field);
  return n;
};
const optText = (v, field, max = TEXT_MAX) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > max) throw bad(field);
  return v.trim() || null;
};
const mediaKeyOf = (v) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_:.-]{1,120}$/.test(v)) throw bad('mediaKey');
  return v;
};
const armOf = (v) => {
  if (typeof v !== 'string' || !ARM_RE.test(v)) throw bad('arm');
  return v;
};

function mustGet(id) {
  const test = getAbTest(posInt(id, 'id'));
  if (!test) throw abError('ab_not_found');
  return test;
}

/** Resolves one arm spec into item rows (validated against the DB). */
function itemsForArm(spec) {
  const arm = armOf(spec?.arm);
  const out = [];
  for (const t of spec.targetIds ?? []) {
    const target = targetExists(posInt(t, 'targetIds'));
    if (!target) throw bad('targetIds');
    out.push({ arm, targetId: Number(t) });
  }
  for (const k of spec.mediaKeys ?? []) {
    const key = mediaKeyOf(k);
    if (!mediaExists(key)) throw bad('mediaKeys');
    out.push({ arm, mediaKey: key });
  }
  for (const v of spec.captionVariantIds ?? []) {
    const id = posInt(v, 'captionVariantIds');
    if (!captionVariantExists(id)) throw bad('captionVariantIds');
    const targets = targetsForCaptionVariant(id);
    if (targets.length) targets.forEach((t) => out.push({ arm, targetId: t.targetId, captionVariantId: id }));
    else out.push({ arm, captionVariantId: id });
  }
  return out;
}

export function createTest(payload = {}) {
  const name = optText(payload.name, 'name', NAME_MAX);
  if (!name) throw bad('name');
  const variable = payload.variable == null ? 'other' : payload.variable;
  if (!AB_VARIABLES.includes(variable)) throw bad('variable');
  const metric = payload.metric == null ? 'reach_lift' : payload.metric;
  if (!AB_METRICS.includes(metric)) throw bad('metric');
  if (!Array.isArray(payload.arms) || payload.arms.length < 2 || payload.arms.length > 4) throw bad('arms');
  const armNames = payload.arms.map((a) => armOf(a?.arm));
  if (new Set(armNames).size !== armNames.length) throw bad('arms');
  const items = payload.arms.flatMap(itemsForArm);
  if (items.length > ITEMS_MAX) throw bad('arms');
  const id = createAbTest({ name, hypothesis: optText(payload.hypothesis, 'hypothesis'), variable, metric, items });
  changed([id]);
  return { id, arms: armNames };
}

export function tagItem({ testId, arm, targetId, mediaKey } = {}) {
  const test = mustGet(testId);
  const a = armOf(arm);
  if ((targetId == null) === (mediaKey == null)) throw bad('targetId');
  const [item] = itemsForArm(targetId != null ? { arm: a, targetIds: [targetId] } : { arm: a, mediaKeys: [mediaKey] });
  const inserted = insertAbItem(test.id, item);
  if (!inserted) throw abError('ab_already_tagged');
  changed([test.id]);
  return { inserted };
}

export function untagItem({ testId, itemId } = {}) {
  const test = mustGet(testId);
  const removed = removeAbItem(test.id, posInt(itemId, 'itemId'));
  changed([test.id]);
  return { removed };
}

/** DB rows → observations for analyzeAbTest, with the per-post type benchmark (90 days before the post). */
export function observationsFor(testId) {
  const benchCache = new Map();
  return abItemsWithMedia(testId).map((r) => {
    const synced = !!r.igId && Number.isFinite(r.postedAt);
    let bench = null;
    if (synced) {
      const key = `${r.igId}|${Math.floor(r.postedAt / DAY)}`;
      if (!benchCache.has(key)) benchCache.set(key, typeBenchmarks(r.igId, r.postedAt - BENCH_DAYS * DAY, r.postedAt - 1));
      bench = benchCache.get(key)[mediaTypeKey(r)] ?? null;
    }
    return {
      itemId: r.id, arm: r.arm, targetId: r.targetId, mediaKey: r.mediaKey, synced, postedAt: r.postedAt ?? null,
      platform: r.platform ?? r.targetPlatform ?? null, username: r.username ?? null,
      reach: r.reach, views: r.views, saved: r.saved, engagementRate: r.engagementRate, bench,
      caption: r.caption ?? r.variantText ?? r.plannedCaption ?? null, permalink: r.permalink ?? null, thumbnailPath: r.thumbnailPath ?? null,
      mediaType: r.mediaType ?? null, mediaProductType: r.mediaProductType ?? null, targetState: r.targetState ?? null, scheduledAt: r.scheduledAt ?? null,
    };
  });
}

/** Test + per-arm results (the analysis runs on every read: metrics change as media syncs). */
export function getTestResults({ id } = {}, { now = Date.now() } = {}) {
  const test = mustGet(id);
  const observations = observationsFor(test.id);
  const results = analyzeAbTest({ metric: test.metric, observations, now, seed: test.id });
  const arms = results.arms.map((a) => ({
    ...a,
    posts: observations.filter((o) => o.arm === a.arm).map((o, i) => ({
      itemId: o.itemId, targetId: o.targetId, mediaKey: o.mediaKey, username: o.username, platform: o.platform, postedAt: o.postedAt,
      caption: o.caption ? o.caption.slice(0, 280) : null, permalink: o.permalink, thumbnailPath: o.thumbnailPath, mediaType: o.mediaType,
      mediaProductType: o.mediaProductType, targetState: o.targetState, scheduledAt: o.scheduledAt,
      lift: a.posts[i]?.lift ?? null, excluded: a.posts[i]?.excluded ?? null,
    })),
  }));
  return { ...test, ...results, arms };
}

export function listTests({ now = Date.now() } = {}) {
  return listAbTests().map((t) => {
    const r = analyzeAbTest({ metric: t.metric, observations: observationsFor(t.id), now, seed: t.id, iterations: 500 });
    return { ...t, verdict: r.verdict, winner: r.winner, arms: r.arms.map((a) => ({ arm: a.arm, n: a.n, mean: a.mean, total: a.posts.length })) };
  });
}

const CONCLUSION_SCHEMA = {
  type: 'object',
  properties: { conclusion: { type: 'string', minLength: 1, maxLength: 1500 } },
  required: ['conclusion'],
  additionalProperties: false,
};

function conclusionPrompt(lang) {
  return `You are a social media analyst. Summarize the learnings of an A/B caption experiment in ${LANGUAGE[lang] ?? 'English'}, in at most 4 short sentences, plain text.
The "experiment" tags separate posts to arms; it is not a randomized split test, so describe results as directional at best.
Use only the numbers given. Lift 1.00 = on par with the account's usual results for that post type. State the verdict honestly (need more posts / inconclusive / directional), name the better arm only when the verdict is directional, and suggest one next test.

${CONTENT_DATA_RULES}`;
}

/** Summary sent to the model: numbers and short captions only (no ids, usernames or account names). */
export function conclusionData(r) {
  return {
    name: r.name, hypothesis: r.hypothesis, variable: r.variable, metric: r.metric, verdict: r.verdict, winner: r.winner, probBest: r.probBest,
    arms: r.arms.map((a) => ({
      arm: a.arm, n: a.n, meanLift: a.mean, medianLift: a.median, ci90: a.ci, excluded: a.excluded,
      captions: a.posts.filter((p) => p.lift != null).slice(0, 5).map((p) => ({ lift: p.lift, caption: (p.caption ?? '').slice(0, 200) })),
    })),
  };
}

export async function concludeTest({ id, conclusion, summarizeWithAi, requestId, lang, reopen } = {}, deps = {}) {
  const test = mustGet(id);
  if (reopen === true) { reopenAbTest(test.id); changed([test.id]); return getTestResults({ id: test.id }); }
  let text = optText(conclusion, 'conclusion');
  let cost = null;
  if (summarizeWithAi === true) {
    const r = getTestResults({ id: test.id });
    const data = conclusionData(r);
    const out = await runGeneration(
      { feature: 'abtest', requestId, accountIds: accountIdsOf(test.id), sentSummary: { arms: r.arms.length, posts: r.arms.reduce((s, a) => s + a.n, 0) } },
      ({ structured }) => structured({
        system: conclusionPrompt(isSupportedLang(lang) ? lang : undefined),
        userText: `Summarize this experiment.\n\n<experiment_json>\n${JSON.stringify(data)}\n</experiment_json>`,
        schema: CONCLUSION_SCHEMA, maxTokens: 600,
      }),
      deps,
    );
    text = [text, out.data.conclusion.trim()].filter(Boolean).join('\n\n');
    cost = { usage: out.usage, costUsd: out.costUsd, generationId: out.generationId, provider: out.provider, model: out.model };
  }
  concludeAbTest(test.id, text);
  changed([test.id]);
  return { ...getTestResults({ id: test.id }), ...(cost ?? {}) };
}

function accountIdsOf(testId) {
  return [...new Set(abItemsWithMedia(testId).map((r) => r.igId ?? r.targetAccountId).filter(Boolean))];
}

export function removeTest({ id } = {}) {
  const test = mustGet(id);
  deleteAbTest(test.id);
  changed([test.id]);
  return null;
}

export function candidates({ accountIds, days } = {}, { now = Date.now() } = {}) {
  const ids = Array.isArray(accountIds) ? accountIds.slice(0, 50).map(String) : undefined;
  const d = Number.isFinite(days) && days > 0 && days <= 365 ? days : CANDIDATE_DAYS_DEFAULT;
  const res = abCandidates({ accountIds: ids, since: now - d * DAY });
  return {
    media: res.media.map((m) => ({ ...m, typeKey: mediaTypeKey(m), caption: m.caption ? m.caption.slice(0, 200) : null })),
    targets: res.targets.map((t) => ({ ...t, caption: t.caption ? t.caption.slice(0, 200) : null })),
  };
}
