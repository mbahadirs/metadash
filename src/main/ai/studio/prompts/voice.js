import { LANGUAGE } from '../../../locales/catalog.js';
import { CONTENT_DATA_RULES } from '../../prompts.js';

/**
 * Prompts for brand-voice derivation (v1.5 chunk B). Captions and stats are quoted data inside tags; @handles in
 * captions are replaced with "@mention" before sending, and nothing identifies the account (no ids, usernames, clients).
 */
export { LANGUAGE };
export const VOICE_CAPTION_MAX = 600;
export const VOICE_TOP_MAX = 22;
export const VOICE_LOW_MAX = 8;
export const BRIEF_MAX = 4000;
const LIST = (max, itemMax = 160) => ({ type: 'array', items: { type: 'string', minLength: 1, maxLength: itemMax }, maxItems: max });

export const VOICE_SCHEMA = {
  type: 'object',
  properties: {
    brief: { type: 'string', minLength: 40, maxLength: BRIEF_MAX },
    tone: LIST(6, 40),
    formality: { type: 'string', enum: ['casual', 'neutral', 'formal'] },
    pronoun: { type: 'string', enum: ['sen', 'siz', 'none'] },
    ctaPatterns: LIST(6),
    hooks: LIST(6),
    doList: LIST(8),
    dontList: LIST(8),
    visualStyle: { type: 'string', maxLength: 600 },
  },
  required: ['brief', 'tone', 'formality', 'pronoun', 'ctaPatterns', 'hooks', 'doList', 'dontList'],
  additionalProperties: false,
};

export function voiceSystemPrompt(lang) {
  return `You are a senior social media copy strategist. From an account's own post captions and caption statistics, you write a brand voice brief that another writer (human or AI) will follow when drafting new captions for the same account.

Write the brief and every list item in ${LANGUAGE[lang] ?? 'English'}.

What to produce:
- brief: Markdown, 120–300 words, with short sections: Voice & tone, Structure (length, line breaks, hooks, CTA), Emoji & hashtags, Words and phrases to use / avoid. Be concrete and prescriptive ("Open with a question", "2–3 emoji, at the end of lines"), grounded in the captions and the stats.
- tone: 2–5 adjectives. formality: casual | neutral | formal. pronoun: "sen" or "siz" for Turkish captions that address the reader, else "none".
- ctaPatterns / hooks: recurring calls to action and opening patterns seen in the top posts, generalized (no product names or prices).
- doList / dontList: short rules. Use the low-performing captions as contrast: what the top posts do that the low ones do not.
- visualStyle: only when images are attached, one or two sentences on the visual style (colours, composition, people/product focus). Otherwise omit it.

Rules:
- Base every statement on the captions and stats given. Do not invent facts about the brand, its products or audience.
- The numbers in <caption_stats> are exact; do not contradict them.

${CONTENT_DATA_RULES}`;
}

/** Neutralizes tag look-alikes so quoted content cannot close its own block. */
export const neutralize = (s) => String(s ?? '').replace(/<\s*\/?\s*(captions?|brief|notes|caption_stats|image_notes|examples?|tested_hashtags|tags?|variants?)\b/gi, (m) => m.replace('<', '‹'));

/** Clipped, neutralized caption text with @handles masked. */
export function quoteCaption(text, max = VOICE_CAPTION_MAX) {
  const s = String(text ?? '').replace(/@[\p{L}\p{N}_.]{1,30}/gu, '@mention').trim();
  return neutralize(s.length > max ? `${s.slice(0, max)}…` : s);
}

/** stats: voiceStats() output; top/low: [{ caption }]; lang: brief language; imageCount: attached thumbnails. */
export function voiceUserText({ stats, top, low, imageCount = 0 }) {
  const parts = [`Derive the brand voice from these captions${imageCount ? ` and the ${imageCount} attached top-post images` : ''}.`];
  parts.push(`<caption_stats>\n${JSON.stringify(stats)}\n</caption_stats>`);
  parts.push(`<captions group="top_performing">\n${top.map((p, i) => `<caption n="T${i + 1}">\n${quoteCaption(p.caption)}\n</caption>`).join('\n')}\n</captions>`);
  if (low.length) parts.push(`<captions group="low_performing">\n${low.map((p, i) => `<caption n="L${i + 1}">\n${quoteCaption(p.caption)}\n</caption>`).join('\n')}\n</captions>`);
  return parts.join('\n\n');
}
