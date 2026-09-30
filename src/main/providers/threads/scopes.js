/**
 * Opt-in Threads scopes (requested with the publishing option, Settings → Connections; `threads.requestPublish`).
 * Opt-in because the Threads login page shows an error when the app's Threads use case lacks a permission.
 *  - v1.4 publishing: threads_content_publish (posts) + threads_manage_replies (first comment as a reply)
 *  - v2.0 unified inbox: threads_read_replies (read replies to own posts: /{media-id}/replies, /conversation) and
 *    threads_manage_replies (reply, hide/unhide). Docs checked 2026-09 (developers.facebook.com/docs/permissions).
 */
export const THREADS_INBOX_SCOPES = Object.freeze(['threads_read_replies', 'threads_manage_replies']);
export const THREADS_PUBLISH_SCOPES = Object.freeze(['threads_content_publish', 'threads_manage_replies', 'threads_read_replies']);
