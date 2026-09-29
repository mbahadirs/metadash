import { assertReadOnly } from '../../export/csv.js';

/**
 * Conservative guard for model-written SQL. On top of the SELECT-only check it rejects any identifier-like word
 * that names a secret table (in any quoting/case — SQLite also resolves 'quoted' strings as table names),
 * sqlite internals, table-valued pragmas, extension loading and recursive CTEs (unbounded run time).
 * False positives (e.g. the word "token" inside a string literal) are acceptable: the model gets the error and rephrases.
 */
export const EXCLUDED_TABLES = ['settings', 'profiles'];
export const SQL_MAX = 4000;

const BLOCKED_WORDS = new Set([...EXCLUDED_TABLES, 'load_extension', 'recursive']);
const BLOCKED_PATTERNS = [/token/, /secret/, /^sqlite_/, /^pragma_/];

export class SqlGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SqlGuardError';
  }
}

/** Returns the trimmed query (trailing semicolons removed) or throws a SqlGuardError explaining the rejection. */
export function assertSafeQuery(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new SqlGuardError('The query is empty.');
  if (sql.length > SQL_MAX) throw new SqlGuardError(`The query is too long (max ${SQL_MAX} characters).`);
  const clean = sql.trim().replace(/;+\s*$/, '');
  if (clean.includes(';')) throw new SqlGuardError('Only a single statement is allowed (no ";").');
  try {
    assertReadOnly(clean);
  } catch {
    throw new SqlGuardError('Only read-only SELECT (or WITH … SELECT) queries are allowed.');
  }
  const bad = blockedWord(clean);
  if (bad) throw new SqlGuardError(`The query references "${bad}", which is not available. Use only the tables in the schema.`);
  return clean;
}

function blockedWord(sql) {
  const words = sql.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return words.find((w) => BLOCKED_WORDS.has(w) || BLOCKED_PATTERNS.some((re) => re.test(w))) ?? null;
}
