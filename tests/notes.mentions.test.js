/**
 * v2.0 F1 notes: author, @mentions (explicit ids + @handles), visibility for the client view, edit rights,
 * solo vs team delete, unseen mentions + markSeen, the "mentions" notification rule, demo team seed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, q } from '../src/main/db/index.js';
import { setSetting } from '../src/main/db/queries/settings.js';
import { upsertMember, upsertNoteByUid, getNote, listMembers } from '../src/main/db/queries/team.js';
import { setIdentity, __resetTeamForTests } from '../src/main/team/index.js';
import {
  extractHandles, resolveMentions, addNoteV2, updateNoteV2, deleteNoteV2, listNotesFor, myUnseenMentions, markSeen,
} from '../src/main/team/notes.js';
import { rule, pickMentions } from '../src/main/notifyRules/mentions.js';
import { EXTRA_RULES, NOTIFY_TYPES, pickNotifications } from '../src/main/notifyRules.js';
import { seedTeam } from '../src/main/seed/team.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-notes-'));
let me;
const AYSE = 'ayse0001';

beforeAll(() => {
  __resetTeamForTests();
  openDb(path.join(dir, 'data.db'));
  q.run("INSERT INTO accounts (ig_id, username, is_tracked, platform, external_id, client_name) VALUES ('a1', 'acme', 1, 'instagram', 'a1', 'Acme'), ('a2', 'bolt', 1, 'instagram', 'a2', 'Bolt')");
  me = setIdentity({ name: 'Me Myself', handle: 'me' });
  upsertMember({ id: AYSE, name: 'Ayşe', handle: 'ayse', role: 'analyst' });
});
afterAll(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('mention parsing', () => {
  it('extracts handles, not e-mail addresses', () => {
    expect(extractHandles('hi @Ayse and @me. mail a@b.com @x')).toEqual(['ayse', 'me']);
    expect(extractHandles('')).toEqual([]);
  });

  it('resolves handles and explicit ids against team members only', () => {
    expect(resolveMentions('ping @ayse @ghost', ['nobody', me.id]).sort()).toEqual([AYSE, me.id].sort());
  });
});

describe('notes v2', () => {
  it('adds with author, mentions and visibility', () => {
    const n = addNoteV2({ entityType: 'account', entityId: 'a1', body: '  @ayse check reach  ', visibility: 'client' });
    expect(n).toMatchObject({ body: '@ayse check reach', author_id: me.id, author_name: 'Me Myself', mentions: [AYSE], visibility: 'client' });
    expect(n.uid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('validates input', () => {
    expect(() => addNoteV2({ entityType: 'account', entityId: 'a1', body: '   ' })).toThrow(expect.objectContaining({ code: 'TEAM_NOTE_EMPTY' }));
    expect(() => addNoteV2({ entityType: 'planet', entityId: 'x', body: 'hi' })).toThrow(expect.objectContaining({ code: 'TEAM_NOTE_ENTITY' }));
    expect(() => addNoteV2({ entityType: 'account', entityId: 'a1', body: 'x'.repeat(5001) })).toThrow(expect.objectContaining({ code: 'TEAM_NOTE_TOO_LONG' }));
  });

  it('the client view only lists client-visible notes', () => {
    addNoteV2({ entityType: 'account', entityId: 'a1', body: 'internal only' });
    const all = listNotesFor({ entityType: 'account', entityId: 'a1' }, { role: 'analyst' });
    const client = listNotesFor({ entityType: 'account', entityId: 'a1' }, { role: 'client' });
    expect(all.length).toBe(2);
    expect(client.map((n) => n.body)).toEqual(['@ayse check reach']);
  });

  it('updates own notes and re-resolves mentions; others\' notes need admin', () => {
    const n = addNoteV2({ entityType: 'media', entityId: 'm1', body: 'draft' });
    const u = updateNoteV2({ uid: n.uid, body: 'now @ayse', visibility: 'client' });
    expect(u).toMatchObject({ body: 'now @ayse', mentions: [AYSE], visibility: 'client' });
    expect(u.updated_at).toBeGreaterThan(n.updated_at - 1);
    upsertNoteByUid({ uid: 'foreign1', entityType: 'account', entityId: 'a2', body: 'by ayse', authorId: AYSE, authorName: 'Ayşe', createdAt: 1, updatedAt: 1 });
    setSetting('session.role', 'analyst');
    try {
      expect(() => updateNoteV2({ uid: 'foreign1', body: 'hijack' })).toThrow(expect.objectContaining({ code: 'TEAM_NOT_AUTHOR' }));
      expect(() => deleteNoteV2({ uid: 'foreign1' })).toThrow(expect.objectContaining({ code: 'TEAM_NOT_AUTHOR' }));
    } finally {
      setSetting('session.role', 'admin');
    }
    expect(updateNoteV2({ uid: 'foreign1', body: 'admin edit' }).body).toBe('admin edit');
  });

  it('deletes physically outside a team, by numeric id as before', () => {
    const n = addNoteV2({ entityType: 'account', entityId: 'a2', body: 'temp' });
    expect(deleteNoteV2(n.id)).toBe(true);
    expect(getNote({ uid: n.uid })).toBeNull();
  });

  it('gives legacy notes (no uid) a uid when they are touched', () => {
    q.run("INSERT INTO notes (entity_type, entity_id, body, created_at) VALUES ('account', 'a2', 'legacy', 5)");
    const id = q.get("SELECT id FROM notes WHERE body = 'legacy'").id;
    expect(updateNoteV2({ id, body: 'legacy edited' }).uid).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('mentions inbox and notification', () => {
  it('lists unseen mentions of me written by others, and markSeen clears them', () => {
    upsertNoteByUid({ uid: 'm-1', entityType: 'account', entityId: 'a1', body: '@me look', mentions: [me.id], authorId: AYSE, authorName: 'Ayşe', createdAt: 10, updatedAt: 10 });
    addNoteV2({ entityType: 'account', entityId: 'a1', body: 'note to self @me' }); // own note: not a mention to notify
    expect(myUnseenMentions().map((n) => n.uid)).toEqual(['m-1']);
    expect(markSeen(['m-1', 42, ''])).toBe(1);
    expect(myUnseenMentions()).toEqual([]);
  });

  it('is registered as an extra notification rule', () => {
    expect(EXTRA_RULES).toContain(rule);
    expect(NOTIFY_TYPES).toContain('mentions');
  });

  it('gathers with a route and picks once per note', () => {
    upsertNoteByUid({ uid: 'm-2', entityType: 'account', entityId: 'a2', body: '@me again', mentions: [me.id], authorId: AYSE, authorName: 'Ayşe', createdAt: 20, updatedAt: 20 });
    const data = rule.gather(Date.now());
    expect(data.mentions).toEqual([{ uid: 'm-2', author: 'Ayşe', body: '@me again', route: '/account/a2' }]);
    const now = Date.now();
    const notes = pickNotifications({ now, lang: 'en', data, sent: {}, prefs: {} });
    const note = notes.find((n) => n.type === 'mentions');
    expect(note).toMatchObject({ key: 'mention:m-2', route: '/account/a2', title: 'You were mentioned', body: 'Ayşe: @me again' });
    expect(pickNotifications({ now, lang: 'en', data, sent: { 'mention:m-2': new Date(now).toISOString() }, prefs: {} }).find((n) => n.type === 'mentions')).toBeUndefined();
    expect(pickNotifications({ now, lang: 'en', data, sent: {}, prefs: { mentions: false } }).find((n) => n.type === 'mentions')).toBeUndefined();
  });

  it('summarises several mentions', () => {
    const ctx = { now: 1, lang: 'en', sent: {}, wasSent: () => false };
    const n = pickMentions({ mentions: [{ uid: 'x', author: 'A', body: 'a', route: '/' }, { uid: 'y', author: 'B', body: 'b', route: '/' }] }, ctx);
    expect(n).toMatchObject({ keys: ['mention:x', 'mention:y'], body: 'You were mentioned in 2 notes.' });
    expect(pickMentions({ mentions: [] }, ctx)).toBeNull();
  });
});

describe('demo seed', () => {
  it('adds teammates and notes, and is idempotent', () => {
    const r1 = seedTeam({ now: new Date('2026-03-01T12:00:00Z') });
    const r2 = seedTeam({ now: new Date('2026-03-01T12:00:00Z') });
    expect(r1).toEqual(r2);
    expect(r1.notes).toBe(3); // includes one mentioning this machine's member
    expect(listMembers().map((m) => m.handle)).toEqual(expect.arrayContaining(['ayse', 'mert', 'me']));
    expect(q.get("SELECT COUNT(*) AS n FROM notes WHERE uid LIKE 'demo-note-%'").n).toBe(3);
  });
});
