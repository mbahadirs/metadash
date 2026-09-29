import { aiStatus, updateAiConfig, saveApiKey } from '../ai/settings.js';
import { reportCommentary, explainAnomaly, testConnection } from '../ai/service.js';

/** Opt-in AI assistant. Settings/status work while disabled; every call that talks to a provider checks ai.enabled first. */
export function registerAiHandlers(handle) {
  handle('ai:status', () => aiStatus());
  handle('ai:setConfig', (patch) => updateAiConfig(patch));
  handle('ai:setKey', ({ provider, key } = {}) => { saveApiKey(provider, key); return aiStatus(); });
  handle('ai:test', () => testConnection());
  handle('ai:reportCommentary', (params) => reportCommentary(params ?? {}));
  handle('ai:explainAnomaly', (params) => explainAnomaly(params ?? {}));
}
