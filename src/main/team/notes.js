import {
  getNote, listNotesV2, upsertNoteByUid, softDeleteNote, hardDeleteNote, unseenMentions, markMentionSeen,
  memberByHandle, getMember, selfMember, newUid, ensureNoteUid, NOTE_ENTITY_TYPES, VISIBILITIES,
} from '../db/queries/team.js';
import { teamError } from './errors.js';
import { getSession } from './session.js';
import { getTeamConfig, getIdentity, recordTeamEvent } from './index.js';

/**
 * Notes v2: author, @mentions, visibility (internal | client) and team sync through events.
 * Mentions = explicit member ids (MentionInput) ∪ @handles in the body that match a team member.
 */
export const MAX_NOTE_LENGTH = 5000;
const HANDLE_IN_TEXT = /(^|[^\w@.])@([a-z0-9_.-]{2,32})/gi;

export function extractHandles(body) {
  return [...new Set([...String(body ?? '').matchAll(HANDLE_IN_TEXT)].map((m) => m[2].replace(/[.]+$/, '').toLowerCase()))];
}

export function resolveMentions(body, explicitIds = []) {
  const ids = new Set();
  for (const id of Array.isArray(explicitIds) ? explicitIds : []) if (typeof id === 'string' && getMember(id)) ids.add(id);
  for (const h of extractHandles(body)) {
    const m = memberByHandle(h);
    if (m) ids.add(m.id);
  }
  return [...ids];
}

function cleanBody(body) {
  const text = String(body ?? '').trim();
  if (!text) throw teamError('TEAM_NOTE_EMPTY');
  if (text.length > MAX_NOTE_LENGTH) throw teamError('TEAM_NOTE_TOO_LONG', { n: MAX_NOTE_LENGTH });
  return text;
}

const cleanVisibility = (v) => (VISIBILITIES.includes(v) ? v : 'internal');

function eventNote(n) {
  return {
    uid: n.uid, entityType: n.entity_type, entityId: n.entity_id, body: n.body, mentions: n.mentions,
    visibility: n.visibility, authorName: n.author_name, authorId: n.author_id, createdAt: n.created_at,
  };
}

/** Notes of an entity for the current session (the client view only sees visibility 'client'). */
export function listNotesFor({ entityType, entityId } = {}, session = getSession()) {
  return listNotesV2({ entityType, entityId, visibility: session.role === 'client' ? 'client' : undefined });
}

export function addNoteV2({ entityType, entityId, body, mentions, visibility } = {}, now = Date.now()) {
  if (!NOTE_ENTITY_TYPES.includes(entityType) || entityId == null || entityId === '') throw teamError('TEAM_NOTE_ENTITY');
  const text = cleanBody(body);
  const me = getIdentity();
  const uid = newUid();
  upsertNoteByUid({
    uid, entityType, entityId: String(entityId), body: text, mentions: resolveMentions(text, mentions), visibility: cleanVisibility(visibility),
    authorId: me?.id ?? null, authorName: me?.name ?? null, createdAt: now, updatedAt: now, origin: 'local',
  });
  const note = getNote({ uid });
  recordTeamEvent('note.upsert', { note: eventNote(note) }, now);
  return note;
}

function ownNote({ id, uid }) {
  if (!uid && id != null) ensureNoteUid(id);
  const note = getNote({ id, uid });
  if (!note || note.deleted_at != null) throw teamError('TEAM_NOTE_NOT_FOUND');
  const me = getIdentity();
  if (note.author_id && me && note.author_id !== me.id && getSession().role !== 'admin') throw teamError('TEAM_NOT_AUTHOR');
  return note;
}

export function updateNoteV2({ id, uid, body, mentions, visibility } = {}, now = Date.now()) {
  const note = ownNote({ id, uid });
  const text = body === undefined ? note.body : cleanBody(body);
  const at = Math.max(now, (note.updated_at ?? 0) + 1);
  upsertNoteByUid({
    uid: note.uid, entityType: note.entity_type, entityId: note.entity_id, body: text,
    mentions: mentions === undefined && body === undefined ? note.mentions : resolveMentions(text, mentions ?? []),
    visibility: visibility === undefined ? note.visibility : cleanVisibility(visibility),
    authorId: note.author_id, authorName: note.author_name, createdAt: note.created_at, updatedAt: at,
  });
  const next = getNote({ uid: note.uid });
  recordTeamEvent('note.upsert', { note: eventNote(next) }, at);
  return next;
}

/** In a team the note is tombstoned (so the delete syncs); on a solo install it is removed. */
export function deleteNoteV2(idOrRef, now = Date.now()) {
  const ref = typeof idOrRef === 'object' && idOrRef ? idOrRef : { id: idOrRef };
  const note = ownNote(ref);
  if (getTeamConfig().mode === 'none') {
    hardDeleteNote({ uid: note.uid, id: note.id });
    return true;
  }
  const at = Math.max(now, (note.updated_at ?? 0) + 1);
  softDeleteNote(note.uid, at);
  recordTeamEvent('note.delete', { uid: note.uid, entityType: note.entity_type, entityId: note.entity_id }, at);
  return true;
}

export function myUnseenMentions() {
  const me = selfMember() ?? getIdentity();
  return me ? unseenMentions(me.id) : [];
}

export function markSeen(uids, now = Date.now()) {
  const list = (Array.isArray(uids) ? uids : []).filter((u) => typeof u === 'string' && u).slice(0, 500);
  for (const uid of list) {
    markMentionSeen(uid, now);
    recordTeamEvent('mention.seen', { uid }, now);
  }
  return list.length;
}
