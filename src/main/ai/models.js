import { AiError } from './errors.js';

/** Pure AI settings helpers: provider/model catalogue, validation and masking. */
export const PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama'];
export const ANTHROPIC_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
export const DEFAULT_MODELS = { anthropic: 'claude-opus-5', openai: 'gpt-5-mini', gemini: 'gemini-2.5-flash', ollama: 'llama3.1' };
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const KEYLESS_PROVIDERS = ['ollama'];
const MODEL_MAX = 100;

export function isProvider(p) {
  return PROVIDERS.includes(p);
}

/** Anthropic accepts only the curated IDs; other providers take any non-empty free-text model name. */
export function resolveModel(provider, model) {
  const m = typeof model === 'string' ? model.trim() : '';
  if (provider === 'anthropic') return ANTHROPIC_MODELS.includes(m) ? m : DEFAULT_MODELS.anthropic;
  return m || DEFAULT_MODELS[provider] || '';
}

/** Validates an Ollama base URL (http/https only) and strips trailing slashes. */
export function normalizeOllamaUrl(url) {
  let parsed;
  try { parsed = new URL(String(url ?? '').trim()); } catch { throw new AiError('ai_bad_url'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new AiError('ai_bad_url');
  return parsed.toString().replace(/\/+$/, '');
}

/** Turns a renderer patch { enabled, provider, model, ollamaUrl } into validated settings entries. */
export function sanitizeAiPatch(patch = {}) {
  const out = {};
  if ('enabled' in patch) out['ai.enabled'] = patch.enabled === true;
  if ('provider' in patch) {
    if (!isProvider(patch.provider)) throw new AiError('ai_bad_provider', { vars: { p: String(patch.provider) } });
    out['ai.provider'] = patch.provider;
  }
  if ('model' in patch) {
    const m = typeof patch.model === 'string' ? patch.model.trim().slice(0, MODEL_MAX) : '';
    out['ai.model'] = m || null;
  }
  if ('ollamaUrl' in patch) out['ai.ollamaUrl'] = normalizeOllamaUrl(patch.ollamaUrl);
  return out;
}

/** Public view of a stored secret: never the key itself, only whether it is set and its last 4 characters. */
export function maskKey(key) {
  return key ? { set: true, last4: String(key).slice(-4) } : { set: false, last4: null };
}
