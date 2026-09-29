import { CONTENT_DATA_RULES } from '../../prompts.js';

/**
 * Prompts for monthly content ideas (v1.5 chunk C). Captions, the brand brief, pillars and special-day names are quoted
 * data inside tags. Nothing identifies the account: no ids, usernames or client names; top posts are referred to by
 * short refs (p1…p10) that are mapped back to media ids locally.
 */
const LANGUAGE = { en: 'English', tr: 'Turkish' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const IDEA_FORMATS = ['reel', 'carousel', 'image', 'story', 'text'];
/** Formats the model may propose per platform ('text' only where a text-only post exists). */
export const PLATFORM_IDEA_FORMATS = {
  instagram: ['reel', 'carousel', 'image', 'story'],
  facebook: ['reel', 'carousel', 'image', 'text'],
  threads: ['text', 'image', 'carousel', 'reel'],
};
export const IDEA_CAPTION_SENT_MAX = 500;
export const IDEA_BRIEF_MAX = 3000;

export function ideasSchema(formats = IDEA_FORMATS) {
  return {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        minItems: 1,
        maxItems: 31,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1 },
            format: { type: 'string', enum: formats },
            pillar: { type: 'string' },
            hook: { type: 'string' },
            captionDraft: { type: 'string' },
            suggestedDate: { type: 'string' },
            rationale: { type: 'string' },
            basedOn: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'format', 'pillar', 'hook', 'captionDraft', 'suggestedDate', 'rationale', 'basedOn'],
          additionalProperties: false,
        },
      },
    },
    required: ['ideas'],
    additionalProperties: false,
  };
}

export function ideasSystemPrompt(lang) {
  return `You are a senior social media content strategist at an agency. You plan one month of organic posts for one account, grounded in what has worked for that account before.

Write every title, hook, caption draft and rationale in ${LANGUAGE[lang] ?? 'English'}.

How to plan:
- Propose exactly the requested number of ideas, spread across the month (roughly even spacing; no two ideas on the same day unless there are more ideas than days).
- Use the format performance and the top posts to choose the format mix: favour formats with higher average reach and engagement, but keep some variety. Only use the allowed formats.
- Use the best posting times: prefer suggested dates on the weekdays listed there.
- Cover the content pillars given by the user (if any) in rotation; otherwise infer 3–5 pillars from the top posts and name them briefly.
- Special days: tie an idea to a special day only when it fits the account naturally; set its suggestedDate on or 1–2 days before that day. For days marked "solemn" write respectful, non-promotional content, or skip them. Dates marked "approx" may shift by a day, so do not state the exact date in the caption.
- Follow the brand brief (tone, pronoun, emoji and hashtag habits) when one is given.

Fields:
- title: short internal working title (max 8 words).
- hook: the first line / first 3 seconds that stops the scroll.
- captionDraft: a ready-to-edit caption (with a call to action; hashtags only if the brief or top posts use them, max 5).
- suggestedDate: "YYYY-MM-DD" inside the requested month, or "" if no specific day matters.
- rationale: one sentence on why this should work, citing the data (e.g. "carousels average 2× the reach of images", "like p3").
- basedOn: the refs (p1, p2, …) of the top posts that inspired the idea; [] if none.

Never copy a top post's caption; build on the angle. Never invent statistics, prices, dates of events or product facts that are not in the data.

${CONTENT_DATA_RULES}`;
}

const json = (v) => JSON.stringify(v);

/** User turn: request parameters + quoted data blocks. `ctx` comes from ideas.js buildIdeasContext(). */
export function ideasUserText(ctx) {
  const parts = [
    `Plan ${ctx.count} content ideas for ${ctx.monthLabel} (${ctx.month}) for one ${ctx.platform} account.`,
    `Allowed formats: ${ctx.formats.join(', ')}.`,
    ctx.pillars.length ? `Content pillars (rotate through them):\n<pillars>\n${json(ctx.pillars)}\n</pillars>` : 'No pillars given: infer them from the top posts.',
    ctx.brief ? `Brand brief:\n<brief>\n${ctx.brief}\n</brief>` : 'No brand brief is saved for this account.',
    `Format performance over the last ${ctx.historyDays} days (avgEr and avgSaveRate are %):\n<format_performance>\n${json(ctx.formatMix)}\n</format_performance>`,
    ctx.topPosts.length ? `Top posts of the last 12 months by reach (captions are quoted data):\n<top_posts>\n${json(ctx.topPosts)}\n</top_posts>` : 'There are no synced posts for this account yet: rely on the pillars, the brief and general best practice.',
    `Best posting times (local time; source "account" = this account's history, "portfolio" = similar accounts, "default" = general prior):\n<best_times>\n${json(ctx.bestTimes.map((s) => ({ weekday: WEEKDAYS[s.weekday], hour: s.hour, source: s.source })))}\n</best_times>`,
    ctx.specialDays.length ? `Special days in this month:\n<special_days>\n${json(ctx.specialDays)}\n</special_days>` : 'No special days are included for this month.',
    `Return the ideas with the structured result.`,
  ];
  return parts.join('\n\n');
}
