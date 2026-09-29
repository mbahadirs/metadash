import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, getDb } from '../src/main/db/index.js';
import { seedDemo } from '../src/main/seed/index.js';
import { assertSafeQuery, EXCLUDED_TABLES } from '../src/main/ai/ask/sqlGuard.js';
import { runSql, getPeriod, ASK_TOOLS, createAskExecutor } from '../src/main/ai/ask/tools.js';
import { buildSchemaDescription } from '../src/main/ai/ask/schema.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-ask-'));
beforeAll(() => { openDb(path.join(dir, 'data.db')); seedDemo({ reset: true }); });
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('assertSafeQuery', () => {
  it('accepts plain SELECT and WITH queries (trailing semicolon ok)', () => {
    expect(assertSafeQuery('SELECT username FROM accounts;')).toBe('SELECT username FROM accounts');
    expect(() => assertSafeQuery('WITH x AS (SELECT 1 AS a) SELECT a FROM x')).not.toThrow();
    expect(() => assertSafeQuery("SELECT * FROM account_insights_daily WHERE metric = 'reach'")).not.toThrow();
    expect(() => assertSafeQuery('SELECT profile_id FROM accounts')).not.toThrow();
  });

  it('rejects non-SELECT statements and multiple statements', () => {
    for (const sql of ['DELETE FROM accounts', 'UPDATE accounts SET name = 1', 'DROP TABLE media', "ATTACH 'x.db' AS x", 'PRAGMA table_info(accounts)', 'INSERT INTO tags (name) VALUES (1)', 'SELECT 1; DELETE FROM accounts', 'VACUUM']) {
      expect(() => assertSafeQuery(sql), sql).toThrow();
    }
  });

  it('rejects empty, non-string and over-long input', () => {
    expect(() => assertSafeQuery('')).toThrow();
    expect(() => assertSafeQuery(null)).toThrow();
    expect(() => assertSafeQuery(`SELECT '${'x'.repeat(5000)}'`)).toThrow();
  });

  it('rejects excluded tables in any spelling or position', () => {
    const bad = [
      'SELECT * FROM settings',
      'select value from SETTINGS',
      'SELECT * FROM "settings"',
      'SELECT * FROM `Settings`',
      'SELECT * FROM [profiles]',
      "SELECT * FROM 'profiles'",
      'SELECT * FROM main.settings',
      'SELECT a.username FROM accounts a JOIN profiles p ON p.id = a.profile_id',
      'SELECT * FROM accounts WHERE ig_id IN (SELECT key FROM settings)',
      'WITH s AS (SELECT * FROM settings) SELECT * FROM s',
      'SELECT (SELECT value FROM settings LIMIT 1) AS v',
      'SELECT * FROM accounts UNION SELECT key, value, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 FROM settings',
      'SELECT token_ref FROM x',
      'SELECT * FROM sqlite_master',
      'SELECT * FROM sqlite_schema',
      "SELECT * FROM pragma_table_info('settings')",
      'SELECT app_secret FROM y',
      "SELECT load_extension('evil')",
      'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c',
    ];
    for (const sql of bad) expect(() => assertSafeQuery(sql), sql).toThrow();
    expect(EXCLUDED_TABLES).toEqual(expect.arrayContaining(['settings', 'profiles']));
  });
});

describe('run_sql tool', () => {
  it('returns { columns, rows, rowCount, truncated } on the demo DB', () => {
    const res = runSql({ query: 'SELECT username, client_name FROM accounts WHERE is_tracked = 1 ORDER BY username LIMIT 5', purpose: 'list' });
    expect(res.columns).toEqual(['username', 'client_name']);
    expect(res.rows).toHaveLength(5);
    expect(Array.isArray(res.rows[0])).toBe(true);
    expect(res.rowCount).toBe(5);
    expect(res.truncated).toBe(false);
  });

  it('caps rows at the limit and flags truncation', () => {
    const res = runSql({ query: 'SELECT media_id FROM media', purpose: 'all' }, { limit: 10 });
    expect(res.rows).toHaveLength(10);
    expect(res.rowCount).toBe(10);
    expect(res.truncated).toBe(true);
    const def = runSql({ query: 'SELECT media_id FROM media', purpose: 'all' });
    expect(def.rows).toHaveLength(200);
    expect(def.truncated).toBe(true);
  });

  it('aggregates work and numbers stay numbers', () => {
    const res = runSql({ query: "SELECT COUNT(*) AS n, ROUND(SUM(spend), 2) AS spend FROM ad_insights_daily WHERE level = 'account'", purpose: 'total' });
    expect(res.rows[0][0]).toBeGreaterThan(0);
    expect(typeof res.rows[0][1]).toBe('number');
  });

  it('shortens long text cells', () => {
    const res = runSql({ query: `SELECT '${'a'.repeat(1000)}' AS s`, purpose: 'x' });
    expect(res.rows[0][0].length).toBeLessThan(400);
  });

  it('rejects excluded tables and writes; the DB is untouched', () => {
    expect(() => runSql({ query: 'SELECT * FROM settings', purpose: 'x' })).toThrow();
    expect(() => runSql({ query: 'DELETE FROM accounts', purpose: 'x' })).toThrow();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM accounts').get().n).toBe(54); // demo: 40 Instagram + 8 Facebook + 6 Threads
  });

  it('surfaces SQL errors and validates input', () => {
    expect(() => runSql({ query: 'SELECT nope FROM accounts', purpose: 'x' })).toThrow(/nope/);
    expect(() => runSql({})).toThrow();
  });

  it('stops queries that exceed the time budget', () => {
    expect(() => runSql({ query: 'SELECT a.date FROM account_snapshots a, account_snapshots b', purpose: 'slow' }, { limit: 1e9, timeMs: 1 })).toThrow(/time/i);
  });
});

describe('get_period tool', () => {
  it('returns today and the selected period with the previous period of equal length', () => {
    const res = getPeriod({ from: '2026-09-01', to: '2026-09-10', preset: 'custom' }, new Date(2026, 8, 29, 10));
    expect(res.today).toBe('2026-09-29');
    expect(res.selected).toEqual({ from: '2026-09-01', to: '2026-09-10', preset: 'custom', days: 10 });
    expect(res.previous).toEqual({ from: '2026-08-22', to: '2026-08-31' });
    expect(res.weekday).toBe('Tuesday');
  });

  it('ignores an invalid period', () => {
    expect(getPeriod({ from: 'x', to: '2026-01-01' }, new Date(2026, 0, 5)).selected).toBeNull();
    expect(getPeriod(undefined, new Date(2026, 0, 5)).selected).toBeNull();
  });
});

describe('tool definitions and executor', () => {
  it('closed schemas with required fields', () => {
    const names = ASK_TOOLS.map((t) => t.name);
    expect(names).toEqual(['run_sql', 'get_period']);
    for (const t of ASK_TOOLS) {
      expect(t.parameters.type).toBe('object');
      expect(t.parameters.additionalProperties).toBe(false);
      expect(Array.isArray(t.parameters.required)).toBe(true);
    }
    expect(ASK_TOOLS[0].parameters.required).toEqual(['query', 'purpose']);
  });

  it('records successful and failed steps', async () => {
    const ex = createAskExecutor({ period: null });
    const ok = await ex.execute('run_sql', { query: 'SELECT username FROM accounts LIMIT 3', purpose: 'names' });
    expect(ok.rowCount).toBe(3);
    await expect(ex.execute('run_sql', { query: 'SELECT * FROM profiles', purpose: 'bad' })).rejects.toThrow();
    await expect(ex.execute('nope', {})).rejects.toThrow();
    const steps = ex.steps();
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ sql: 'SELECT username FROM accounts LIMIT 3', purpose: 'names', rowCount: 3, columns: ['username'] });
    expect(steps[1].error).toBeTruthy();
    expect(steps[1].sql).toBe('SELECT * FROM profiles');
  });

  it('display rows are capped at 50', async () => {
    const ex = createAskExecutor({ period: null });
    await ex.execute('run_sql', { query: 'SELECT media_id FROM media', purpose: 'many' });
    const [step] = ex.steps();
    expect(step.rows).toHaveLength(50);
    expect(step.rowCount).toBe(200);
    expect(step.truncated).toBe(true);
  });
});

describe('schema description', () => {
  it('describes analytics tables and excludes secret ones entirely', () => {
    const s = buildSchemaDescription();
    for (const table of ['accounts', 'account_snapshots', 'account_insights_daily', 'media', 'media_latest', 'media_insight_snapshots', 'stories', 'ad_accounts', 'ad_insights_daily', 'competitors', 'competitor_snapshots', 'tags', 'account_tags']) {
      expect(s, table).toMatch(new RegExp(`\\b${table}\\(`));
    }
    expect(s).not.toMatch(/\bsettings\(/);
    expect(s).not.toMatch(/\bprofiles\(/);
    expect(s).not.toMatch(/token|secret/i);
    expect(s).not.toMatch(/account_logos\(/);
    expect(s).toMatch(/YYYY-MM-DD/);
    expect(s).toMatch(/epoch ms/i);
    expect(s).toMatch(/currency/i);
  });

  it('is deterministic', () => {
    expect(buildSchemaDescription()).toBe(buildSchemaDescription());
  });
});
