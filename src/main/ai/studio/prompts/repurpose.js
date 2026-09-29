import { CONTENT_DATA_RULES } from '../../prompts.js';

/**
 * Prompts for repurposing one post into another format (v1.5 chunk C). The source caption, the optional transcript
 * and the brand brief are quoted data inside tags; @handles are replaced before sending.
 */
const LANGUAGE = { en: 'English', tr: 'Turkish' };
export const REPURPOSE_TARGETS = ['carousel', 'threads', 'facebook', 'story'];
export const RP_CAPTION_SENT_MAX = 2200;
export const RP_TRANSCRIPT_MAX = 8000;
export const RP_BRIEF_MAX = 3000;
export const THREADS_CHAIN_MAX = 5;
export const CAROUSEL_SLIDES = { min: 3, max: 10 };
export const STORY_FRAMES = { min: 2, max: 7 };

const str = { type: 'string' };

export const REPURPOSE_SCHEMAS = {
  carousel: {
    type: 'object',
    properties: {
      title: str,
      slides: { type: 'array', minItems: CAROUSEL_SLIDES.min, maxItems: CAROUSEL_SLIDES.max, items: { type: 'object', properties: { title: str, body: str }, required: ['title', 'body'], additionalProperties: false } },
      caption: str,
    },
    required: ['title', 'slides', 'caption'],
    additionalProperties: false,
  },
  threads: {
    type: 'object',
    properties: { title: str, posts: { type: 'array', minItems: 1, maxItems: THREADS_CHAIN_MAX, items: str } },
    required: ['title', 'posts'],
    additionalProperties: false,
  },
  facebook: {
    type: 'object',
    properties: { title: str, text: str },
    required: ['title', 'text'],
    additionalProperties: false,
  },
  story: {
    type: 'object',
    properties: { title: str, frames: { type: 'array', minItems: STORY_FRAMES.min, maxItems: STORY_FRAMES.max, items: { type: 'object', properties: { text: str }, required: ['text'], additionalProperties: false } } },
    required: ['title', 'frames'],
    additionalProperties: false,
  },
};

const TARGET_RULES = {
  carousel: `Target: an Instagram carousel.
- slides: ${CAROUSEL_SLIDES.min}–${CAROUSEL_SLIDES.max} slides. Slide 1 is the hook (a bold promise or question); the middle slides deliver one idea each; the last slide is a call to action (save / share / comment / follow).
- Each slide: title max 8 words, body max 40 words. Plain text, no Markdown, at most one emoji per slide.
- caption: 60–150 words that invite people to swipe, with a call to action. Hashtags only if the brief or the source uses them (max 5), at the end.`,
  threads: `Target: a Threads post (text only).
- posts: usually 1 post. Use a chain of 2–${THREADS_CHAIN_MAX} posts only if the content clearly needs it.
- Every post MUST be at most {limit} characters, counting emoji and spaces. Aim for 200–400.
- Conversational, first person, no hashtags (at most one topic tag), no "link in bio".`,
  facebook: `Target: a Facebook Page post.
- text: 60–200 words, short paragraphs separated by blank lines, a clear call to action. Hashtags: at most 2. Links are clickable on Facebook, but do not invent URLs.`,
  story: `Target: an Instagram Story sequence.
- frames: ${STORY_FRAMES.min}–${STORY_FRAMES.max} frames, each max 15 words of on-screen text. The first frame hooks, the last frame has a call to action (reply, poll idea, link sticker idea, or "see the post").`,
};

export function repurposeSystemPrompt(lang, to, { limit = 500 } = {}) {
  return `You are a senior social media copywriter. You repurpose one existing post into a different format for the same brand, keeping its core message and what made it perform, and adapting structure, length and tone to the new format.

Write everything in ${LANGUAGE[lang] ?? 'English'}.

${TARGET_RULES[to].replace('{limit}', String(limit))}

General rules:
- title: a short internal working title (max 8 words) for the content planner.
- Follow the brand brief (tone, pronoun, emoji and hashtag habits) when one is given.
- Keep facts from the source only; never invent prices, dates, statistics or product claims. If the source is a video, the transcript (when given) is the best source of the content.
- Do not mention that this is repurposed.

${CONTENT_DATA_RULES}`;
}

/** User turn. `src` comes from repurpose.js loadSource() (already anonymized and truncated). */
export function repurposeUserText(src, { brief, transcript }) {
  const meta = { format: src.type, platform: src.platform, date: src.date, metrics: src.metrics };
  return [
    `Repurpose this ${src.platform} ${src.type} post.`,
    `Source post facts:\n<source_meta>\n${JSON.stringify(meta)}\n</source_meta>`,
    src.title ? `Working title of the source:\n<title>\n${src.title}\n</title>` : '',
    `Source caption (quoted data):\n<caption>\n${src.caption || '(no caption)'}\n</caption>`,
    transcript ? `Transcript of the video (quoted data):\n<transcript>\n${transcript}\n</transcript>` : '',
    brief ? `Brand brief:\n<brief>\n${brief}\n</brief>` : '',
    'Return the result with the structured result.',
  ].filter(Boolean).join('\n\n');
}

/** One follow-up call when Threads posts are over the limit. */
export function shortenUserText(posts, limit) {
  return `Shorten each of these Threads posts to at most ${limit} characters (counting emoji and spaces), keeping the meaning, the language and the order. Keep the same number of posts.\n\n<posts>\n${JSON.stringify(posts)}\n</posts>`;
}
