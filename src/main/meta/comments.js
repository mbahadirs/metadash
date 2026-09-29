import { metaClient } from './client.js';

/**
 * Replying to comments through the Graph API (v1.5 Studio inbox). Never retried: a retried write could reply twice.
 *
 * Instagram — VERIFIED 2026-09 against developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment/replies:
 *   POST /{ig-comment-id}/replies  message=…  (user token) → { id }
 *   Permissions: instagram_basic, instagram_manage_comments, pages_show_list, pages_read_engagement
 *   (+ ads_management or ads_read when the Page role comes from Business Manager).
 *   Only top-level comments can be replied to (a reply to a reply lands on the top-level comment); hidden comments
 *   and live-video comments cannot be replied to.
 * Facebook Pages — VERIFIED 2026-09 against developers.facebook.com/docs/graph-api/reference/object/comments:
 *   POST /{comment-id}/comments  message=…  (Page access token of a user with the MODERATE task) → { id }
 *   Permission: pages_manage_engagement. Not used by the v1.5 inbox (Facebook comments are not synced), kept here so
 *   the scope mapping lives in one place.
 */
export const REPLY_SCOPES = Object.freeze({ instagram: 'instagram_manage_comments', facebook: 'pages_manage_engagement' });

/** Reply length cap. IG's documented caption limit is 2,200 characters; the comment limit is assumed equal (VERIFY). */
export const REPLY_MAX_CHARS = 2200;

/**
 * Posts a reply. { platform: 'instagram'|'facebook', commentId, text, token } → { id }.
 * `token` is the user token for Instagram and the Page token for Facebook.
 */
export async function replyToComment({ platform = 'instagram', commentId, text, token, client = metaClient, signal }) {
  const path = platform === 'facebook' ? `/${encodeURIComponent(commentId)}/comments` : `/${encodeURIComponent(commentId)}/replies`;
  const res = await client.post(path, { message: text }, { token, signal });
  return { id: res?.id != null ? String(res.id) : null };
}
