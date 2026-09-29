import { estimateCost } from './pricing.js';
import { estimateImageTokens } from './vision.js';
import { notImplemented } from '../ipc/notImplemented.js';

/**
 * "What will be sent" previews. A feature registers a builder `(params) => { items, text, images?, expectedOutputTokens? }`
 * that runs the SAME prompt builders as the real call, without calling a model:
 * - items: [{ kind: 'text'|'image'|'table', label, chars?, count?, thumb? (small data URL), ids? }] — shown to the user
 * - text: the full text that would be sent (system + user), used only for the token estimate (never stored)
 * - images: [{ w, h }] at the size that will be sent
 */
export const CHARS_PER_TOKEN = 4; // rough for English; Turkish tokenizes denser (VERIFY per provider tokenizer)
const DEFAULT_OUTPUT_TOKENS = 800;

export function estimateTextTokens(text) {
  const n = typeof text === 'string' ? text.length : 0;
  return Math.ceil(n / CHARS_PER_TOKEN);
}

/**
 * Runs previews[feature](params) and adds { estInputTokens, estOutputTokens, estCostUsd, local, pricingKnown }.
 * estCostUsd is null when the model's price is unknown; 0 for Ollama.
 */
export async function describeSend(feature, params = {}, { previews = {}, provider, model, overrides = {} } = {}) {
  const builder = previews[feature];
  if (typeof builder !== 'function') throw notImplemented();
  const built = (await builder(params ?? {})) ?? {};
  const images = Array.isArray(built.images) ? built.images : [];
  const estInputTokens = estimateTextTokens(built.text ?? '') + images.reduce((s, i) => s + estimateImageTokens(i.w, i.h, provider, { detail: i.detail }), 0);
  const estOutputTokens = Number.isFinite(built.expectedOutputTokens) ? built.expectedOutputTokens : DEFAULT_OUTPUT_TOKENS;
  const estCostUsd = estimateCost({ inputTokens: estInputTokens, outputTokens: estOutputTokens }, provider, model, overrides);
  return {
    feature,
    items: Array.isArray(built.items) ? built.items : [],
    estInputTokens,
    estOutputTokens,
    estCostUsd,
    pricingKnown: estCostUsd != null,
    local: provider === 'ollama',
  };
}
