/**
 * Team queries — STUB (v2.0 chunk B). Chunk F1 owns this file (migration 013: notes.uid/author/mentions/visibility,
 * team_members, team_events_applied, mention_seen).
 *
 *   listMembers() → Member[]; upsertMember({ id, name, handle, role, isSelf, updatedAt }); selfMember() → Member|null
 *   applyEvent(event) → boolean (false when already applied; idempotent by event.id)
 *   isEventApplied(eventId) → boolean
 *   listNotesV2({ entityType, entityId, visibility }) → Note[]; upsertNoteByUid(note); softDeleteNote(uid, at)
 *   unseenMentions(memberId) → Note[]; markMentionSeen(noteUid, at)
 */
const stub = (name) => () => { throw Object.assign(new Error(`db/queries/team.${name} is not implemented yet`), { code: 'NOT_IMPLEMENTED' }); };

export const listMembers = stub('listMembers');
export const upsertMember = stub('upsertMember');
export const selfMember = stub('selfMember');
export const applyEvent = stub('applyEvent');
export const isEventApplied = stub('isEventApplied');
export const listNotesV2 = stub('listNotesV2');
export const upsertNoteByUid = stub('upsertNoteByUid');
export const softDeleteNote = stub('softDeleteNote');
export const unseenMentions = stub('unseenMentions');
export const markMentionSeen = stub('markMentionSeen');

export const TEAM_TABLES = Object.freeze(['mention_seen', 'team_events_applied', 'team_members']);
