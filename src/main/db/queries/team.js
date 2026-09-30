import crypto from 'node:crypto';
import { q } from '../index.js';

/**
 * Team queries (migration 013): members, applied shared-folder events, notes v2 (uid, author, mentions, visibility,
 * soft delete) and the local "mention seen" marks.
 *
 * Notes merge with last-writer-wins per note uid on (updated_at, author_id); a tombstone (deleted_at) beats any
 * write that is not newer than it.
 */
export const TEAM_TABLES = Object.freeze(['mention_seen', 'team_events_applied', 'team_members']);
export const ROLES = Object.freeze(['admin', 'analyst', 'client']);
export const VISIBILITIES = Object.freeze(['internal', 'client']);
export const NOTE_ENTITY_TYPES = Object.freeze(['account', 'media', 'comment']);

export const newUid = () => crypto.randomBytes(16).toString('hex');

const mapMember = (r) => r ? {
  id: r.id, name: r.name ?? '', handle: r.handle ?? '', role: ROLES.includes(r.role) ? r.role : 'analyst',
  isSelf: !!r.is_self, updatedAt: r.updated_at ?? null,
} : null;

export function listMembers() {
  return q.all('SELECT * FROM team_members ORDER BY is_self DESC, lower(name)').map(mapMember);
}

export function getMember(id) {
  return mapMember(q.get('SELECT * FROM team_members WHERE id = ?', id));
}

export function memberByHandle(handle) {
  return mapMember(q.get('SELECT * FROM team_members WHERE lower(handle) = lower(?)', String(handle ?? '')));
}

/**
 * Inserts or updates a member. A handle already used by another member is released from that row, so a renamed
 * teammate never blocks the UNIQUE index. isSelf = true clears the flag on every other row.
 */
export function upsertMember({ id, name, handle, role, isSelf = false, updatedAt = Date.now() }) {
  if (!id) throw new Error('member id required');
  q.tx(() => {
    if (handle) q.run('UPDATE team_members SET handle = NULL WHERE lower(handle) = lower(?) AND id <> ?', handle, id);
    if (isSelf) q.run('UPDATE team_members SET is_self = 0 WHERE id <> ?', id);
    q.run(
      `INSERT INTO team_members (id, name, handle, role, is_self, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, handle = excluded.handle, role = excluded.role,
         is_self = MAX(team_members.is_self, excluded.is_self), updated_at = excluded.updated_at`,
      id, name ?? '', handle || null, ROLES.includes(role) ? role : 'analyst', isSelf ? 1 : 0, updatedAt,
    );
  })();
  return getMember(id);
}

export function selfMember() {
  return mapMember(q.get('SELECT * FROM team_members WHERE is_self = 1 LIMIT 1'));
}

/** Clears the self flag everywhere (snapshot strip); the subscriber re-marks itself after a swap. */
export function clearSelfFlags() {
  q.run('UPDATE team_members SET is_self = 0');
}

// ---------- notes ----------

const parseMentions = (v) => {
  try {
    const a = JSON.parse(v ?? '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export function mapNote(r) {
  if (!r) return null;
  return {
    id: r.id, entity_type: r.entity_type, entity_id: r.entity_id, body: r.body ?? '', created_at: r.created_at,
    uid: r.uid, author_id: r.author_id ?? null, author_name: r.author_name ?? null, mentions: parseMentions(r.mentions),
    visibility: r.visibility === 'client' ? 'client' : 'internal', updated_at: r.updated_at ?? r.created_at ?? null,
    deleted_at: r.deleted_at ?? null,
  };
}

export function getNote({ id, uid } = {}) {
  if (uid) return mapNote(q.get('SELECT * FROM notes WHERE uid = ?', uid));
  if (id != null) return mapNote(q.get('SELECT * FROM notes WHERE id = ?', id));
  return null;
}

/** Live (not deleted) notes of an entity, newest first; `visibility` narrows ('client' for the client view). */
export function listNotesV2({ entityType, entityId, visibility, includeDeleted = false } = {}) {
  const where = ['entity_type = ?', 'entity_id = ?'];
  const params = [entityType, String(entityId)];
  if (!includeDeleted) where.push('deleted_at IS NULL');
  if (visibility) { where.push("COALESCE(visibility, 'internal') = ?"); params.push(visibility); }
  return q.all(`SELECT * FROM notes WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC`, ...params).map(mapNote);
}

/** True when a write stamped (at, author) is newer than the stored note (LWW; ties broken by author id). */
function newerThan(row, at, author) {
  const cur = row.updated_at ?? row.created_at ?? 0;
  if (at !== cur) return at > cur;
  return String(author ?? '') > String(row.author_id ?? '');
}

/**
 * Creates or updates a note by uid with last-writer-wins. Returns true when the row changed.
 * note = { uid, entityType, entityId, body, authorId, authorName, mentions, visibility, createdAt, updatedAt, origin }
 */
export function upsertNoteByUid(note) {
  const uid = note.uid ?? newUid();
  const at = Number(note.updatedAt ?? note.createdAt ?? Date.now());
  const row = q.get('SELECT * FROM notes WHERE uid = ?', uid);
  const mentions = JSON.stringify([...new Set(note.mentions ?? [])]);
  const visibility = note.visibility === 'client' ? 'client' : 'internal';
  if (!row) {
    if (!note.entityType || note.entityId == null) return false;
    q.run(
      `INSERT INTO notes (uid, entity_type, entity_id, body, created_at, author_id, author_name, mentions, visibility, updated_at, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid, note.entityType, String(note.entityId), note.body ?? '', Number(note.createdAt ?? at), note.authorId ?? null,
      note.authorName ?? null, mentions, visibility, at, note.origin ?? 'local',
    );
    return true;
  }
  if (row.deleted_at != null && row.deleted_at >= at) return false;
  if (!newerThan(row, at, note.authorId ?? row.author_id)) return false;
  q.run(
    `UPDATE notes SET body = ?, mentions = ?, visibility = ?, updated_at = ?, author_id = COALESCE(author_id, ?),
       author_name = COALESCE(author_name, ?), deleted_at = NULL WHERE uid = ?`,
    note.body ?? row.body, mentions, visibility, at, note.authorId ?? null, note.authorName ?? null, uid,
  );
  return true;
}

/**
 * Tombstones a note (kept so an older write arriving later cannot resurrect it). Unknown uids get a tombstone row
 * when the entity is known. Returns true when the row changed.
 */
export function softDeleteNote(uid, at = Date.now(), { entityType, entityId } = {}) {
  const row = q.get('SELECT * FROM notes WHERE uid = ?', uid);
  if (!row) {
    if (!entityType || entityId == null) return false;
    q.run(
      "INSERT INTO notes (uid, entity_type, entity_id, body, created_at, updated_at, deleted_at, origin) VALUES (?, ?, ?, '', ?, ?, ?, 'event')",
      uid, entityType, String(entityId), at, at, at,
    );
    return true;
  }
  if (row.deleted_at != null && row.deleted_at >= at) return false;
  if ((row.updated_at ?? row.created_at ?? 0) > at) return false;
  q.run('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE uid = ?', at, at, uid);
  return true;
}

/** Physically removes a note (own install outside a team: no tombstone needed). */
export function hardDeleteNote({ uid, id } = {}) {
  if (uid) q.run('DELETE FROM notes WHERE uid = ?', uid);
  else if (id != null) q.run('DELETE FROM notes WHERE id = ?', id);
}

/** Gives legacy rows (written by v1 code paths without a uid) a uid so they can sync. */
export function ensureNoteUid(id) {
  q.run('UPDATE notes SET uid = ? WHERE id = ? AND uid IS NULL', newUid(), id);
}

/** Live notes that mention `memberId`, written by someone else and not yet seen, newest first. */
export function unseenMentions(memberId, { limit = 50 } = {}) {
  if (!memberId) return [];
  return q.all(
    `SELECT n.* FROM notes n
     WHERE n.deleted_at IS NULL AND COALESCE(n.author_id, '') <> ?
       AND EXISTS (SELECT 1 FROM json_each(COALESCE(n.mentions, '[]')) m WHERE m.value = ?)
       AND NOT EXISTS (SELECT 1 FROM mention_seen s WHERE s.note_uid = n.uid)
     ORDER BY COALESCE(n.updated_at, n.created_at) DESC LIMIT ?`,
    memberId, memberId, limit,
  ).map(mapNote);
}

export function markMentionSeen(noteUid, at = Date.now()) {
  q.run('INSERT INTO mention_seen (note_uid, seen_at) VALUES (?, ?) ON CONFLICT(note_uid) DO NOTHING', noteUid, at);
}

// ---------- shared-folder events ----------

export function isEventApplied(eventId) {
  return !!q.get('SELECT 1 FROM team_events_applied WHERE event_id = ?', eventId);
}

export function markEventApplied(event) {
  q.run('INSERT OR IGNORE INTO team_events_applied (event_id, member_id, at) VALUES (?, ?, ?)', event.id, event.author ?? null, event.at ?? null);
}

function applyInbox(event) {
  const commentId = String(event.commentId ?? '');
  if (!commentId || !q.get('SELECT 1 FROM comments WHERE comment_id = ?', commentId)) return;
  const row = q.get('SELECT * FROM inbox_state WHERE comment_id = ?', commentId);
  if (!row) q.run("INSERT INTO inbox_state (comment_id, status) VALUES (?, 'open')", commentId);
  if (event.op === 'inbox.status') {
    if (row?.status_at != null && row.status_at > event.at) return;
    q.run('UPDATE inbox_state SET status = ?, status_by = ?, status_at = ? WHERE comment_id = ?', event.status, event.author, event.at, commentId);
  } else {
    q.run('UPDATE inbox_state SET assignee = ? WHERE comment_id = ?', event.assignee ?? null, commentId);
  }
}

/**
 * Applies one shared-folder event to the open database (idempotent by event.id). `selfId` = this machine's member
 * id (mention.seen of other members is ignored). Returns false when the event was already applied.
 */
export function applyEvent(event, { selfId = null } = {}) {
  if (!event?.id) return false;
  let applied = false;
  q.tx(() => {
    if (isEventApplied(event.id)) return;
    switch (event.op) {
      case 'note.upsert':
        upsertNoteByUid({ ...event.note, updatedAt: event.at, authorId: event.note?.authorId ?? event.author, origin: 'event' });
        break;
      case 'note.delete':
        softDeleteNote(event.uid, event.at, { entityType: event.entityType, entityId: event.entityId });
        break;
      case 'inbox.status':
      case 'inbox.assign':
        applyInbox(event);
        break;
      case 'mention.seen':
        if (selfId && event.author === selfId && event.uid) markMentionSeen(event.uid, event.at);
        break;
      default:
        break; // unknown op from a newer app version: recorded so it is not retried forever
    }
    markEventApplied(event);
    applied = true;
  })();
  return applied;
}
