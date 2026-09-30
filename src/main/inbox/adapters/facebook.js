import { metaClient } from '../../meta/client.js';
import { replyToComment } from '../../meta/comments.js';
import { commentKey } from '../keys.js';
import { cleanText, toMs, topLevelOf } from './shared.js';

/**
 * Built-in Facebook Page inbox adapter (Page access token).
 * Docs checked 2026-09 (developers.facebook.com/docs/graph-api/reference/object/comments and /docs/permissions):
 *   read  GET /{page-post-id}/comments filter=stream fields=id,message,created_time,from,parent{id},like_count,
 *         permalink_url,is_hidden — "the same permissions required to view the parent object": pages_read_engagement;
 *         comments written by users are user-generated content → pages_read_user_content ("read user generated content
 *         on the Page, such as posts, comments…"). Without it `from` may be missing → shown as "Facebook user".
 *   reply POST /{comment-id}/comments message=… — Page token of a person with the MODERATE task + pages_manage_engagement
 *         ("create, edit and delete comments posted on the Page"). VERIFIED.
 *   hide  POST /{comment-id} is_hidden=true|false — pages_manage_engagement (VERIFY: permission page lists create/edit/delete).
 * maxReplyLength 8000 (VERIFY). Keys 'fbc-<id>'; replies-to-replies are folded under their top-level comment.
 */
const FIELDS = 'id,message,created_time,from{id,name},parent{id},like_count,permalink_url,is_hidden';

export async function pageTokenOf(ctx, account) {
  const cached = ctx.pageTokens?.get?.(account.externalId);
  if (cached) return cached;
  if (typeof ctx.pageToken === 'function') return ctx.pageToken(account.externalId);
  throw Object.assign(new Error('page token unavailable'), { code: 'page_token_missing' });
}

export function normalizeFacebook(raw, { account, post, fetchedAt }) {
  const postId = String(post.externalId ?? post.mediaId);
  const parentOf = new Map((raw ?? []).filter((c) => c?.id).map((c) => [String(c.id), c.parent?.id != null ? String(c.parent.id) : null]));
  return (raw ?? []).filter((c) => c?.id).map((c) => {
    const id = String(c.id);
    const top = topLevelOf(id, parentOf, postId);
    return {
      commentId: commentKey('facebook', id), externalId: id, mediaId: post.mediaId, accountId: account.igId, platform: 'facebook',
      parentId: top ? commentKey('facebook', top) : null, authorId: c.from?.id != null ? String(c.from.id) : null,
      username: c.from?.name ?? '', text: cleanText(c.message), likeCount: Number(c.like_count) || 0,
      createdAt: toMs(c.created_time) ?? fetchedAt, isFromOwner: c.from?.id != null && String(c.from.id) === String(account.externalId),
      permalink: typeof c.permalink_url === 'string' && c.permalink_url.startsWith('https://') ? c.permalink_url : null,
      isHidden: c.is_hidden == null ? null : !!c.is_hidden, fetchedAt,
    };
  });
}

export const facebookInbox = {
  platform: 'facebook',
  scopes: { read: ['pages_read_engagement', 'pages_read_user_content'], reply: ['pages_manage_engagement'], hide: ['pages_manage_engagement'] },
  maxReplyLength: 8000,
  async fetch(ctx, account, post, { now = Date.now(), max = 500 } = {}) {
    const client = ctx.meta ?? metaClient;
    const token = await pageTokenOf(ctx, account);
    const items = await client.getAll(`/${encodeURIComponent(post.externalId ?? post.mediaId)}/comments`, { filter: 'stream', fields: FIELDS, limit: 100 }, { token, max, signal: ctx.signal });
    return normalizeFacebook(items, { account, post, fetchedAt: now });
  },
  async reply(ctx, account, comment, text) {
    const token = await pageTokenOf(ctx, account);
    const res = await replyToComment({ platform: 'facebook', commentId: comment.externalId, text, token, client: ctx.meta ?? metaClient });
    return { remoteId: res.id, createdAt: Date.now() };
  },
  async hide(ctx, account, comment, hidden) {
    const token = await pageTokenOf(ctx, account);
    await (ctx.meta ?? metaClient).post(`/${encodeURIComponent(comment.externalId)}`, { is_hidden: hidden ? 'true' : 'false' }, { token });
  },
};
