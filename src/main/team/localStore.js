import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * userData/local.db: machine-local settings while this install is a team subscriber (db/queries/settings.js routes
 * keys by prefix to it). Values are stored raw (already JSON-encoded by settings.js).
 */
export function openLocalStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  const get = db.prepare('SELECT value FROM settings WHERE key = ?');
  const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  const all = db.prepare('SELECT key, value FROM settings');
  return {
    file,
    get: (key) => get.get(key)?.value,
    set: (key, raw) => { set.run(key, raw); },
    delete: (key) => { del.run(key); },
    all: () => all.all(),
    close: () => { if (db.open) db.close(); },
  };
}

/** Removes a closed local store and its WAL files. */
export function removeLocalStore(file) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
}
