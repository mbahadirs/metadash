-- v2.0 team: notes become syncable entities (uid, author, mentions, visibility, soft delete); members and applied events.
ALTER TABLE notes ADD COLUMN uid TEXT;
UPDATE notes SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
ALTER TABLE notes ADD COLUMN author_id TEXT;
ALTER TABLE notes ADD COLUMN author_name TEXT;
ALTER TABLE notes ADD COLUMN mentions TEXT;                     -- JSON [memberId]
ALTER TABLE notes ADD COLUMN visibility TEXT DEFAULT 'internal'; -- internal | client
ALTER TABLE notes ADD COLUMN updated_at INTEGER;
ALTER TABLE notes ADD COLUMN deleted_at INTEGER;
ALTER TABLE notes ADD COLUMN origin TEXT DEFAULT 'local';       -- local | event
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_uid ON notes(uid);
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY, name TEXT, handle TEXT UNIQUE, role TEXT, is_self INTEGER DEFAULT 0, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS team_events_applied (event_id TEXT PRIMARY KEY, member_id TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS mention_seen (note_uid TEXT PRIMARY KEY, seen_at INTEGER);
