/**
 * v2.0 F1 per-member event logs: LWW merge, tombstones, idempotency, conflicted copies / foreign authors ignored,
 * inbox status and assignment events.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, q } from '../src/main/db/index.js';
import { getNote, listNotesV2 } from '../src/main/db/queries/team.js';
import { makeEvent, appendEvent, readEventLogs, mergeEvents, applyEvents, orderEvents } from '../src/main/team/events.js';
import { eventsDir } from '../src/main/team/folder.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-team-ev-'));
const teamDir = path.join(dir, 'team');
const A = 'aaaa1111';
const B = 'bbbb2222';
const note = (uid, body, extra = {}) => ({ uid, entityType: 'account', entityId: '1784', body, mentions: [], visibility: 'internal', createdAt: 1000, ...extra });
const up = (author, at, uid, body, id) => makeEvent('note.upsert', { note: note(uid, body) }, { author, at, id });
const del = (author, at, uid, id) => makeEvent('note.delete', { uid, entityType: 'account', entityId: '1784' }, { author, at, id });

beforeAll(() => {
  openDb(path.join(dir, 'data.db'));
  q.run("INSERT INTO accounts (ig_id, username, is_tracked, platform, external_id) VALUES ('1784', 'acme', 1, 'instagram', '1784')");
  q.run("INSERT INTO media (media_id, ig_id, media_type, media_product_type, posted_at, is_deleted) VALUES ('m1', '1784', 'IMAGE', 'FEED', 1, 0)");
  q.run("INSERT INTO comments (comment_id, media_id, username, text, created_at, is_from_owner) VALUES ('c1', 'm1', 'fan', 'hi', 1, 0)");
});
afterAll(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  q.run('DELETE FROM notes');
  q.run('DELETE FROM team_events_applied');
  q.run('DELETE FROM inbox_state');
});

describe('pure merge', () => {
  it('last writer wins per note, ties broken by member id', () => {
    const w = mergeEvents([up(A, 20, 'n1', 'late A', 'e2'), up(B, 10, 'n1', 'early B', 'e1'), up(B, 20, 'n1', 'late B', 'e3')]);
    expect(w.get('note:n1').note.body).toBe('late B');
  });

  it('a tombstone beats an older or simultaneous upsert but not a newer one', () => {
    expect(mergeEvents([del(A, 20, 'n1', 'd'), up(B, 20, 'n1', 'same time', 'u')]).get('note:n1').op).toBe('note.delete');
    expect(mergeEvents([del(A, 20, 'n1', 'd'), up(B, 10, 'n1', 'older', 'u')]).get('note:n1').op).toBe('note.delete');
    expect(mergeEvents([del(A, 20, 'n1', 'd'), up(B, 30, 'n1', 'newer', 'u')]).get('note:n1').op).toBe('note.upsert');
  });

  it('dedupes by id and orders by (at, author, id)', () => {
    const e = up(A, 5, 'n1', 'x', 'same');
    expect(orderEvents([up(B, 9, 'n2', 'y', 'z'), e, e]).map((x) => x.id)).toEqual(['same', 'z']);
  });
});

describe('applying to the database', () => {
  it('is independent of arrival order (LWW in the DB)', () => {
    applyEvents([up(A, 30, 'n1', 'newest', 'e3')]);
    applyEvents([up(B, 10, 'n1', 'oldest', 'e1'), up(B, 20, 'n1', 'middle', 'e2')]);
    expect(getNote({ uid: 'n1' }).body).toBe('newest');
    expect(getNote({ uid: 'n1' }).author_id).toBe(A);
  });

  it('keeps tombstones: an older upsert arriving after the delete does not resurrect the note', () => {
    applyEvents([up(A, 10, 'n2', 'hello', 'u1')]);
    applyEvents([del(B, 20, 'n2', 'd1')]);
    applyEvents([up(A, 15, 'n2', 'late edit', 'u2')]);
    expect(listNotesV2({ entityType: 'account', entityId: '1784' })).toEqual([]);
    expect(getNote({ uid: 'n2' }).deleted_at).toBe(20);
    applyEvents([del(B, 5, 'n3', 'd2'), up(A, 4, 'n3', 'created before delete', 'u3')]);
    expect(listNotesV2({ entityType: 'account', entityId: '1784' })).toEqual([]);
  });

  it('is idempotent by event id', () => {
    const events = [up(A, 10, 'n4', 'once', 'i1')];
    expect(applyEvents(events)).toEqual({ applied: 1, skipped: 0 });
    expect(applyEvents(events)).toEqual({ applied: 0, skipped: 1 });
    expect(q.get('SELECT COUNT(*) AS n FROM notes').n).toBe(1);
    expect(getNote({ uid: 'n4' }).mentions).toEqual([]);
  });

  it('applies inbox status (LWW on status_at) and assignment for known comments only', () => {
    applyEvents([
      makeEvent('inbox.status', { commentId: 'c1', status: 'done' }, { author: A, at: 50, id: 's2' }),
      makeEvent('inbox.status', { commentId: 'c1', status: 'open' }, { author: B, at: 40, id: 's1' }),
      makeEvent('inbox.assign', { commentId: 'c1', assignee: B }, { author: A, at: 45, id: 'a1' }),
      makeEvent('inbox.status', { commentId: 'nope', status: 'done' }, { author: A, at: 60, id: 's3' }),
    ]);
    expect(q.get("SELECT status, status_by, status_at, assignee FROM inbox_state WHERE comment_id = 'c1'")).toEqual({ status: 'done', status_by: A, status_at: 50, assignee: B });
    applyEvents([makeEvent('inbox.status', { commentId: 'c1', status: 'open' }, { author: B, at: 45, id: 's4' })]);
    expect(q.get("SELECT status FROM inbox_state WHERE comment_id = 'c1'").status).toBe('done');
    expect(q.get("SELECT COUNT(*) AS n FROM inbox_state WHERE comment_id = 'nope'").n).toBe(0);
  });

  it('applies mention.seen only for this machine\'s member', () => {
    applyEvents([makeEvent('mention.seen', { uid: 'n9' }, { author: B, at: 1, id: 'm1' }), makeEvent('mention.seen', { uid: 'n8' }, { author: A, at: 1, id: 'm2' })], { selfId: A });
    expect(q.all('SELECT note_uid FROM mention_seen').map((r) => r.note_uid)).toEqual(['n8']);
  });
});

describe('event log files', () => {
  it('reads every member log, ignoring conflicted copies, foreign authors and partial lines', () => {
    appendEvent(teamDir, A, up(A, 1, 'f1', 'from A', 'fa'));
    appendEvent(teamDir, B, up(B, 2, 'f2', 'from B', 'fb'));
    const ev = eventsDir(teamDir);
    fs.writeFileSync(path.join(ev, `${A} (conflicted copy 2026-01-01).jsonl`), `${JSON.stringify(up(A, 3, 'f3', 'dup', 'fc'))}\n`);
    fs.writeFileSync(path.join(ev, `${A} (1).jsonl`), `${JSON.stringify(up(A, 3, 'f4', 'dup', 'fd'))}\n`);
    fs.appendFileSync(path.join(ev, `${B}.jsonl`), `${JSON.stringify(up(A, 4, 'f5', 'forged author', 'fe'))}\n{"v":1,"id":"trunc`);
    const ids = readEventLogs(teamDir).map((e) => e.id).sort();
    expect(ids).toEqual(['fa', 'fb']);
  });

  it('returns nothing for a missing folder', () => {
    expect(readEventLogs(path.join(dir, 'missing'))).toEqual([]);
  });

  it('rejects unknown ops when creating events', () => {
    expect(() => makeEvent('note.explode', {}, { author: A })).toThrow();
  });
});
