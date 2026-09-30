import { q } from '../db/index.js';
import { listAccounts, setAccountScopeFilter } from '../db/queries/accounts.js';

/**
 * Client-view scope: in the client role only accounts whose client name is in session.clientScope are visible.
 * accountScopeFilter() is registered with db/queries/accounts.js (every listAccounts caller is scoped), and the IPC
 * policy checks account/media ids in call arguments against scopedAccountIds().
 * This is a workflow guardrail on an untrusted machine, not a security boundary (docs/team.md).
 */
export function normalizeClientNames(names) {
  if (!Array.isArray(names)) return [];
  return [...new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))].slice(0, 50);
}

/** Distinct client names of all accounts (tracked or not), sorted. */
export function knownClientNames() {
  const names = listAccounts({ onlyTracked: false, unscoped: true }).map((a) => a.clientName).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** accounts → accounts filter keeping only the scoped clients' accounts. */
export function accountScopeFilter(clientScope) {
  const names = new Set(normalizeClientNames(clientScope));
  return (rows) => rows.filter((r) => names.has(r.clientName ?? ''));
}

/** Account keys (ig_id) visible in the client view. */
export function scopedAccountIds(clientScope) {
  const names = normalizeClientNames(clientScope);
  if (!names.length) return new Set();
  return new Set(q.all(`SELECT ig_id FROM accounts WHERE client_name IN (${names.map(() => '?').join(',')})`, ...names).map((r) => r.ig_id));
}

/** Registers (client role) or clears the listAccounts scope filter for a session. */
export function applySessionScope(session) {
  setAccountScopeFilter(session?.role === 'client' && session.clientScope?.length ? accountScopeFilter(session.clientScope) : null);
}

export function accountOfMedia(mediaId) {
  return q.get('SELECT ig_id FROM media WHERE media_id = ?', String(mediaId))?.ig_id ?? null;
}

export function accountOfComment(commentId) {
  const row = q.get('SELECT c.account_id, m.ig_id FROM comments c LEFT JOIN media m ON m.media_id = c.media_id WHERE c.comment_id = ?', String(commentId));
  return row ? row.account_id ?? row.ig_id ?? null : null;
}

/** Account key a note entity belongs to (null when unknown). */
export function accountOfEntity(entityType, entityId) {
  if (entityType === 'account') return String(entityId);
  if (entityType === 'media') return accountOfMedia(entityId);
  if (entityType === 'comment') return accountOfComment(entityId);
  return null;
}
