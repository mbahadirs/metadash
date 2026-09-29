import { CONTENT_DATA_RULES } from '../../prompts.js';
import { LANGUAGE, neutralize, quoteCaption } from './voice.js';

/**
 * Prompts for caption variants, the "shorten to N" follow-up and the AI hashtag re-rank (v1.5 chunk B).
 * Notes, alt texts, file names, example captions and the brief are quoted data inside tags.
 */
export const ANGLES = ['question-hook', 'story', 'benefit', 'behind-the-scenes', 'social-proof', 'how-to', 'bold-claim', 'list'];
export const NOTES_MAX = 2000;
export const BRIEF_SENT_MAX = 3000;
export const EXAMPLES_MAX = 5;
const TEXT_MAX = 5000;

export function captionSchema(langs, total, withThreads) {
  const item = {
    type: 'object',
    properties: {
      lang: { type: 'string', enum: langs },
      angle: { type: 'string', minLength: 2, maxLength: 40 },
      text: { type: 'string', minLength: 1, maxLength: TEXT_MAX },
      ...(withThreads ? { threadsText: { type: 'string', minLength: 1, maxLength: TEXT_MAX } } : {}),
    },
    required: ['lang', 'angle', 'text', ...(withThreads ? ['threadsText'] : [])],
    additionalProperties: false,
  };
  return { type: 'object', properties: { variants: { type: 'array', items: item, minItems: 1, maxItems: total } }, required: ['variants'], additionalProperties: false };
}

/**
 * c: { maxChars, platforms, hashtagMax, hashtagRecommended, threadsMax?, withThreads }.
 */
export function captionSystemPrompt(c) {
  const platformNames = c.platforms.map((p) => ({ instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads' })[p]).join(', ');
  return `You are an expert social media copywriter. You write post captions for ${platformNames} in the brand's own voice.

Hard limits (the app checks them and rejects violations):
- "text": at most ${c.maxChars} characters including spaces, emoji and hashtags; at most ${c.hashtagMax} hashtags${c.hashtagRecommended ? ` (aim for ${c.hashtagRecommended} or fewer)` : ''}.
${c.withThreads ? `- "threadsText": a Threads version of the same idea, at most ${c.threadsMax} characters and at most 1 hashtag (topic tag).\n` : ''}
Writing rules:
- Each variant uses a different angle (e.g. ${ANGLES.slice(0, 6).join(', ')}). Put the angle name in "angle".
- Write each variant entirely in its "lang" (tr = Turkish, en = English). Do not translate between variants; write natively.
- Follow the brand brief when one is given (tone, pronoun sen/siz, emoji and hashtag habits, CTA style). Without a brief, be clear, warm and concise.
- The first line is the hook. Use line breaks for readability. No markdown, no quotation marks around the caption.
- Only state facts found in the notes, image descriptions or images. Never invent prices, dates, discounts, names or claims.
- Hashtags: prefer tags from <tested_hashtags> that fit the content; at most 2 new ones.

${CONTENT_DATA_RULES}`;
}

/**
 * parts: { notes, brief, facts[], examples[{caption}], imageNotes[], tags[{tag, lift}], langs, perLang, imageCount }.
 */
export function captionUserText(p) {
  const out = [`Write ${p.perLang} caption variant(s) per language for: ${p.langs.map((l) => `${l} (${LANGUAGE[l]})`).join(', ')}.${p.imageCount ? ` ${p.imageCount} image(s) of the post are attached.` : ''}`];
  if (p.brief || p.facts?.length) out.push(`<brief>\n${neutralize(clip(p.brief ?? '', BRIEF_SENT_MAX))}${p.facts?.length ? `\n${p.facts.map((f) => `- ${neutralize(f)}`).join('\n')}` : ''}\n</brief>`);
  out.push(`<notes>\n${p.notes ? neutralize(clip(p.notes, NOTES_MAX)) : '(none)'}\n</notes>`);
  if (p.imageNotes?.length) out.push(`<image_notes>\n${p.imageNotes.map((n) => `- ${neutralize(n)}`).join('\n')}\n</image_notes>`);
  if (p.examples?.length) out.push(`<examples note="the account's best-performing past captions, for style only">\n${p.examples.map((e, i) => `<example n="${i + 1}">\n${quoteCaption(e.caption, 500)}\n</example>`).join('\n')}\n</examples>`);
  if (p.tags?.length) out.push(`<tested_hashtags note="from this account's own posts; lift = reach vs the account's median">\n${p.tags.map((t) => `${t.tag} (lift ${t.lift})`).join('\n')}\n</tested_hashtags>`);
  return out.join('\n\n');
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

export const SHORTEN_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: TEXT_MAX } }, required: ['id', 'text'], additionalProperties: false }, minItems: 1 } },
  required: ['items'],
  additionalProperties: false,
};

export function shortenSystemPrompt() {
  return `You shorten social media captions to a hard character limit. Keep the language, the voice, the hook, the key facts and the call to action; drop filler first, then the least important hashtags. Never add new facts. Return every item with its id.

${CONTENT_DATA_RULES}`;
}

/** items: [{ id, text, max }] */
export function shortenUserText(items) {
  return `Shorten each caption to at most the given number of characters (count emoji and spaces).\n\n${items.map((i) => `<caption id="${i.id}" max_chars="${i.max}">\n${neutralize(i.text)}\n</caption>`).join('\n')}`;
}

export const HASHTAG_RANK_SCHEMA = {
  type: 'object',
  properties: {
    order: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 30 },
    untested: { type: 'array', items: { type: 'object', properties: { tag: { type: 'string', maxLength: 60 }, reason: { type: 'string', maxLength: 200 } }, required: ['tag', 'reason'], additionalProperties: false }, maxItems: 6 }, // ≤ 3 kept after local filtering
  },
  required: ['order', 'untested'],
  additionalProperties: false,
};

export function hashtagSystemPrompt(lang, platform) {
  return `You help choose hashtags for one ${platform} post. You get the caption/notes and a list of hashtags this account has already used, with their measured performance.

- "order": choose and order the most fitting tags ONLY from <tested_hashtags> (copy them exactly). Leave out tags that do not fit the content.
- "untested": at most 3 new, specific, relevant hashtags that are not in the list, each with a one-line reason in ${LANGUAGE[lang] ?? 'English'}. No generic spam tags (#love, #instagood, #follow…).

${CONTENT_DATA_RULES}`;
}

export function hashtagUserText({ caption, notes, tags }) {
  return [
    `<caption>\n${caption ? quoteCaption(caption, 2200) : '(empty)'}\n</caption>`,
    `<notes>\n${notes ? neutralize(clip(notes, NOTES_MAX)) : '(none)'}\n</notes>`,
    `<tested_hashtags>\n${tags.map((t) => `${t.tag} posts=${t.posts} lift=${t.lift}`).join('\n')}\n</tested_hashtags>`,
  ].join('\n\n');
}
