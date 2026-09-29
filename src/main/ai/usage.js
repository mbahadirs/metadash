import { getConfig } from '../config/store.js';
import { insertGeneration, usageSummary } from '../db/queries/studio.js';
import { estimateCost, sanitizePricingOverrides } from './pricing.js';

/**
 * AI usage log (ai_generations) and month-to-date cost. Privacy: sent_summary keeps only numeric/boolean counts
 * (never text), and the model output is stored only when the user enabled 'ai.keepHistory'.
 * Recording never throws: a failed insert must not fail the AI call it describes.
 */
export const FEATURES = ['voice', 'caption', 'hashtags', 'ideas', 'repurpose', 'reply', 'abtest', 'commentary', 'anomaly', 'ask', 'test'];
const SUMMARY_KEYS_MAX = 30;
const OUTPUT_MAX_CHARS = 200_000;

function safeConfig(key, fallback) {
  try { return getConfig(key) ?? fallback; } catch { return fallback; }
}

/** User price overrides from settings ('ai.pricing'), validated. */
export function pricingOverrides() {
  return sanitizePricingOverrides(safeConfig('ai.pricing', {}));
}

/** Estimated USD for one call with the user's overrides; null = unknown price. */
export function costOf(usage, provider, model) {
  return estimateCost(usage, provider, model, pricingOverrides());
}

/** Keeps only flat numeric/boolean entries: counts, never content. */
export function countsOnly(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(summary).slice(0, SUMMARY_KEYS_MAX)) {
    if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function outputForHistory(output) {
  if (output == null || safeConfig('ai.keepHistory', false) !== true) return null;
  const json = JSON.stringify(output);
  return json.length <= OUTPUT_MAX_CHARS ? output : null;
}

/**
 * Records one AI call. { feature, accountId?, postId?, provider, model, usage:{inputTokens, outputTokens}, images?, ms?,
 * status: 'ok'|'error'|'cancelled', errorCode?, sentSummary?, output? } → generation id, or null when recording failed.
 */
export function recordGeneration(entry, { now = Date.now() } = {}) {
  try {
    const usage = entry.usage ?? {};
    const priced = entry.status === 'ok' || usage.inputTokens || usage.outputTokens;
    return insertGeneration({
      at: now,
      feature: String(entry.feature ?? 'unknown'),
      accountId: entry.accountId ?? null,
      postId: entry.postId ?? null,
      provider: entry.provider ?? null,
      model: entry.model ?? null,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      images: entry.images ?? 0,
      estCostUsd: priced ? costOf(usage, entry.provider, entry.model) : 0,
      durationMs: entry.ms ?? null,
      status: entry.status ?? 'ok',
      errorCode: entry.errorCode ?? null,
      sentSummary: countsOnly(entry.sentSummary),
      output: outputForHistory(entry.output),
    });
  } catch (err) {
    console.error('[ai:usage] could not record generation', err?.message ?? err);
    return null;
  }
}

const monthStart = (now) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };

/** Usage for [from, to) (default: current local month) + the optional monthly budget ('ai.monthlyBudgetUsd'). */
export function monthlyUsage({ from, to, now = Date.now() } = {}) {
  const start = Number.isFinite(from) ? from : monthStart(now);
  const end = Number.isFinite(to) ? to : now + 1;
  const summary = usageSummary({ from: start, to: end });
  const budget = safeConfig('ai.monthlyBudgetUsd', null);
  const budgetUsd = typeof budget === 'number' && budget > 0 ? budget : null;
  return { ...summary, budgetUsd, overBudget: budgetUsd != null && summary.totalUsd > budgetUsd };
}

export function monthToDateUsd(now = Date.now()) {
  try { return usageSummary({ from: monthStart(now), to: now + 1 }).totalUsd; } catch { return 0; }
}

const statusOf = (err) => (err?.key === 'ai_cancelled' || err?.name === 'AbortError' ? 'cancelled' : 'error');

/**
 * Runs fn() (which resolves to an object with `usage`) and records it.
 * meta: { feature, provider, model, accountId?, postId?, images?, sentSummary?, output?: (result) => json }.
 * Resolves to { ...result, generationId, costUsd }; failures are recorded with status error/cancelled and rethrown.
 */
export async function withUsage(meta, fn) {
  const started = Date.now();
  // Read lazily: images / sentSummary may be getters that fn() fills in while it runs.
  const base = () => ({ feature: meta.feature, provider: meta.provider, model: meta.model, accountId: meta.accountId, postId: meta.postId, images: meta.images ?? 0, sentSummary: meta.sentSummary });
  try {
    const result = await fn();
    const usage = result?.usage ?? { inputTokens: 0, outputTokens: 0 };
    const output = typeof meta.output === 'function' ? meta.output(result) : undefined;
    const generationId = recordGeneration({ ...base(), usage, ms: Date.now() - started, status: 'ok', output });
    return { ...result, generationId, costUsd: costOf(usage, meta.provider, meta.model) };
  } catch (err) {
    recordGeneration({ ...base(), usage: err?.usage, ms: Date.now() - started, status: statusOf(err), errorCode: err?.code ?? err?.name ?? 'ERROR' });
    throw err;
  }
}
