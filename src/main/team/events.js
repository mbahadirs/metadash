import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eventsDir, eventLogPath, isConflictedCopy } from './folder.js';
import { applyEvent, markEventApplied } from '../db/queries/team.js';

/**
 * Per-member append-only event logs (events/<memberId>.jsonl). Each line: { v: 1, id, at, author, op, ... }.
 *   note.upsert  { note: { uid, entityType, entityId, body, mentions, visibility, authorName, createdAt } }
 *   note.delete  { uid, entityType, entityId }
 *   inbox.status { commentId, status }      inbox.assign { commentId, assignee }
 *   mention.seen { uid }
 * Merge = last writer wins per entity key on (at, author); tombstones for note.delete; idempotent by event id.
 */
export const EVENT_VERSION = 1;
export const EVENT_OPS = Object.freeze(['note.upsert', 'note.delete', 'inbox.status', 'inbox.assign', 'mention.seen']);
const MEMBER_ID_RE = /^[a-z0-9_-]{4,64}$/i;

export function makeEvent(op, fields, { author, at = Date.now(), id = crypto.randomUUID() } = {}) {
  if (!EVENT_OPS.includes(op)) throw new Error(`unknown team event op: ${op}`);
  return { v: EVENT_VERSION, id, at, author, op, ...fields };
}

/** Appends one event to the member's own log (the only file this machine ever writes in events/). */
export function appendEvent(teamDir, memberId, event) {
  if (!MEMBER_ID_RE.test(String(memberId))) throw new Error('invalid member id');
  fs.mkdirSync(eventsDir(teamDir), { recursive: true });
  const fd = fs.openSync(eventLogPath(teamDir, memberId), 'a');
  try {
    fs.writeSync(fd, `${JSON.stringify(event)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return event;
}

function validEvent(e, fileMemberId) {
  return e && typeof e === 'object' && typeof e.id === 'string' && Number.isFinite(e.at) && typeof e.op === 'string'
    && e.author === fileMemberId && (e.v ?? 1) <= EVENT_VERSION;
}

/**
 * Reads every member log. Sync-client conflict copies are ignored, as are malformed lines (a partially synced last
 * line is simply picked up on the next poll) and events whose author is not the file's owner.
 */
export function readEventLogs(teamDir) {
  let files = [];
  try { files = fs.readdirSync(eventsDir(teamDir)); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl') || isConflictedCopy(f)) continue;
    const memberId = f.slice(0, -'.jsonl'.length);
    if (!MEMBER_ID_RE.test(memberId)) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(eventsDir(teamDir), f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (validEvent(e, memberId)) out.push(e);
      } catch { /* partial line */ }
    }
  }
  return out;
}

/** Entity key an event writes (LWW unit). */
export function entityKey(e) {
  switch (e.op) {
    case 'note.upsert': return `note:${e.note?.uid}`;
    case 'note.delete': return `note:${e.uid}`;
    case 'inbox.status': return `status:${e.commentId}`;
    case 'inbox.assign': return `assign:${e.commentId}`;
    case 'mention.seen': return `seen:${e.author}:${e.uid}`;
    default: return `other:${e.id}`;
  }
}

const cmp = (a, b) => (a.at - b.at) || String(a.author).localeCompare(String(b.author)) || String(a.id).localeCompare(String(b.id));

/** Dedupes by id and orders by (at, author, id) — the order events are applied in. Pure. */
export function orderEvents(events) {
  const byId = new Map();
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort(cmp);
}

/**
 * Pure LWW view of a set of events: entity key → winning event. For notes a delete wins over an upsert with the
 * same or an older stamp (tombstone).
 */
export function mergeEvents(events) {
  const winners = new Map();
  for (const e of orderEvents(events)) {
    const key = entityKey(e);
    const cur = winners.get(key);
    if (cur && cur.op === 'note.delete' && e.op === 'note.upsert' && e.at <= cur.at) continue;
    winners.set(key, e);
  }
  return winners;
}

/** Applies events (any order, duplicates allowed) to the open database. Returns { applied, skipped }. */
export function applyEvents(events, { selfId = null } = {}) {
  let applied = 0;
  let skipped = 0;
  for (const e of orderEvents(events)) {
    if (applyEvent(e, { selfId })) applied += 1;
    else skipped += 1;
  }
  return { applied, skipped };
}

/** Records a locally-made change: appends it to our own log and marks it applied (it is already in our DB). */
export function recordLocalEvent(teamDir, memberId, op, fields, at = Date.now()) {
  const event = makeEvent(op, fields, { author: memberId, at });
  appendEvent(teamDir, memberId, event);
  markEventApplied(event);
  return event;
}
