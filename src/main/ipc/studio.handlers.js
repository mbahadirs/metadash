import { readAiConfig } from '../ai/settings.js';
import { AiError } from '../ai/errors.js';
import { describeSend } from '../ai/preview.js';
import { monthlyUsage, monthToDateUsd, pricingOverrides } from '../ai/usage.js';
import { priceFor } from '../ai/pricing.js';
import { cancelRequest, studioCapabilities } from '../ai/studio/runtime.js';
import { readStudioSettings, updateStudioSettings } from '../ai/studio/settings.js';
import { studioHandlers, studioPreviews, STUDIO_CHANNELS } from '../ai/studio/index.js';
import { getConfig } from '../config/store.js';

const FEATURE_RE = /^[a-z_]{1,40}$/;
const RANGE_MAX_MS = 400 * 86_400_000;

/**
 * v1.5 AI studio IPC. Core channels live here; feature channels come from ai/studio/index.js (chunk registries),
 * with NOT_IMPLEMENTED stubs until a chunk provides them. All results use the standard { ok, data } envelope.
 */
export function registerStudioHandlers(handle) {
  handle('studio:capabilities', async () => {
    const caps = await studioCapabilities();
    const cfg = readAiConfig();
    const budget = getConfig('ai.monthlyBudgetUsd');
    return {
      ...caps,
      pricingKnown: priceFor(cfg.provider, cfg.model, pricingOverrides()) != null,
      price: priceFor(cfg.provider, cfg.model, pricingOverrides()),
      monthToDateUsd: monthToDateUsd(),
      budgetUsd: typeof budget === 'number' && budget > 0 ? budget : null,
      showCost: getConfig('ai.showCost') !== false,
      keepHistory: getConfig('ai.keepHistory') === true,
    };
  });

  handle('studio:preview', ({ feature, params } = {}) => {
    if (!FEATURE_RE.test(String(feature ?? ''))) throw new AiError('ai_bad_input', { vars: { field: 'feature' } });
    const cfg = readAiConfig();
    return describeSend(feature, params ?? {}, { previews: studioPreviews(), provider: cfg.provider, model: cfg.model, overrides: pricingOverrides() });
  });

  handle('studio:cancel', ({ requestId } = {}) => ({ cancelled: cancelRequest(requestId) }));

  handle('studio:usage', ({ from, to } = {}) => {
    const f = Number.isFinite(from) ? from : undefined;
    const t = Number.isFinite(to) ? to : undefined;
    if (f != null && t != null && (t < f || t - f > RANGE_MAX_MS)) throw new AiError('ai_bad_input', { vars: { field: 'range' } });
    return monthlyUsage({ from: f, to: t });
  });

  handle('studio:settings:get', () => readStudioSettings());
  handle('studio:settings:set', (patch) => updateStudioSettings(patch ?? {}));

  const handlers = studioHandlers();
  for (const channel of new Set([...STUDIO_CHANNELS, ...Object.keys(handlers)])) {
    handle(channel, (payload, event) => handlers[channel](payload ?? {}, { event }));
  }
}
