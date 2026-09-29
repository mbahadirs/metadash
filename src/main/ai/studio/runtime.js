import { getConfig } from '../../config/store.js';
import { AiError } from '../errors.js';
import { assertAiEnabled, readAiConfig, readApiKey } from '../settings.js';
import { createProvider } from '../providers/index.js';
import { aiCapabilities } from '../capabilities.js';
import { runStructured } from '../structured.js';
import { prepareImages, imageSummary } from '../vision.js';
import { withUsage } from '../usage.js';
import { aiDisabledAccounts } from '../../db/queries/studio.js';
import { getAccount } from '../../db/queries/accounts.js';
import { progressBus } from '../../sync/progress.js';

/**
 * Shared plumbing for every AI studio feature (chunks B/C/D import from here):
 *   const out = await runGeneration({ feature:'caption', requestId, accountIds, postId, sentSummary },
 *     async ({ provider, caps, signal, structured, images }) => ({ data, usage, … }));
 * - checks ai.enabled and the per-account opt-out BEFORE any key, file or network access
 * - one AbortController per requestId (studio:cancel) + a hard timeout
 * - records the call in ai_generations (counts only) and returns { …result, generationId, costUsd }
 */
export const STUDIO_TIMEOUT_MS = 300_000;
const REQUEST_ID_MAX = 100;
const inflight = new Map();

function safeConfig(key, fallback) {
  try { return getConfig(key) ?? fallback; } catch { return fallback; }
}

/** Settings → AI "Send images to the model" (default on). */
export const visionAllowed = () => safeConfig('ai.vision', true) !== false;

/** Throws ai_account_disabled for the first account that opted out of AI. */
export function assertAccountsAllowed(accountIds = []) {
  const disabled = aiDisabledAccounts(accountIds);
  if (!disabled.length) return;
  let name = disabled[0];
  try { name = getAccount(disabled[0])?.username ?? name; } catch { /* keep id */ }
  throw new AiError('ai_account_disabled', { vars: { account: `@${name}` } });
}

/** Aborts a running studio request; false when nothing with that id is running. */
export function cancelRequest(requestId) {
  const controller = inflight.get(requestId);
  if (!controller) return false;
  controller.abort();
  inflight.delete(requestId);
  return true;
}

export function beginRequest(requestId) {
  const id = typeof requestId === 'string' && requestId && requestId.length <= REQUEST_ID_MAX ? requestId : null;
  const controller = new AbortController();
  if (id) {
    inflight.get(id)?.abort();
    inflight.set(id, controller);
  }
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(STUDIO_TIMEOUT_MS)]);
  const release = () => { if (id && inflight.get(id) === controller) inflight.delete(id); };
  return { controller, signal, release };
}

/** Active provider + capabilities. `deps.provider` / `deps.caps` are injectable for tests. */
export async function studioContext(deps = {}) {
  const cfg = assertAiEnabled();
  const provider = deps.provider ?? createProvider(cfg, cfg.provider === 'ollama' ? null : readApiKey(cfg.provider));
  const caps = deps.caps ?? (await aiCapabilities(cfg, { allowVision: visionAllowed() }));
  return { cfg, provider, caps };
}

/** Emits studio:progress { requestId, feature, phase } (phase: preparing | sending | validating | done). */
export function emitProgress(requestId, feature, phase) {
  if (requestId) progressBus.emit('studio:progress', { requestId, feature, phase });
}

/**
 * Runs one studio generation. meta: { feature, requestId?, accountIds?, accountId?, postId?, sentSummary?, output? }.
 * fn receives { provider, caps, cfg, signal, structured(opts), images(sources, opts) } and must resolve to an object
 * with `usage` (runStructured already returns one). Returns { ...result, generationId, costUsd, provider, model }.
 */
export async function runGeneration(meta, fn, deps = {}) {
  const accountIds = [...(meta.accountIds ?? []), ...(meta.accountId ? [meta.accountId] : [])];
  assertAiEnabled();
  assertAccountsAllowed(accountIds);
  const { cfg, provider, caps } = await studioContext(deps);
  const { signal, release, controller } = beginRequest(meta.requestId);
  const sent = { images: 0, imageBytes: 0 };
  const helpers = {
    provider, caps, cfg, signal,
    structured: (opts) => runStructured({ provider, modes: caps.structuredModes, signal, ...opts }),
    images: async (sources, opts = {}) => {
      if (caps.vision === false) return { images: [], skipped: (sources ?? []).map((s) => ({ source: s, reason: 'no_vision' })) };
      const out = await prepareImages(sources, opts);
      const summary = imageSummary(out.images);
      sent.images += summary.images;
      sent.imageBytes += summary.imageBytes;
      return out;
    },
  };
  emitProgress(meta.requestId, meta.feature, 'sending');
  try {
    const result = await withUsage(
      {
        feature: meta.feature, provider: provider.id, model: provider.model, accountId: meta.accountId ?? accountIds[0] ?? null, postId: meta.postId,
        get images() { return sent.images; },
        get sentSummary() { return { ...(meta.sentSummary ?? {}), ...sent }; },
        output: meta.output,
      },
      () => fn(helpers),
    );
    return { ...result, provider: provider.id, model: provider.model };
  } catch (err) {
    if (controller.signal.aborted && !(err instanceof AiError && err.key === 'ai_cancelled')) throw new AiError('ai_cancelled', { cause: err });
    throw err;
  } finally {
    release();
    emitProgress(meta.requestId, meta.feature, 'done');
  }
}

/** Renderer-safe capability snapshot for studio:capabilities. */
export async function studioCapabilities(deps = {}) {
  const cfg = readAiConfig();
  const caps = deps.caps ?? (await aiCapabilities(cfg, { allowVision: visionAllowed(), probe: cfg.enabled }));
  return { enabled: cfg.enabled, provider: cfg.provider, model: cfg.model, ...caps };
}
