/**
 * v2.0 CLI (chunk F2): argument parsing, account resolution, report params, exit codes — no database needed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  presetRange, resolvePeriod, resolveSections, resolveFormat, expandOutPath, buildReportParams, isBatchPattern, isIsoDate, ReportParamError,
} from '../src/main/export/params.js';
import { parseAccountRef, resolveAccounts, selectAccounts, resolvePlatforms, CliUsageError } from '../src/main/cli/resolve.js';
import { listOpt } from '../src/main/cli/args.js';
import { createOutput, table } from '../src/main/cli/output.js';
import { runCli, usage, commandHelp, COMMANDS } from '../src/main/cli/index.js';
import { EXIT } from '../src/main/cli/exitCodes.js';
import { syncExitCode } from '../src/main/cli/commands/sync.js';
import { tokenHealth } from '../src/main/cli/commands/status.js';

const sink = () => { const s = { text: '', write(x) { s.text += x; return true; } }; return s; };
const run = async (argv, services) => {
  const stdout = sink();
  const stderr = sink();
  const code = await runCli(argv, { stdout, stderr, version: '2.0.0-test', services });
  return { code, out: stdout.text, err: stderr.text };
};

const NOW = new Date(2026, 8, 30, 10, 0); // Wed 30 Sep 2026

describe('period presets (export/params.js)', () => {
  it('matches the app presets and complete calendar periods', () => {
    expect(presetRange('today', NOW)).toEqual({ from: '2026-09-30', to: '2026-09-30' });
    expect(presetRange('yesterday', NOW)).toEqual({ from: '2026-09-29', to: '2026-09-29' });
    expect(presetRange('last_7d', NOW)).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(presetRange('last_30d', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('this_month', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('last_month', NOW)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(presetRange('this_week', NOW)).toEqual({ from: '2026-09-28', to: '2026-09-30' });
    expect(presetRange('last_week', NOW)).toEqual({ from: '2026-09-21', to: '2026-09-27' });
    expect(presetRange('last_month', new Date(2026, 0, 15))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('last_5d', NOW)).toBeNull();
    expect(presetRange('nope', NOW)).toBeNull();
  });

  it('resolves explicit ranges, presets and template defaults', () => {
    expect(resolvePeriod({ template: 'monthly', now: NOW })).toEqual({ from: '2026-08-01', to: '2026-08-31', preset: 'last_month' });
    expect(resolvePeriod({ template: 'weekly', now: NOW }).preset).toBe('last_7d');
    expect(resolvePeriod({ template: 'custom', from: '2026-01-01', to: '2026-01-31', period: 'last_7d' })).toEqual({ from: '2026-01-01', to: '2026-01-31', preset: null });
    expect(() => resolvePeriod({ template: 'custom' })).toThrow(ReportParamError);
    expect(() => resolvePeriod({ template: 'monthly', from: '2026-01-01' })).toThrow(/cli_err_from_to_pair/);
    expect(() => resolvePeriod({ template: 'monthly', from: '2026-02-30', to: '2026-03-01' })).toThrow(/cli_err_bad_date/);
    expect(() => resolvePeriod({ template: 'monthly', from: '2026-03-02', to: '2026-03-01' })).toThrow(/cli_err_from_after_to/);
    expect(() => resolvePeriod({ template: 'monthly', period: 'fortnight' })).toThrow(/cli_err_bad_period/);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-2-1')).toBe(false);
  });

  it('builds section maps, formats and output paths', () => {
    const available = ['kpis', 'reach', 'posts', 'ads'];
    expect(resolveSections({ available })).toEqual({});
    expect(resolveSections({ available, only: ['kpis', 'posts'] })).toEqual({ reach: false, ads: false });
    expect(resolveSections({ available, exclude: ['ads'] })).toEqual({ ads: false });
    expect(() => resolveSections({ available, only: ['bogus'] })).toThrow(/cli_err_bad_section/);
    expect(resolveFormat({ out: 'x.PDF' })).toBe('pdf');
    expect(resolveFormat({ out: 'x.htm' })).toBe('html');
    expect(resolveFormat({ out: 'x.xlsx' })).toBe('xlsx');
    expect(resolveFormat({ out: 'x' })).toBe('pdf');
    expect(resolveFormat({ format: 'html', out: 'x.pdf' })).toBe('html');
    expect(() => resolveFormat({ format: 'docx' })).toThrow(/cli_err_bad_format/);
    expect(expandOutPath('r/{client}/{account}-{template}-{from}_{to}-{date}.{format}', { account: 'a/b', client: 'Acme: Inc', template: 'monthly', from: '2026-08-01', to: '2026-08-31', format: 'pdf', now: NOW }))
      .toBe('r/Acme- Inc/a-b-monthly-2026-08-01_2026-08-31-2026-09-30.pdf');
    expect(expandOutPath('{account}.pdf', {})).toBe('report.pdf');
    expect(isBatchPattern('x/{account}.pdf')).toBe(true);
    expect(isBatchPattern('x.pdf')).toBe(false);
  });

  it('produces the same params shape as the Reports page', () => {
    const p = buildReportParams({ template: 'monthly', igIds: ['1', 'fb-2'], from: '2026-08-01', to: '2026-08-31', lang: 'tr', sections: { ads: false }, branding: { accent: '#fff' } });
    expect(p).toMatchObject({ igIds: ['1', 'fb-2'], igId: '1', from: '2026-08-01', to: '2026-08-31', weekOf: '2026-08-31', tagIds: [], sections: { ads: false }, basket: [], lang: 'tr', commentary: '', branding: { accent: '#fff' } });
    const port = buildReportParams({ template: 'portfolio', igIds: ['1'], tagIds: [3], platforms: ['instagram'], from: 'a', to: 'b', lang: 'en' });
    expect(port.igIds).toBeUndefined();
    expect(port).toMatchObject({ tagIds: [3], platforms: ['instagram'] });
  });
});

describe('account resolution (cli/resolve.js)', () => {
  const accounts = [
    { igId: '1784', platform: 'instagram', username: 'brand', clientName: 'Acme', tagIds: [1] },
    { igId: 'fb-9', platform: 'facebook', username: 'brand', clientName: 'Acme', tagIds: [] },
    { igId: 'th-5', platform: 'threads', username: 'other', clientName: 'Beta', tagIds: [1, 2] },
  ];
  const tagList = [{ id: 1, name: 'Retail' }, { id: 2, name: 'VIP' }];

  it('parses references', () => {
    expect(parseAccountRef('@brand')).toEqual({ username: 'brand' });
    expect(parseAccountRef('fb:@brand')).toEqual({ platform: 'facebook', username: 'brand' });
    expect(parseAccountRef('instagram:@brand')).toEqual({ platform: 'instagram', username: 'brand' });
    expect(parseAccountRef('fb-9')).toEqual({ key: 'fb-9' });
    expect(parseAccountRef('1784')).toEqual({ key: '1784' });
    expect(() => parseAccountRef('  ')).toThrow(CliUsageError);
  });

  it('resolves keys, usernames, platform-qualified names; ambiguity lists candidates', () => {
    expect(resolveAccounts(['fb-9'], accounts).map((a) => a.igId)).toEqual(['fb-9']);
    expect(resolveAccounts(['ig:@BRAND', 'other'], accounts).map((a) => a.igId)).toEqual(['1784', 'th-5']);
    let err;
    try { resolveAccounts(['@brand'], accounts); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CliUsageError);
    expect(err.candidates).toEqual(['instagram:@brand (1784)', 'facebook:@brand (fb-9)']);
    expect(() => resolveAccounts(['@ghost'], accounts)).toThrow(/ghost/);
  });

  it('selects by client, tag and platform, deduplicated', () => {
    expect(selectAccounts({ clients: ['acme'] }, { accounts, tagList }).accounts.map((a) => a.igId)).toEqual(['1784', 'fb-9']);
    expect(selectAccounts({ clients: ['acme'], platforms: ['facebook'] }, { accounts, tagList }).accounts.map((a) => a.igId)).toEqual(['fb-9']);
    const byTag = selectAccounts({ refs: ['th-5'], tags: ['retail'] }, { accounts, tagList });
    expect(byTag.accounts.map((a) => a.igId)).toEqual(['th-5', '1784']);
    expect(byTag.tagIds).toEqual([1]);
    expect(() => selectAccounts({ clients: ['Gamma'] }, { accounts, tagList })).toThrow(expect.objectContaining({ candidates: ['Acme', 'Beta'] }));
    expect(() => selectAccounts({ tags: ['nope'] }, { accounts, tagList })).toThrow(CliUsageError);
  });

  it('validates platforms with aliases and splits list options', () => {
    expect(resolvePlatforms(['ig', 'Facebook', 'instagram'], ['instagram', 'facebook'])).toEqual(['instagram', 'facebook']);
    expect(() => resolvePlatforms(['myspace'], ['instagram'])).toThrow(CliUsageError);
    expect(listOpt(['a,b', ' c ', ''])).toEqual(['a', 'b', 'c']);
    expect(listOpt('x')).toEqual(['x']);
    expect(listOpt(undefined)).toEqual([]);
  });

  it('localizes usage errors with --lang', () => {
    expect(() => resolveAccounts(['@ghost'], accounts, { lang: 'tr' })).toThrow(/Bilinmeyen hesap/);
  });
});

describe('runCli (cli/index.js)', () => {
  it('prints usage and per-command help', async () => {
    expect(await run([])).toMatchObject({ code: EXIT.OK });
    const h = await run(['--help']);
    expect(h.code).toBe(EXIT.OK);
    for (const c of ['sync', 'report', 'export', 'accounts', 'status', 'backup']) expect(h.out).toContain(c);
    const rh = await run(['report', '--help']);
    expect(rh.code).toBe(EXIT.OK);
    expect(rh.out).toContain('--template');
    expect(rh.out).toContain('{account}');
    expect((await run(['help', 'sync'])).out).toContain('--scope');
    expect(commandHelp(COMMANDS[0])).toContain('Exit codes');
    expect(usage()).toContain('Global options');
  });

  it('returns usage errors (2) for unknown commands, options and languages', async () => {
    const unknown = await run(['frobnicate']);
    expect(unknown.code).toBe(EXIT.USAGE);
    expect(unknown.err).toContain('frobnicate');
    expect((await run(['accounts', '--bogus'])).code).toBe(EXIT.USAGE);
    expect((await run(['status', '--lang', 'xx'])).code).toBe(EXIT.USAGE);
    expect((await run(['sync', '--scope', 'everything'])).code).toBe(EXIT.USAGE);
    expect((await run(['report', '--template', 'monthly', '--out', 'x.pdf'])).code).toBe(EXIT.USAGE);
    expect((await run(['report', '--template', 'custom', '--account', 'x', '--out', 'x.pdf'])).code).toBe(EXIT.USAGE);
  });

  it('prints the version (plain and --json)', async () => {
    expect((await run(['--version'])).out.trim()).toBe('2.0.0-test');
    expect(JSON.parse((await run(['--version', '--json'])).out)).toEqual({ version: '2.0.0-test' });
  });

  it('keeps global options before the command name', async () => {
    const r = await run(['--lang', 'tr', '--user-data', '/tmp/x', 'sync', '--scope', 'nope']);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.err).toContain('Geçersiz');
  });

  it('writes --log-file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-cli-log-'));
    const file = path.join(dir, 'sub', 'cli.log');
    await run(['--version', '--log-file', file]);
    await run(['frobnicate', '--log-file', file]);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('2.0.0-test');
    expect(text).toContain('ERROR');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('output and exit-code helpers', () => {
  it('formats tables, JSON and quiet mode', () => {
    expect(table([{ a: 'x', n: 5 }, { a: 'long', n: 123 }], [{ key: 'a', label: 'A' }, { key: 'n', label: 'N', align: 'right' }])).toBe('A       N\nx       5\nlong  123');
    const stdout = sink();
    const stderr = sink();
    const out = createOutput({ json: true, quiet: true, stdout, stderr });
    out.result([{ a: 1 }], { columns: [{ key: 'a', label: 'A' }] });
    out.info('progress');
    out.warn('careful');
    expect(stdout.text).toBe('[{"a":1}]\n');
    expect(stderr.text).toBe('careful\n');
  });

  it('maps sync outcomes to exit codes', () => {
    expect(syncExitCode({ status: 'ok' })).toBe(EXIT.OK);
    expect(syncExitCode({ status: 'partial' })).toBe(EXIT.PARTIAL);
    expect(syncExitCode({ status: 'failed' })).toBe(EXIT.ERROR);
    expect(syncExitCode({ status: 'partial', invalidAuth: ['google:3'] })).toBe(EXIT.AUTH);
    expect(syncExitCode({ status: 'failed', tokenInvalid: true })).toBe(EXIT.AUTH);
  });

  it('classifies token health', () => {
    const now = Date.now();
    const day = 86_400_000;
    expect(tokenHealth({ token_ref: 'demo:meta' }, { now, readable: true })).toBe('demo');
    expect(tokenHealth({ token_ref: 'token:x' }, { now, readable: false })).toBe('missing');
    expect(tokenHealth({ token_ref: 'token:x', token_expires_at: now - 1 }, { now, readable: true })).toBe('expired');
    expect(tokenHealth({ token_ref: 'token:x', token_expires_at: now - 1, refresh_ref: 'token:r' }, { now, readable: true })).toBe('ok');
    expect(tokenHealth({ token_ref: 'token:x', token_expires_at: now + 3 * day }, { now, readable: true })).toBe('expiring');
    expect(tokenHealth({ token_ref: 'token:x', token_expires_at: now + 30 * day }, { now, readable: true })).toBe('ok');
    expect(tokenHealth({ token_ref: 'token:x', token_expires_at: null }, { now, readable: true })).toBe('ok');
  });
});
