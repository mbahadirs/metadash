import { currentLang } from '../i18n.js';
import { assertAiEnabled, readApiKey } from './settings.js';
import { createProvider } from './providers/index.js';
import { runToolLoop } from './toolLoop.js';
import { commentarySummary } from './summaries/commentary.js';
import { anomalySummary } from './summaries/anomaly.js';
import { commentarySystemPrompt, anomalySystemPrompt, dataMessage } from './prompts.js';

const REQUEST_TIMEOUT_MS = 180_000;
const pickLang = (lang) => (lang === 'tr' || lang === 'en' ? lang : currentLang());

/** Resolves the configured provider. Throws "AI is turned off" before touching any key or network. */
function activeProvider() {
  const cfg = assertAiEnabled();
  return createProvider(cfg, cfg.provider === 'ollama' ? null : readApiKey(cfg.provider));
}

async function ask(provider, system, userText) {
  const res = await runToolLoop({ provider, system, userText, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { text: res.text, truncated: res.truncated, provider: provider.id, model: provider.model, usage: res.usage };
}

/** Client-facing report commentary from the same params as export:preview. */
export async function reportCommentary(params = {}) {
  const provider = activeProvider();
  const lang = pickLang(params.lang);
  const summary = commentarySummary({ ...params, lang });
  return ask(provider, commentarySystemPrompt(lang), dataMessage('Write the commentary for this report.', summary));
}

/** Short likely-cause explanation for one anomaly. */
export async function explainAnomaly(params = {}) {
  const provider = activeProvider();
  const lang = pickLang(params.lang);
  const summary = anomalySummary(params);
  return ask(provider, anomalySystemPrompt(lang), dataMessage('Explain this anomaly.', summary));
}

/** Tiny round-trip to verify provider, model and key. */
export async function testConnection() {
  const provider = activeProvider();
  const res = await ask(provider, 'You are a connectivity check. Answer with one short word.', 'Reply with: OK');
  return { ok: true, provider: res.provider, model: res.model, reply: res.text.slice(0, 40) };
}
