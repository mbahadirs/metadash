import Database from 'better-sqlite3';
import { addDays, differenceInCalendarDays } from 'date-fns';
import { getDbPath } from '../../db/index.js';
import { fmtDate, toDate } from '../../analytics/util.js';
import { assertSafeQuery, SqlGuardError } from './sqlGuard.js';

export const ROW_LIMIT = 200;
export const DISPLAY_ROWS = 50;
export const QUERY_TIME_MS = 5000;
const CELL_MAX = 300;
const PURPOSE_MAX = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Neutral tool definitions (closed schemas; the Anthropic provider sends them with strict: true). */
export const ASK_TOOLS = [
  {
    name: 'run_sql',
    description: `Run ONE read-only SQLite SELECT (or WITH … SELECT) against the local analytics database and get back {columns, rows, rowCount, truncated}. At most ${ROW_LIMIT} rows are returned, so aggregate (GROUP BY, SUM, AVG, ORDER BY … LIMIT) instead of fetching raw rows. Only tables from the schema are available.`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A single SQLite SELECT statement.' },
        purpose: { type: 'string', description: 'One short sentence, in the user\'s language, saying what this query checks (shown to the user).' },
      },
      required: ['query', 'purpose'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_period',
    description: 'Get today\'s local date and the date range currently selected in the app (plus the previous period of equal length). Call this before resolving relative dates like "this month", "last 30 days" or "the selected period".',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

/** Executes a guarded query on a separate read-only connection; rows come back as arrays, capped at `limit`. */
export function runSql(input, { limit = ROW_LIMIT, timeMs = QUERY_TIME_MS } = {}) {
  const sql = assertSafeQuery(input?.query);
  const conn = new Database(getDbPath(), { readonly: true, fileMustExist: true });
  try {
    const stmt = conn.prepare(sql);
    if (!stmt.reader || !stmt.readonly) throw new SqlGuardError('Only read-only SELECT queries are allowed.');
    stmt.raw(true);
    const columns = stmt.columns().map((c) => c.name);
    const { rows, truncated } = collectRows(stmt.iterate(), limit, timeMs);
    return { columns, rows, rowCount: rows.length, truncated };
  } finally {
    conn.close();
  }
}

/** Pulls at most limit+1 rows; the time budget is checked between rows (a single long step cannot be interrupted). */
function collectRows(iter, limit, timeMs) {
  const started = Date.now();
  const rows = [];
  for (const row of iter) {
    if (rows.length >= limit) return { rows, truncated: true };
    if (Date.now() - started > timeMs) throw new SqlGuardError(`The query exceeded the ${timeMs} ms time limit. Aggregate or filter more.`);
    rows.push(row.map(cell));
  }
  return { rows, truncated: false };
}

function cell(v) {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 10_000) / 10_000;
  if (typeof v === 'string') return v.length > CELL_MAX ? `${v.slice(0, CELL_MAX)}…` : v;
  if (v && typeof v === 'object') return '[binary]';
  return v;
}

/** Today + the renderer's selected period (validated) and the previous period of equal length. */
export function getPeriod(period, now = new Date()) {
  return { today: fmtDate(now), weekday: WEEKDAYS[now.getDay()], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null, ...selectedPeriod(period) };
}

function selectedPeriod(p) {
  const valid = p && ISO_DATE.test(p.from ?? '') && ISO_DATE.test(p.to ?? '') && p.from <= p.to && !Number.isNaN(toDate(p.from).getTime());
  if (!valid) return { selected: null };
  const days = differenceInCalendarDays(toDate(p.to), toDate(p.from)) + 1;
  const prevTo = addDays(toDate(p.from), -1);
  return {
    selected: { from: p.from, to: p.to, preset: p.preset ?? null, days },
    previous: { from: fmtDate(addDays(prevTo, -(days - 1))), to: fmtDate(prevTo) },
  };
}

/** Tool executor for one ask request; records every run_sql call (success or error) as a display step. */
export function createAskExecutor({ period }) {
  let steps = [];
  const record = (step) => { steps = [...steps, step]; };
  const execute = async (name, input) => {
    if (name === 'get_period') return getPeriod(period);
    if (name !== 'run_sql') throw new Error(`Unknown tool "${name}".`);
    const sql = typeof input?.query === 'string' ? input.query : '';
    const purpose = typeof input?.purpose === 'string' ? input.purpose.slice(0, PURPOSE_MAX) : '';
    try {
      const res = runSql(input);
      record({ sql, purpose, rowCount: res.rowCount, truncated: res.truncated, columns: res.columns, rows: res.rows.slice(0, DISPLAY_ROWS) });
      return res;
    } catch (err) {
      record({ sql, purpose, error: String(err?.message ?? err) });
      throw err;
    }
  };
  return { execute, steps: () => steps };
}
