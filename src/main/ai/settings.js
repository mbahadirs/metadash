import { getConfig, setConfig, storeToken, readToken } from '../config/store.js';
import { AiError } from './errors.js';
import { PROVIDERS, ANTHROPIC_MODELS, DEFAULT_MODELS, DEFAULT_OLLAMA_URL, KEYLESS_PROVIDERS, isProvider, resolveModel, sanitizeAiPatch, maskKey } from './models.js';

const KEY_MAX = 500;
const keyRef = (provider) => `ai:${provider}`;

/** Effective AI configuration (validated; model resolved per provider). */
export function readAiConfig() {
  const stored = getConfig('ai.provider');
  const provider = isProvider(stored) ? stored : 'anthropic';
  return {
    enabled: getConfig('ai.enabled') === true,
    provider,
    model: resolveModel(provider, getConfig('ai.model')),
    ollamaUrl: getConfig('ai.ollamaUrl') || DEFAULT_OLLAMA_URL,
  };
}

/** Throws the localized "AI is turned off" error unless the user opted in. Every AI entry point calls this first. */
export function assertAiEnabled() {
  const cfg = readAiConfig();
  if (!cfg.enabled) throw new AiError('ai_off');
  return cfg;
}

export function readApiKey(provider) {
  if (!isProvider(provider)) throw new AiError('ai_bad_provider', { vars: { p: String(provider) } });
  return readToken(`token:${keyRef(provider)}`);
}

/** Stores (or clears, when empty) the encrypted API key for a provider. Returns only the masked status. */
export function saveApiKey(provider, key) {
  if (!isProvider(provider) || KEYLESS_PROVIDERS.includes(provider)) throw new AiError('ai_bad_provider', { vars: { p: String(provider) } });
  const clean = typeof key === 'string' ? key.trim().slice(0, KEY_MAX) : '';
  storeToken(keyRef(provider), clean);
  return maskKey(clean || null);
}

/** Applies a validated settings patch; switching provider resets the model to that provider's default. */
export function updateAiConfig(patch) {
  const entries = sanitizeAiPatch(patch ?? {});
  const switching = 'ai.provider' in entries && entries['ai.provider'] !== getConfig('ai.provider') && !('ai.model' in entries);
  const next = switching ? { ...entries, 'ai.model': null } : entries;
  for (const [k, v] of Object.entries(next)) setConfig(k, v);
  return aiStatus();
}

/** Renderer-safe status: config, model catalogue and masked key state per provider (never the keys). */
export function aiStatus() {
  const keys = Object.fromEntries(PROVIDERS.filter((p) => !KEYLESS_PROVIDERS.includes(p)).map((p) => [p, maskKey(readApiKey(p))]));
  return { ...readAiConfig(), providers: PROVIDERS, anthropicModels: ANTHROPIC_MODELS, defaultModels: DEFAULT_MODELS, keys };
}
