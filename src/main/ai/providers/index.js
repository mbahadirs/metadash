import { AiError } from '../errors.js';
import { KEYLESS_PROVIDERS } from '../models.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider } from './openai.js';
import { createGeminiProvider } from './gemini.js';
import { createOllamaProvider } from './ollama.js';

const FACTORIES = {
  anthropic: ({ apiKey, model }) => createAnthropicProvider({ apiKey, model }),
  openai: ({ apiKey, model }) => createOpenAIProvider({ apiKey, model }),
  gemini: ({ apiKey, model }) => createGeminiProvider({ apiKey, model }),
  ollama: ({ model, ollamaUrl }) => createOllamaProvider({ model, baseUrl: ollamaUrl }),
};

/** Builds the configured provider; throws a localized error when a required key is missing. */
export function createProvider({ provider, model, ollamaUrl }, apiKey) {
  const factory = FACTORIES[provider];
  if (!factory) throw new AiError('ai_bad_provider', { vars: { p: String(provider) } });
  if (!KEYLESS_PROVIDERS.includes(provider) && !apiKey) throw new AiError('ai_no_key', { vars: { p: provider } });
  return factory({ apiKey, model, ollamaUrl });
}
