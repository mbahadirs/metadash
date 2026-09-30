/**
 * v2.0 CLI (chunk F2): accounts / status / report / export / backup through runCli against a seeded demo database.
 * The PDF writer is injected here (it needs Electron's BrowserWindow); scripts/cli-smoke.mjs covers the real PDF path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { openDb, closeDb } from '../src/main/db/index.js';
import { seedDemo } from '../src/main/seed/index.js';
import { EXIT } from '../src/main/cli/exitCodes.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-cli-'));
const outDir = path.join(dir, 'out');
let runCli;
let accounts;
let tags;

const sink = () => { const s = { text: '', write(x) { s.text += x; return true; } }; return s; };
const run = async (argv, services) => {
  const stdout = sink();
  const stderr = sink();
  const code = await runCli(argv, { stdout, stderr, version: '2.0.0-test', services });
  return { code, out: stdout.text, err: stderr.text, json: () => JSON.parse(stdout.text) };
};

beforeAll(async () => {
  openDb(path.join(dir, 'data.db'));
  seedDemo({ reset: true });
  ({ runCli } = await import('../src/main/cli/index.js'));
  const acc = await import('../src/main/db/queries/accounts.js');
  const tq = await import('../src/main/db/queries/tags.js');
  accounts = acc.listAccounts();
  tags = tq.listTags();
}, 120_000);
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

const firstIg = () => accounts.find((a) => a.platform === 'instagram');
const clientWithMany = () => {
  const counts = {};
  for (const a of accounts) if (a.clientName) counts[a.clientName] = (counts[a.clientName] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
};

describe('accounts', () => {
  it('lists tracked accounts as a table and as JSON', async () => {
    const human = await run(['accounts']);
    expect(human.code).toBe(EXIT.OK);
    expect(human.out.split('\n')[0]).toMatch(/^KEY\s+PLATFORM\s+USERNAME/);
    expect(human.out).toContain(`@${firstIg().username}`);
    const json = (await run(['accounts', '--json'])).json();
    expect(json).toHaveLength(accounts.length);
    expect(json[0]).toEqual(expect.objectContaining({ key: expect.any(String), platform: expect.any(String), username: expect.any(String), tracked: true }));
    expect(JSON.stringify(json)).not.toMatch(/token/i);
  });

  it('filters by platform, client and tag', async () => {
    const fb = (await run(['accounts', '--platform', 'fb', '--json'])).json();
    expect(fb.length).toBeGreaterThan(0);
    expect(fb.every((a) => a.platform === 'facebook')).toBe(true);
    const client = clientWithMany();
    const byClient = (await run(['accounts', '--client', client, '--json'])).json();
    expect(byClient.every((a) => a.client === client)).toBe(true);
    if (tags.length) {
      const byTag = (await run(['accounts', '--tag', tags[0].name, '--json'])).json();
      expect(byTag.every((a) => a.tags.includes(tags[0].name))).toBe(true);
    }
    expect((await run(['accounts', '--client', 'No Such Client'])).code).toBe(EXIT.USAGE);
  });
});

describe('status', () => {
  it('reports connections, accounts and sync state without secrets', async () => {
    const r = await run(['status', '--json']);
    expect(r.code).toBe(EXIT.OK);
    const st = r.json();
    expect(st.connections.find((c) => c.auth === 'meta')).toMatchObject({ connected: true, health: 'demo' });
    expect(st.accounts.total).toBe(accounts.length);
    expect(st.session).toMatchObject({ role: 'admin', readOnly: false });
    expect(st.syncRunning).toBeNull();
    expect(r.out).not.toMatch(/token_ref|"token"/);
    const human = await run(['status']);
    expect(human.out).toContain('meta');
    expect((await run(['status', '--lang', 'tr'])).out).toContain('Bağlantılar');
  });

  it('--check exits 4 when a connection is expired', async () => {
    const services = {
      enabledAuths: () => ['meta'],
      listProfiles: () => [{ id: 1, label: 'Meta', token_ref: 'token:x', token_expires_at: Date.now() - 1000 }],
      readToken: () => 'secret',
    };
    const r = await run(['status', '--check', '--json'], services);
    expect(r.code).toBe(EXIT.AUTH);
    expect(r.json().connections[0].health).toBe('expired');
    expect(r.out).not.toContain('secret');
    expect((await run(['status', '--check'])).code).toBe(EXIT.OK);
  });
});

describe('report', () => {
  it('writes an HTML report for one account', async () => {
    const a = firstIg();
    const file = path.join(outDir, 'one.html');
    const r = await run(['report', '--template', 'monthly', '--account', a.igId, '--period', 'last_30d', '--out', file, '--json']);
    expect(r.code).toBe(EXIT.OK);
    const res = r.json();
    expect(res).toMatchObject({ template: 'monthly', format: 'html', failed: [] });
    expect(res.files[0]).toMatchObject({ file, accounts: [{ igId: a.igId }] });
    const html = fs.readFileSync(file, 'utf8');
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(`@${a.username}`);
  });

  it('honours --lang, --sections and --cover-title', async () => {
    const a = firstIg();
    const file = path.join(outDir, 'tr.html');
    const r = await run(['report', '-t', 'monthly', '--account', `ig:@${a.username}`, '--from', '2026-01-01', '--to', '2026-01-31', '--lang', 'tr', '--sections', 'kpis', '--cover-title', 'Ocak Raporu', '-o', file]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.out.trim()).toBe(file);
    const html = fs.readFileSync(file, 'utf8');
    expect(html).toContain('<html lang="tr">');
    expect(html).toContain('Ocak Raporu');
    expect(html).toContain('2026-01-01');
  });

  it('writes one file per account with {account} (batch by client) and an xlsx workbook', async () => {
    const client = clientWithMany();
    const members = accounts.filter((a) => a.clientName === client);
    const pattern = path.join(outDir, 'batch', '{client}', '{platform}-{account}-{date}.xlsx');
    const r = await run(['report', '--template', 'weekly_client', '--client', client, '--out', pattern, '--json', '--quiet']);
    expect(r.code).toBe(EXIT.OK);
    const res = r.json();
    expect(res.format).toBe('xlsx');
    expect(res.files).toHaveLength(members.length);
    for (const f of res.files) expect(fs.existsSync(f.file)).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(res.files[0].file);
    expect(wb.worksheets.length).toBeGreaterThan(0);
  });

  it('writes portfolio reports filtered by tag / platform and passes PDF to the injected writer', async () => {
    const calls = [];
    const writers = { pdf: async (template, params, file) => { calls.push({ template, params }); fs.writeFileSync(file, '%PDF-fake'); } };
    const file = path.join(outDir, 'portfolio-{date}.pdf');
    const args = ['report', '--template', 'portfolio', '--platform', 'instagram', '--out', file, '--json'];
    if (tags.length) args.push('--tag', tags[0].name);
    const r = await run(args, { writers: { ...(await defaultWriters()), ...writers } });
    expect(r.code).toBe(EXIT.OK);
    expect(calls[0].template).toBe('portfolio');
    expect(calls[0].params).toMatchObject({ platforms: ['instagram'], igIds: undefined });
    if (tags.length) expect(calls[0].params.tagIds).toEqual([tags[0].id]);
    expect(fs.readFileSync(r.json().files[0].file, 'utf8')).toBe('%PDF-fake');
  });

  it('rejects invalid combinations with exit 2 and reports partial failures with exit 3', async () => {
    const a = firstIg();
    expect((await run(['report', '--template', 'campaign', '--client', clientWithMany(), '--out', path.join(outDir, 'c.html')])).code).toBe(EXIT.USAGE);
    expect((await run(['report', '--template', 'portfolio', '--account', a.igId, '--out', path.join(outDir, 'p.html')])).code).toBe(EXIT.USAGE);
    expect((await run(['report', '--template', 'portfolio', '--out', path.join(outDir, '{account}.html')])).code).toBe(EXIT.USAGE);
    expect((await run(['report', '--template', 'monthly', '--account', a.igId, '--sections', 'nope', '--out', path.join(outDir, 'x.html')])).code).toBe(EXIT.USAGE);
    expect((await run(['report', '--template', 'monthly', '--account', '@ghost-account', '--out', path.join(outDir, 'x.html')])).code).toBe(EXIT.USAGE);
    expect((await run(['report', '--template', 'basket', '--out', path.join(outDir, 'x.html')])).code).toBe(EXIT.USAGE);

    const members = accounts.filter((x) => x.clientName === clientWithMany());
    let n = 0;
    const flaky = { html: async (_t, _p, file) => { n += 1; if (n === 1) throw new Error('boom'); fs.writeFileSync(file, 'ok'); } };
    const partial = await run(['report', '--template', 'monthly', '--client', clientWithMany(), '--out', path.join(outDir, 'flaky', '{platform}-{account}.html'), '--json'], { writers: flaky });
    expect(partial.code).toBe(members.length > 1 ? EXIT.PARTIAL : EXIT.ERROR);
    expect(partial.json().failed[0].error).toBe('boom');
    expect(partial.err).toContain('boom');
  });

  it('uses the AI commentary service when asked, and still writes the report when it fails', async () => {
    const a = firstIg();
    const ok = await run(['report', '--template', 'monthly', '--account', a.igId, '--commentary', 'ai', '--out', path.join(outDir, 'ai.html')], { aiCommentary: async () => ({ text: 'AI SAYS HELLO' }) });
    expect(ok.code).toBe(EXIT.OK);
    expect(fs.readFileSync(path.join(outDir, 'ai.html'), 'utf8')).toContain('AI SAYS HELLO');
    const bad = await run(['report', '--template', 'monthly', '--account', a.igId, '--commentary', 'ai', '--out', path.join(outDir, 'ai2.html')], { aiCommentary: async () => { throw new Error('no key'); } });
    expect(bad.code).toBe(EXIT.OK);
    expect(bad.err).toContain('no key');
  });
});

async function defaultWriters() {
  const { writeHtmlReport } = await import('../src/main/export/htmlReport.js');
  return { html: async (t, p, f) => writeHtmlReport(t, p, f) };
}

describe('export and backup', () => {
  it('lists the built-in queries', async () => {
    const r = await run(['export', 'list', '--json']);
    expect(r.code).toBe(EXIT.OK);
    expect(r.json()).toEqual(expect.arrayContaining(['accounts', 'media', 'snapshots']));
  });

  it('writes CSV to a file and to stdout', async () => {
    const file = path.join(outDir, 'accounts.csv');
    const r = await run(['export', 'csv', '--query', 'accounts', '--out', file, '--json']);
    expect(r.code).toBe(EXIT.OK);
    expect(r.json()).toMatchObject({ file, format: 'csv', rows: accounts.filter((a) => a.isTracked).length });
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^﻿ig_id,platform,username/);
    const stdout = sink();
    const code = await runCli(['export', 'csv', '--sql', 'SELECT 1 AS one, \'a,b\' AS two', '--out', '-'], { stdout, stderr: sink(), services: { stdout } });
    expect(code).toBe(EXIT.OK);
    expect(stdout.text).toBe('one,two\r\n1,"a,b"\r\n');
  });

  it('writes an xlsx workbook with one sheet per query', async () => {
    const file = path.join(outDir, 'tables.xlsx');
    const r = await run(['export', 'xlsx', '--query', 'accounts,snapshots', '--out', file]);
    expect(r.code).toBe(EXIT.OK);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['accounts', 'snapshots']);
  });

  it('rejects writes, unknown queries and bad combinations', async () => {
    expect((await run(['export', 'csv', '--sql', 'DELETE FROM accounts', '--out', path.join(outDir, 'x.csv')])).code).toBe(EXIT.ERROR);
    expect((await run(['export', 'csv', '--query', 'nope', '--out', path.join(outDir, 'x.csv')])).code).toBe(EXIT.USAGE);
    expect((await run(['export', 'csv', '--query', 'accounts,media', '--out', path.join(outDir, 'x.csv')])).code).toBe(EXIT.USAGE);
    expect((await run(['export', 'csv', '--query', 'accounts'])).code).toBe(EXIT.USAGE);
    expect((await run(['export', 'pdf', '--out', 'x'])).code).toBe(EXIT.USAGE);
  });

  it('backup (alias) writes a transfer file; secrets only with a passphrase from the environment', async () => {
    const file = path.join(outDir, 'backup.metadash');
    const r = await run(['backup', '--out', file, '--json']);
    expect(r.code).toBe(EXIT.OK);
    expect(r.err).toContain('--passphrase-env');
    expect(r.json()).toMatchObject({ file, secretsKept: 0 });
    expect(fs.statSync(file).size).toBeGreaterThan(0);
    const missing = await run(['export', 'backup', '--out', file, '--passphrase-env', 'MD_TEST_PASS'], { env: {} });
    expect(missing.code).toBe(EXIT.USAGE);
    const seen = [];
    const withPass = await run(['export', 'backup', '--out', file, '--passphrase-env', 'MD_TEST_PASS'], { env: { MD_TEST_PASS: 'hunter2' }, exportAll: async (o) => { seen.push(o); return { filePath: o.filePath, size: 1024, secretsKept: 1, secretsDropped: 0, accounts: 1, media: 2 }; } });
    expect(withPass.code).toBe(EXIT.OK);
    expect(seen[0]).toMatchObject({ passphrase: 'hunter2', appVersion: '2.0.0-test' });
    expect(withPass.out).not.toContain('hunter2');
  });
});
