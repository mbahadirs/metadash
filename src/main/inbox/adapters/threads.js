import { threadsClient } from '../../providers/threads/client.js';
import { commentKey } from '../keys.js';
import { cleanText, toMs, topLevelOf } from './shared.js';

/**
 * Built-in Threads inbox adapter (graph.threads.net, Threads user token).
 * Docs checked 2026-09 (developers.facebook.com/docs/permissions, /documentation/threads/retrieve-and-manage-replies/*,
 * /documentation/threads/reply-management):
 *   read  GET /{media-id}/conversation fields=id,text,username,timestamp,replied_to,root_post,is_reply_owned_by_me,
 *         hide_status,permalink — threads_basic + threads_read_replies ("read replies to a user's thread").
 *   reply POST /{user-id}/threads media_type=TEXT text reply_to_id, then POST /{user-id}/threads_publish creation_id —
 *         threads_manage_replies ("create a reply on behalf of a Threads profile") + threads_content_publish (VERIFY:
 *         Meta suggests waiting ~30 s before publishing; TEXT containers are normally ready at once).
 *   hide  POST /{reply-id}/manage_reply hide=true|false — threads_manage_replies.
 * maxReplyLength 500 (Threads post text limit). Keys 'th-<id>'; nested replies are folded under the top-level reply.
 */
const FIELDS = 'id,text,username,timestamp,replied_to,root_post,is_reply_owned_by_me,hide_status,permalink';
const HIDDEN_STATES = new Set(['HIDDEN']);
const token = (ctx) => ctx.tokenFor('threads');
const client = (ctx) => ctx.threads ?? threadsClient;
const userId = (account) => account.externalId ?? String(account.igId).replace(/^th-/, '');

export function normalizeThreads(raw, { account, post, fetchedAt }) {
  const postId = String(post.externalId ?? post.mediaId).replace(/^th-/, '');
  const list = (raw ?? []).filter((c) => c?.id);
  const parentOf = new Map(list.map((c) => [String(c.id), c.replied_to?.id != null ? String(c.replied_to.id) : postId]));
  const owner = String(account.username ?? '').toLowerCase();
  return list.map((c) => {
    const id = String(c.id);
    const top = topLevelOf(id, parentOf, postId);
    const own = c.is_reply_owned_by_me === true || (!!owner && String(c.username ?? '').toLowerCase() === owner);
    return {
      commentId: commentKey('threads', id), externalId: id, mediaId: post.mediaId, accountId: account.igId, platform: 'threads',
      parentId: top ? commentKey('threads', top) : null, authorId: null, username: c.username ?? '', text: cleanText(c.text),
      likeCount: 0, createdAt: toMs(c.timestamp) ?? fetchedAt, isFromOwner: own,
      permalink: typeof c.permalink === 'string' && c.permalink.startsWith('https://') ? c.permalink : null,
      isHidden: c.hide_status == null ? null : HIDDEN_STATES.has(String(c.hide_status)), fetchedAt,
    };
  });
}

export const threadsInbox = {
  platform: 'threads',
  scopes: { read: ['threads_basic', 'threads_read_replies'], reply: ['threads_basic', 'threads_content_publish', 'threads_manage_replies'], hide: ['threads_basic', 'threads_manage_replies'] },
  maxReplyLength: 500,
  async fetch(ctx, account, post, { now = Date.now(), max = 500 } = {}) {
    const id = String(post.externalId ?? post.mediaId).replace(/^th-/, '');
    const items = await client(ctx).getAll(`/${encodeURIComponent(id)}/conversation`, { fields: FIELDS, reverse: 'false', limit: 100 }, { token: token(ctx), max, signal: ctx.signal });
    return normalizeThreads(items, { account, post, fetchedAt: now });
  },
  async reply(ctx, account, comment, text) {
    const c = client(ctx);
    const uid = encodeURIComponent(userId(account));
    const container = await c.post(`/${uid}/threads`, { media_type: 'TEXT', text, reply_to_id: comment.externalId }, { token: token(ctx) });
    if (!container?.id) throw Object.assign(new Error('no container id'), { code: 'no_container' });
    const res = await c.post(`/${uid}/threads_publish`, { creation_id: container.id }, { token: token(ctx) });
    return { remoteId: res?.id != null ? String(res.id) : null, createdAt: Date.now() };
  },
  async hide(ctx, _account, comment, hidden) {
    await client(ctx).post(`/${encodeURIComponent(comment.externalId)}/manage_reply`, { hide: hidden ? 'true' : 'false' }, { token: token(ctx) });
  },
};
