import { metaClient } from '../../meta/client.js';
import { replyToComment } from '../../meta/comments.js';
import { cleanText, toMs, metaToken } from './shared.js';

/**
 * Built-in Instagram inbox adapter (Graph API, user token).
 * VERIFIED 2026-09 (developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/comments,
 * …/ig-comment, …/ig-comment/replies):
 *   read  GET /{ig-media-id}/comments fields=id,text,timestamp,username,like_count,hidden,from{id,username},replies{…}
 *         (instagram_basic + instagram_manage_comments; pages_read_engagement for the Page link)
 *   reply POST /{ig-comment-id}/replies message=… (instagram_manage_comments; top-level comments only)
 *   hide  POST /{ig-comment-id} hide=true|false (instagram_manage_comments)
 * maxReplyLength 2200 is the caption limit; the comment limit is assumed equal (VERIFY).
 * Stored keys are the raw ids (keeps pre-2.0 rows). Owner = comment username equals the account username.
 */
const FIELDS = 'id,text,timestamp,username,like_count,hidden,from{id,username},replies{id,text,timestamp,username,from{id,username},hidden}';

export function normalizeInstagram(raw, { account, post, fetchedAt }) {
  const owner = String(account.username ?? '').toLowerCase();
  const isOwner = (u) => !!owner && String(u ?? '').toLowerCase() === owner;
  const out = [];
  for (const c of raw ?? []) {
    if (!c?.id) continue;
    out.push({
      commentId: String(c.id), externalId: String(c.id), mediaId: post.mediaId, accountId: account.igId, platform: 'instagram',
      parentId: null, authorId: c.from?.id != null ? String(c.from.id) : null, username: c.username ?? c.from?.username ?? '',
      text: cleanText(c.text), likeCount: Number(c.like_count) || 0, createdAt: toMs(c.timestamp) ?? fetchedAt,
      isFromOwner: isOwner(c.username ?? c.from?.username), permalink: null, isHidden: c.hidden == null ? null : !!c.hidden, fetchedAt,
    });
    for (const r of c.replies?.data ?? []) {
      if (!r?.id) continue;
      out.push({
        commentId: String(r.id), externalId: String(r.id), mediaId: post.mediaId, accountId: account.igId, platform: 'instagram',
        parentId: String(c.id), authorId: r.from?.id != null ? String(r.from.id) : null, username: r.username ?? r.from?.username ?? '',
        text: cleanText(r.text), likeCount: Number(r.like_count) || 0, createdAt: toMs(r.timestamp) ?? fetchedAt,
        isFromOwner: isOwner(r.username ?? r.from?.username), permalink: null, isHidden: r.hidden == null ? null : !!r.hidden, fetchedAt,
      });
    }
  }
  return out;
}

export const instagramInbox = {
  platform: 'instagram',
  scopes: { read: ['instagram_basic', 'instagram_manage_comments'], reply: ['instagram_manage_comments'], hide: ['instagram_manage_comments'] },
  maxReplyLength: 2200,
  async fetch(ctx, account, post, { now = Date.now(), max = 300 } = {}) {
    const client = ctx.meta ?? metaClient;
    const items = await client.getAll(`/${encodeURIComponent(post.externalId ?? post.mediaId)}/comments`, { fields: FIELDS, limit: 50 }, { token: metaToken(ctx), max, signal: ctx.signal });
    return normalizeInstagram(items, { account, post, fetchedAt: now });
  },
  async reply(ctx, _account, comment, text) {
    const res = await replyToComment({ platform: 'instagram', commentId: comment.externalId, text, token: metaToken(ctx), client: ctx.meta ?? metaClient });
    return { remoteId: res.id, createdAt: Date.now() };
  },
  async hide(ctx, _account, comment, hidden) {
    const client = ctx.meta ?? metaClient;
    await client.post(`/${encodeURIComponent(comment.externalId)}`, { hide: hidden ? 'true' : 'false' }, { token: metaToken(ctx) });
  },
};
