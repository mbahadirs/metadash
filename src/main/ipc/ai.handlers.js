import { aiStatus, updateAiConfig, saveApiKey, assertAiEnabled } from '../ai/settings.js';
import { reportCommentary, explainAnomaly, testConnection } from '../ai/service.js';
import { askData, cancelAsk } from '../ai/ask/service.js';

/** Opt-in AI assistant. Settings/status work while disabled; every call that talks to a provider checks ai.enabled first. */
export function registerAiHandlers(handle) {
  handle('ai:status', () => aiStatus());
  handle('ai:setConfig', (patch) => updateAiConfig(patch));
  handle('ai:setKey', ({ provider, key } = {}) => { saveApiKey(provider, key); return aiStatus(); });
  handle('ai:test', () => testConnection());
  handle('ai:reportCommentary', (params) => reportCommentary(params ?? {}));
  handle('ai:explainAnomaly', (params) => explainAnomaly(params ?? {}));
  handle('ai:ask', (params) => askData(params ?? {}));
  handle('ai:askCancel', ({ requestId } = {}) => { assertAiEnabled(); return { cancelled: cancelAsk(requestId) }; });
}
