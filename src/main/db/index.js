import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let db = null;
let dbPath = null;

/**
 * Wait this long for a write lock held by another connection before SQLITE_BUSY. The GUI and the CLI
 * (`--cli`, v2.0) may open the same data.db at the same time; long work is additionally serialised by leases
 * (db/queries/locks.js).
 */
export const BUSY_TIMEOUT_MS = 5000;

/** Opens (or returns) the singleton SQLite connection. */
export function openDb(filePath) {
  if (db) return db;
  dbPath = filePath;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  db = new Database(filePath);
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  runMigrations(db);
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not opened');
  return db;
}

export function getDbPath() {
  return dbPath;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Closes and reopens the connection (after restore). With `filePath`, switches to another database file
 * (v2.0 team subscriber workspaces: userData/workspaces/<teamId>/data.db); migrations run on the new file.
 */
export function reopenDb(filePath) {
  const p = filePath ?? dbPath;
  closeDb();
  return openDb(p);
}

function runMigrations(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY, applied_at INTEGER
  )`);
  const applied = new Set(conn.prepare('SELECT version FROM schema_version').all().map((r) => r.version));
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  const apply = conn.transaction((version, sql) => {
    conn.exec(sql);
    conn.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(version, Date.now());
  });
  for (const file of files) {
    const version = Number.parseInt(file.split('_')[0], 10);
    if (applied.has(version)) continue;
    apply(version, fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
}

/** Small helpers so query modules stay terse. */
export const q = {
  all: (sql, ...params) => getDb().prepare(sql).all(...params),
  get: (sql, ...params) => getDb().prepare(sql).get(...params),
  run: (sql, ...params) => getDb().prepare(sql).run(...params),
  tx: (fn) => getDb().transaction(fn),
};
