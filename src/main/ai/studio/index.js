import { isSupportedLang } from '../../locales/catalog.js';
import { notImplemented } from '../../ipc/notImplemented.js';
import { currentLang } from '../../i18n.js';
import { commentarySummary } from '../summaries/commentary.js';
import { anomalySummary } from '../summaries/anomaly.js';
import { commentarySystemPrompt, anomalySystemPrompt, askSystemPrompt, dataMessage } from '../prompts.js';
import { buildSchemaDescription } from '../ask/schema.js';
import { registry as voice } from './registry.voice.js';
import { registry as ideas } from './registry.ideas.js';
import { registry as inbox } from './registry.inbox.js';

/**
 * AI studio registry. Chunk A owns the core channels (ipc/studio.handlers.js); chunks B/C/D plug their handlers and
 * previews in through registry.{voice,ideas,inbox}.js. Every channel in STUDIO_CHANNELS is always registered with IPC:
 * until a chunk provides it, it answers NOT_IMPLEMENTED. Extra studio:* channels a chunk adds are registered too.
 */
export const STUDIO_CORE_CHANNELS = ['studio:capabilities', 'studio:preview', 'studio:cancel', 'studio:usage', 'studio:settings:get', 'studio:settings:set'];

export const STUDIO_CHANNELS = [
  // chunk B (registry.voice.js)
  'studio:voice:get', 'studio:voice:derive', 'studio:voice:save', 'studio:captions:generate', 'studio:captions:save', 'studio:hashtags:suggest',
  // chunk C (registry.ideas.js)
  'studio:ideas:generate', 'studio:ideas:toDrafts', 'studio:repurpose', 'studio:repurpose:toDraft',
  // chunk D (registry.inbox.js)
  'studio:replies:inbox', 'studio:replies:refresh', 'studio:replies:suggest', 'studio:replies:send', 'studio:replies:dismiss',
  'studio:ab:list', 'studio:ab:get', 'studio:ab:create', 'studio:ab:tag', 'studio:ab:conclude',
];

const REGISTRIES = { voice, ideas, inbox };
const pickLang = (lang) => (isSupportedLang(lang) ? lang : currentLang());

/** Previews for the pre-studio AI features (same builders as ai/service.js and ai/ask/service.js). */
const CORE_PREVIEWS = {
  commentary: (params) => {
    const lang = pickLang(params.lang);
    const summary = commentarySummary({ ...params, lang });
    const text = `${commentarySystemPrompt(lang)}\n${dataMessage('Write the commentary for this report.', summary)}`;
    return { items: [{ kind: 'table', label: 'analytics_summary', chars: JSON.stringify(summary).length }], text, expectedOutputTokens: 600 };
  },
  anomaly: (params) => {
    const lang = pickLang(params.lang);
    const summary = anomalySummary(params);
    const text = `${anomalySystemPrompt(lang)}\n${dataMessage('Explain this anomaly.', summary)}`;
    return { items: [{ kind: 'table', label: 'anomaly_summary', chars: JSON.stringify(summary).length }], text, expectedOutputTokens: 300 };
  },
  ask: (params) => {
    const lang = pickLang(params.lang);
    const question = String(params.question ?? '');
    const schema = buildSchemaDescription();
    return {
      items: [{ kind: 'text', label: 'question', chars: question.length }, { kind: 'table', label: 'db_schema', chars: schema.length }],
      text: `${askSystemPrompt(lang, schema)}\n${question}`,
      expectedOutputTokens: 1500,
    };
  },
};

function stub(channel) {
  const fn = async () => { throw notImplemented(); };
  fn.isStub = true;
  fn.channel = channel;
  return fn;
}

/** channel → handler(payload, ctx), including NOT_IMPLEMENTED stubs for documented channels no chunk provides yet. */
export function studioHandlers() {
  const out = Object.fromEntries(STUDIO_CHANNELS.map((ch) => [ch, stub(ch)]));
  for (const [name, reg] of Object.entries(REGISTRIES)) {
    for (const [channel, fn] of Object.entries(reg?.handlers ?? {})) {
      if (!channel.startsWith('studio:') || STUDIO_CORE_CHANNELS.includes(channel) || typeof fn !== 'function') {
        throw new Error(`registry.${name}.js: invalid studio channel "${channel}"`);
      }
      out[channel] = fn;
    }
  }
  return out;
}

/** feature → preview builder (core + chunk registries). */
export function studioPreviews() {
  const out = { ...CORE_PREVIEWS };
  for (const reg of Object.values(REGISTRIES)) Object.assign(out, reg?.previews ?? {});
  return out;
}
