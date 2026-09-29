import { deriveVoice, getVoice, saveVoice, voicePreview } from './voice.js';
import { generateCaptions, saveCaptions, captionPreview } from './captions.js';
import { suggestTags, hashtagsPreview } from './hashtags.js';

/**
 * AI studio registry for v1.5 chunk B: voice, captions and hashtags (studio:voice:*, studio:captions:*, studio:hashtags:*).
 * ai/studio/index.js imports this file by its fixed name. Every model call goes through runtime.runGeneration.
 */
export const registry = {
  handlers: {
    'studio:voice:get': async (payload) => getVoice(payload),
    'studio:voice:derive': async (payload) => deriveVoice(payload),
    'studio:voice:save': async (payload) => saveVoice(payload),
    'studio:captions:generate': async (payload) => generateCaptions(payload),
    'studio:captions:save': async (payload) => saveCaptions(payload),
    'studio:hashtags:suggest': async (payload) => suggestTags(payload),
  },
  previews: {
    voice: async (params) => voicePreview(params),
    caption: async (params) => captionPreview(params),
    hashtags: async (params) => hashtagsPreview(params),
  },
};
