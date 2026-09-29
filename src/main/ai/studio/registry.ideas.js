import { generateIdeas, ideasToDrafts, ideasPreview, ideasSpecialDays, saveCustomSpecialDays } from './ideas.js';
import { runRepurpose, repurposeToDraft, repurposePreview } from './repurpose.js';

/**
 * AI studio registry for v1.5 chunk C: ideas and repurpose (studio:ideas:*, studio:repurpose*).
 * Owned by chunk C — ai/studio/index.js imports this file by its fixed name, so no shared file needs editing.
 *
 *  studio:ideas:generate    { requestId?, accountId, month:'YYYY-MM', count?, pillars?, langs, includeSpecialDays? } → { ideas, usage, costUsd, generationId }
 *  studio:ideas:toDrafts    { accountId, ideas, schedule:'suggested'|'none', month? } → { postIds }
 *  studio:ideas:days        { month?, lang? } → { days, custom }            (extra channel: studio.call('ideas:days', …))
 *  studio:ideas:days:save   { custom:[{ date, name }] } → { custom }        (extra channel)
 *  studio:repurpose         { requestId?, source:{mediaId}|{postId}, to, lang, transcript? } → { draft, usage, costUsd, generationId }
 *  studio:repurpose:toDraft { source, to, draft, accountIds } → { postId }
 * previews: ideas, repurpose (studio:preview).
 */
export const registry = {
  handlers: {
    'studio:ideas:generate': (p) => generateIdeas(p),
    'studio:ideas:toDrafts': (p) => ideasToDrafts(p),
    'studio:ideas:days': (p) => ideasSpecialDays(p),
    'studio:ideas:days:save': (p) => ({ custom: saveCustomSpecialDays(p.custom) }),
    'studio:repurpose': (p) => runRepurpose(p),
    'studio:repurpose:toDraft': (p) => repurposeToDraft(p),
  },
  previews: {
    ideas: (params) => ideasPreview(params),
    repurpose: (params) => repurposePreview(params),
  },
};
