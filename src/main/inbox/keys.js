/**
 * Stored comment keys (comments.comment_id). Instagram keeps the raw id (existing rows stay valid); other platforms
 * are prefixed so ids from different APIs can never collide. The raw API id is always kept in comments.external_id.
 */
export const COMMENT_KEY_PREFIX = Object.freeze({ instagram: '', facebook: 'fbc-', threads: 'th-', youtube: 'ytc-' });

export function commentKey(platform, externalId) {
  const prefix = COMMENT_KEY_PREFIX[platform] ?? `${platform}-`;
  return `${prefix}${externalId}`;
}

/** Raw API id of a stored key (inverse of commentKey). */
export function externalIdOf(platform, key) {
  const prefix = COMMENT_KEY_PREFIX[platform] ?? `${platform}-`;
  const s = String(key);
  return prefix && s.startsWith(prefix) ? s.slice(prefix.length) : s;
}
