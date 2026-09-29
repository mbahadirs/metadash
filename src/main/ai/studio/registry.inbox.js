import { listInbox, refreshInbox, suggestReplies, sendReply, dismissInboxComment, replyPreview } from './replies.js';
import { listTests, getTestResults, createTest, tagItem, untagItem, concludeTest, removeTest, candidates } from './abtests.js';

/**
 * AI studio registry for v1.5 chunk D: inbox and experiments (studio:replies:*, studio:ab:*).
 * Owned by chunk D — ai/studio/index.js imports this file by its fixed name, so no shared file needs editing.
 * Extra channels (renderer: studio.call('ab:untag', …)): studio:ab:untag, studio:ab:delete, studio:ab:candidates.
 * studio:replies:send requires { confirmed: true } (set only by the renderer's confirmation dialog).
 */
export const registry = {
  handlers: {
    'studio:replies:inbox': (p) => listInbox(p),
    'studio:replies:refresh': (p) => refreshInbox(p),
    'studio:replies:suggest': (p) => suggestReplies(p),
    'studio:replies:send': (p) => sendReply(p),
    'studio:replies:dismiss': (p) => dismissInboxComment(p),
    'studio:ab:list': () => listTests(),
    'studio:ab:get': (p) => getTestResults(p),
    'studio:ab:create': (p) => createTest(p),
    'studio:ab:tag': (p) => tagItem(p),
    'studio:ab:conclude': (p) => concludeTest(p),
    'studio:ab:untag': (p) => untagItem(p),
    'studio:ab:delete': (p) => removeTest(p),
    'studio:ab:candidates': (p) => candidates(p),
  },
  previews: {
    reply: (params) => replyPreview(params),
  },
};
