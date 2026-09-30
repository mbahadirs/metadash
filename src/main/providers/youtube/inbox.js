import { MetaError } from '../../meta/errors.js';
import { profileScopes } from '../../db/queries/profiles.js';
import { msg } from '../../i18n.js';
import { SCOPES, hasReplyScope } from './auth.js';
import { fetchCommentThreads, fetchReplies, insertReply, setModerationStatus } from './api.js';
import { clientFor, profileOfAccount } from './client.js';
import { mapThread, channelIdOf, videoIdOf, rawCommentId, commentKey } from './mappers.js';

/**
 * YouTube InboxAdapter (providers/types.js). Comment keys are 'ytc-<commentId>'; owner = authorChannelId equals the
 * channel id. Reading needs youtube.readonly (1 unit per page); replying (comments.insert, 50 units) and hiding
 * (comments.setModerationStatus heldForReview/published, 50 units) need youtube.force-ssl, granted through
 * "Enable replying" (setup:youtube:connect { reply: true }).
 */
export const MAX_REPLY_LENGTH = 10_000;

function requireReplyScope(account) {
  const profile = profileOfAccount(account);
  if (String(profile?.token_ref ?? '').startsWith('demo')) return;
  if (!hasReplyScope(profileScopes(profile))) {
    // Plain Error (not MetaError 10) so the IPC envelope shows this message instead of a Meta permission hint.
    throw Object.assign(new Error(msg('yt_reply_scope_missing')), { code: 'SCOPE_MISSING', isPermissionError: true, scopes: [SCOPES.forceSsl] });
  }
}

export const youtubeInbox = {
  scopes: Object.freeze({ read: [SCOPES.readonly], reply: [SCOPES.forceSsl], hide: [SCOPES.forceSsl] }),
  maxReplyLength: MAX_REPLY_LENGTH,

  async fetch(ctx, account, post, { sinceUnix } = {}) {
    const client = await clientFor(ctx, account);
    const videoId = videoIdOf(post);
    const base = { mediaId: post.mediaId, accountId: account.igId, channelId: channelIdOf(account), videoId };
    const threads = await fetchCommentThreads(client, videoId, { sinceMs: sinceUnix ? sinceUnix * 1000 : 0 });
    const out = [];
    for (const t of threads) {
      const embedded = t.replies?.comments ?? [];
      const total = Number(t.snippet?.totalReplyCount ?? embedded.length);
      // commentThreads embeds only some replies; fetch the full list when more exist.
      const replies = total > embedded.length ? await fetchReplies(client, t.snippet.topLevelComment.id) : embedded;
      out.push(...mapThread(t, { ...base, replies }));
    }
    return out;
  },

  async reply(ctx, account, comment, text) {
    const body = String(text ?? '').trim();
    if (!body) throw new MetaError({ code: 100, message: msg('yt_reply_empty'), endpoint: '/comments', source: 'google' });
    if (body.length > MAX_REPLY_LENGTH) throw new MetaError({ code: 100, message: msg('yt_reply_too_long', { n: MAX_REPLY_LENGTH }), endpoint: '/comments', source: 'google' });
    requireReplyScope(account);
    const client = await clientFor(ctx, account);
    // Replies attach to the top-level comment (YouTube threads are one level deep).
    const parentId = comment.parentId ? rawCommentId(comment.parentId) : (comment.externalId ?? rawCommentId(comment.commentId));
    const res = await insertReply(client, parentId, body);
    return { remoteId: String(res?.id ?? ''), commentId: res?.id ? commentKey(res.id) : null, createdAt: Date.parse(res?.snippet?.publishedAt ?? '') || Date.now() };
  },

  async hide(ctx, account, comment, hidden) {
    requireReplyScope(account);
    const client = await clientFor(ctx, account);
    await setModerationStatus(client, comment.externalId ?? rawCommentId(comment.commentId), hidden ? 'heldForReview' : 'published');
  },
};
